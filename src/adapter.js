import {
  formatDeletedMessage,
  formatCopilotMessage,
  formatMirroredMessage,
  normalizeSlackMessage,
  slackPermalink,
  sourceKey,
} from "./format.js";
import {
  classifySlackMessage,
  SlackMessageScope,
} from "./scope-policy.js";

export class SlackBuzzAdapter {
  constructor({
    config,
    slackClient,
    buzzClient,
    stateStore,
    logger,
    workspaceUrl,
    workspaceId,
    channelRoutes,
  }) {
    this.config = config;
    this.slackClient = slackClient;
    this.buzzClient = buzzClient;
    this.stateStore = stateStore;
    this.logger = logger;
    this.workspaceUrl = workspaceUrl;
    this.workspaceId = workspaceId;
    this.channelRoutes = new Map(
      channelRoutes.map((route) => [route.slackChannelId, route]),
    );
    this.queue = Promise.resolve();
  }

  enqueue(payload) {
    this.queue = this.queue
      .then(() => this.processPayload(payload))
      .catch((error) => {
        this.logger.error("Slack event processing failed", {
          error: error.message,
          eventId: payload?.event_id,
        });
      });
    return this.queue;
  }

  async processPayload(payload) {
    if (payload.type !== "event_callback" || !payload.event) return "ignored";
    if (payload.team_id && payload.team_id !== payload.authorizations?.[0]?.team_id) {
      this.logger.debug("Processing event with differing authorization team");
    }

    const scope = classifySlackMessage(this.config, payload.event);
    if (scope === SlackMessageScope.EXCLUDED_DM) return "excluded";

    const eventId = payload.event_id;
    if (this.stateStore.hasEvent(eventId)) {
      this.logger.debug("Ignored duplicate Slack event", { eventId });
      return "duplicate";
    }

    const normalized = normalizeSlackMessage(payload.event);
    if (!normalized || scope === SlackMessageScope.IGNORED) {
      if (eventId) await this.stateStore.markEvent(eventId);
      return "ignored";
    }

    if (normalized.action === "delete") {
      return this.handleDelete(eventId, normalized);
    }

    return this.handleCreateOrEdit(
      eventId,
      normalized,
      scope,
      payload.team_id || this.workspaceId,
    );
  }

  async handleCreateOrEdit(eventId, normalized, scope, workspaceId) {
    const { message, channel, action } = normalized;
    if (!message?.ts) {
      if (eventId) await this.stateStore.markEvent(eventId);
      return "ignored";
    }

    const key = sourceKey(channel, message.ts);
    const existing = this.stateStore.getMessage(key);

    if (action === "create" && existing) {
      await this.stateStore.markEvent(eventId);
      return "existing";
    }

    const actor = await this.resolveActor(workspaceId, message);
    const author = actor.displayName;
    const permalink = slackPermalink(this.workspaceUrl, channel, message.ts);
    const isCopilot = scope === SlackMessageScope.COPILOT;
    const route = isCopilot
      ? undefined
      : this.channelRoutes.get(channel);
    if (!isCopilot && !route) {
      if (eventId) await this.stateStore.markEvent(eventId);
      return "ignored";
    }
    const content = isCopilot
      ? formatCopilotMessage({
          adapterLabel: this.config.adapterLabel,
          author,
          message,
          permalink,
          copilotAgentName: this.config.copilotAgentName,
        })
      : formatMirroredMessage({
          adapterLabel: this.config.adapterLabel,
          author,
          channelName: route.slackChannelName,
          message,
          permalink,
        });
    const source = {
      workspaceId,
      channelId: channel,
      channelType: isCopilot ? "im" : route.evidenceAudience,
      slackUserId: message.user || null,
      messageTimestamp: message.ts,
      permalink,
      scope,
      audience: isCopilot
        ? "personal_copilot"
        : route.evidenceAudience,
    };

    if (existing) {
      await this.buzzClient.editMessage(existing.buzzEventId, content);
      await this.stateStore.record({
        eventId,
        sourceKey: key,
        message: {
          ...existing,
          content,
          source,
          updatedAt: new Date().toISOString(),
        },
        actorKey: actor.key,
        actor,
      });
      this.logger.info("Updated mirrored Slack message", { sourceKey: key });
      return "updated";
    }

    let replyTo;
    if (message.thread_ts && message.thread_ts !== message.ts) {
      replyTo = this.stateStore.getMessage(sourceKey(channel, message.thread_ts))
        ?.buzzEventId;
    }

    const destinationChannelId = isCopilot
      ? this.config.copilotBuzzChannelId
      : route.buzzChannelId;
    const result = await this.buzzClient.sendMessage(
      destinationChannelId,
      content,
      replyTo,
    );
    if (!result.event_id) throw new Error("Buzz did not return a message event ID");

    await this.stateStore.record({
      eventId,
      sourceKey: key,
      message: {
        buzzEventId: result.event_id,
        content,
        source,
        slackThreadTs: message.thread_ts || null,
        createdAt: new Date().toISOString(),
      },
      actorKey: actor.key,
      actor,
    });
    this.logger.info("Mirrored Slack message", {
      sourceKey: key,
      buzzEventId: result.event_id,
      threaded: Boolean(replyTo),
    });
    return "created";
  }

  async resolveActor(workspaceId, message) {
    if (message.user && this.slackClient.userProfile) {
      const profile = await this.slackClient.userProfile(message.user);
      return {
        key: `${workspaceId || "unknown"}:${message.user}`,
        workspaceId: workspaceId || null,
        ...profile,
        updatedAt: new Date().toISOString(),
      };
    }
    const displayName =
      message.bot_profile?.name ||
      message.username ||
      (await this.slackClient.userDisplayName(message.user));
    const identifier = message.user || message.bot_id || "unknown";
    return {
      key: `${workspaceId || "unknown"}:${identifier}`,
      workspaceId: workspaceId || null,
      userId: message.user || null,
      displayName,
      isBot: Boolean(message.bot_id || message.bot_profile),
      isGuest: false,
      isDeleted: false,
      updatedAt: new Date().toISOString(),
    };
  }

  async handleDelete(eventId, normalized) {
    const key = sourceKey(normalized.channel, normalized.deletedTs);
    const existing = this.stateStore.getMessage(key);
    if (!existing) {
      await this.stateStore.markEvent(eventId);
      return "missing";
    }

    const content = formatDeletedMessage(existing);
    await this.buzzClient.editMessage(existing.buzzEventId, content);
    await this.stateStore.record({
      eventId,
      sourceKey: key,
      message: {
        ...existing,
        content,
        deletedAt: new Date().toISOString(),
      },
    });
    this.logger.info("Marked mirrored Slack message as deleted", {
      sourceKey: key,
    });
    return "deleted";
  }
}

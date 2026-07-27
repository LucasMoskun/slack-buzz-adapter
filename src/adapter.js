import {
  formatDeletedMessage,
  formatMirroredMessage,
  normalizeSlackMessage,
  slackPermalink,
  sourceKey,
} from "./format.js";

export class SlackBuzzAdapter {
  constructor({
    config,
    slackClient,
    buzzClient,
    stateStore,
    logger,
    workspaceUrl,
    channelName,
  }) {
    this.config = config;
    this.slackClient = slackClient;
    this.buzzClient = buzzClient;
    this.stateStore = stateStore;
    this.logger = logger;
    this.workspaceUrl = workspaceUrl;
    this.channelName = channelName;
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

    const eventId = payload.event_id;
    if (this.stateStore.hasEvent(eventId)) {
      this.logger.debug("Ignored duplicate Slack event", { eventId });
      return "duplicate";
    }

    const normalized = normalizeSlackMessage(payload.event);
    if (!normalized || normalized.channel !== this.config.slackChannelId) {
      if (eventId) await this.stateStore.markEvent(eventId);
      return "ignored";
    }

    if (normalized.action === "delete") {
      return this.handleDelete(eventId, normalized);
    }

    return this.handleCreateOrEdit(eventId, normalized);
  }

  async handleCreateOrEdit(eventId, normalized) {
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

    const author =
      message.bot_profile?.name ||
      message.username ||
      (await this.slackClient.userDisplayName(message.user));
    const permalink = slackPermalink(this.workspaceUrl, channel, message.ts);
    const content = formatMirroredMessage({
      adapterLabel: this.config.adapterLabel,
      author,
      channelName: this.channelName,
      message,
      permalink,
    });

    if (existing) {
      await this.buzzClient.editMessage(existing.buzzEventId, content);
      await this.stateStore.record({
        eventId,
        sourceKey: key,
        message: {
          ...existing,
          content,
          updatedAt: new Date().toISOString(),
        },
      });
      this.logger.info("Updated mirrored Slack message", { sourceKey: key });
      return "updated";
    }

    let replyTo;
    if (message.thread_ts && message.thread_ts !== message.ts) {
      replyTo = this.stateStore.getMessage(sourceKey(channel, message.thread_ts))
        ?.buzzEventId;
    }

    const result = await this.buzzClient.sendMessage(
      this.config.buzzChannelId,
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
        slackThreadTs: message.thread_ts || null,
        createdAt: new Date().toISOString(),
      },
    });
    this.logger.info("Mirrored Slack message", {
      sourceKey: key,
      buzzEventId: result.event_id,
      threaded: Boolean(replyTo),
    });
    return "created";
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

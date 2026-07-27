const SLACK_CITATION =
  /https:\/\/[^\s)]+\/archives\/[A-Z0-9]+\/p\d+/i;

export class CopilotDeliveryService {
  constructor({
    config,
    slackClient,
    buzzClient,
    stateStore,
    logger,
  }) {
    this.config = config;
    this.slackClient = slackClient;
    this.buzzClient = buzzClient;
    this.stateStore = stateStore;
    this.logger = logger;
  }

  async runOnce() {
    const events = await this.buzzClient.getMessages(
      this.config.copilotBuzzChannelId,
      200,
    );
    const byId = new Map(events.map((event) => [event.id, event]));
    const stats = {
      scanned: events.length,
      eligible: 0,
      delivered: 0,
      alreadyDelivered: 0,
      invalid: 0,
    };

    const suggestions = [...byId.values()]
      .filter((event) => event.pubkey === this.config.copilotAgentPubkey)
      .slice(-20);
    for (const suggestion of suggestions) {
      if (
        !suggestion ||
        !suggestion.content?.trim()
      ) {
        stats.invalid += 1;
        continue;
      }
      if (this.stateStore.getDelivery(suggestion.id)) {
        stats.alreadyDelivered += 1;
        continue;
      }
      if (!SLACK_CITATION.test(suggestion.content)) {
        stats.invalid += 1;
        this.logger.warn("Copilot suggestion lacks a Slack source citation", {
          suggestionId: suggestion.id,
        });
        continue;
      }
      const sourceEvent = byId.get(replyTarget(suggestion.tags));
      if (
        !isPairedSlackRequest(sourceEvent, {
          humanPubkey: this.config.copilotHumanPubkey,
          slackDmId: this.config.copilotSlackDmId,
        })
      ) {
        stats.invalid += 1;
        this.logger.warn(
          "Copilot response is not linked to the paired Slack request",
          { suggestionId: suggestion.id },
        );
        continue;
      }
      stats.eligible += 1;

      const response = await this.slackClient.postMessage(
        this.config.copilotSlackDmId,
        formatOutboundSuggestion(suggestion.content),
      );
      await this.stateStore.recordDelivery(suggestion.id, {
        sourceEventId: sourceEvent.id,
        deliveryType: "automatic_private_reply",
        slackChannelId: response.channel,
        slackTimestamp: response.ts,
        deliveredAt: new Date().toISOString(),
      });
      stats.delivered += 1;
      this.logger.info("Delivered private copilot response to Slack", {
        suggestionId: suggestion.id,
        sourceEventId: sourceEvent.id,
      });
    }

    return stats;
  }
}

export function isPairedSlackRequest(
  event,
  { humanPubkey, slackDmId },
) {
  if (!event || event.pubkey !== humanPubkey || !slackDmId) return false;
  const escapedDmId = slackDmId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `https:\\/\\/[^\\s)]+\\/archives\\/${escapedDmId}\\/p\\d+`,
    "i",
  ).test(event.content || "");
}

export function replyTarget(tags = []) {
  const reply = tags.find(
    (tag) => tag[0] === "e" && tag[3] === "reply",
  );
  if (reply?.[1]) return reply[1];
  return [...tags].reverse().find((tag) => tag[0] === "e")?.[1];
}

export function formatOutboundSuggestion(content) {
  return [
    "*Suggestion from your Buzz research copilot*",
    "",
    content.trim(),
    "",
    "_Sent automatically from your private Buzz copilot. Reply here to continue the conversation._",
  ].join("\n");
}

const APPROVAL_COMMAND = "/approve";
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
    const replyApprovals = new Map();
    for (const event of events) {
      if (!isApproval(event, this.config.copilotApproverPubkey)) continue;
      replyApprovals.set(replyTarget(event.tags), event);
    }
    const stats = {
      scanned: events.length,
      approvals: replyApprovals.size,
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
      const replyApproval = replyApprovals.get(suggestion.id);
      const reactionApproval = replyApproval
        ? false
        : await this.hasApprovalReaction(suggestion.id);
      if (!replyApproval && !reactionApproval) continue;
      if (reactionApproval) stats.approvals += 1;

      const response = await this.slackClient.postMessage(
        this.config.copilotSlackDmId || this.config.copilotSlackUserId,
        formatOutboundSuggestion(suggestion.content),
      );
      await this.stateStore.recordDelivery(suggestion.id, {
        approvalEventId: replyApproval?.id || null,
        approvalType: reactionApproval ? "reaction" : "reply",
        slackChannelId: response.channel,
        slackTimestamp: response.ts,
        deliveredAt: new Date().toISOString(),
      });
      stats.delivered += 1;
      this.logger.info("Delivered approved copilot suggestion to Slack", {
        suggestionId: suggestion.id,
        approvalEventId: replyApproval?.id,
        approvalType: reactionApproval ? "reaction" : "reply",
      });
    }

    return stats;
  }

  async hasApprovalReaction(eventId) {
    if (!this.buzzClient.getReactions) return false;
    const response = await this.buzzClient.getReactions(eventId);
    return Boolean(
      response.reactions?.some(
        (reaction) =>
          ["✅", "white_check_mark"].includes(reaction.emoji) &&
          reaction.pubkeys?.includes(this.config.copilotApproverPubkey),
      ),
    );
  }
}

export function isApproval(event, approverPubkey) {
  return (
    event?.pubkey === approverPubkey &&
    event?.content?.trim().toLowerCase() === APPROVAL_COMMAND &&
    Boolean(replyTarget(event.tags))
  );
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
    "_This was reviewed in Buzz before delivery. Reply here to continue privately with your copilot._",
  ].join("\n");
}

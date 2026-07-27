export const SlackMessageScope = Object.freeze({
  EVIDENCE: "evidence",
  COPILOT: "copilot",
  EXCLUDED_DM: "excluded_dm",
  IGNORED: "ignored",
});

export function classifySlackMessage(config, event) {
  const channelId = event?.channel;
  const channelType =
    event?.channel_type ||
    event?.message?.channel_type ||
    event?.previous_message?.channel_type;

  if (channelType === "mpim") return SlackMessageScope.EXCLUDED_DM;

  const isDirectMessage =
    channelType === "im" || String(channelId || "").startsWith("D");
  if (isDirectMessage) {
    if (
      config.copilotSlackDmId &&
      channelId === config.copilotSlackDmId &&
      isCopilotHumanMessage(config.copilotSlackUserId, event)
    ) {
      return SlackMessageScope.COPILOT;
    }
    return SlackMessageScope.EXCLUDED_DM;
  }

  if (channelId === config.slackChannelId) {
    return SlackMessageScope.EVIDENCE;
  }

  return SlackMessageScope.IGNORED;
}

function isCopilotHumanMessage(userId, event) {
  if (!userId) return false;
  if (event.subtype === "message_deleted") {
    const previousUser = event.previous_message?.user;
    return !previousUser || previousUser === userId;
  }
  return (event.message?.user || event.user) === userId;
}

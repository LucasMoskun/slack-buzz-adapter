export function sourceKey(channelId, timestamp) {
  return `${channelId}:${timestamp}`;
}

export function normalizeSlackMessage(event) {
  if (event.type !== "message") return null;

  if (event.subtype === "message_changed") {
    return {
      action: "edit",
      channel: event.channel,
      message: event.message,
    };
  }

  if (event.subtype === "message_deleted") {
    return {
      action: "delete",
      channel: event.channel,
      deletedTs: event.deleted_ts,
    };
  }

  const ignoredSubtypes = new Set([
    "channel_join",
    "channel_leave",
    "channel_name",
    "channel_purpose",
    "channel_topic",
  ]);
  if (event.subtype && ignoredSubtypes.has(event.subtype)) return null;

  return {
    action: "create",
    channel: event.channel,
    message: event,
  };
}

export function slackPermalink(workspaceUrl, channelId, timestamp) {
  if (!workspaceUrl || !channelId || !timestamp) return null;
  const root = workspaceUrl.replace(/\/+$/, "");
  const compactTimestamp = timestamp.replace(".", "");
  return `${root}/archives/${channelId}/p${compactTimestamp}`;
}

export function formatMirroredMessage({
  adapterLabel,
  author,
  channelName,
  message,
  permalink,
}) {
  const timestampMs = Math.floor(Number(message.ts) * 1000);
  const time = Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : "unknown time";
  const text = neutralizeAtMentions(
    message.text?.trim() || describeFiles(message.files),
  );
  const source = permalink ? ` · [open in Slack](${permalink})` : "";

  return [
    `**${adapterLabel} · ${author}** · #${channelName} · ${time}${source}`,
    "",
    text || "_Message contained no text._",
  ].join("\n");
}

export function formatCopilotMessage({
  adapterLabel,
  author,
  message,
  permalink,
  copilotAgentName,
}) {
  const timestampMs = Math.floor(Number(message.ts) * 1000);
  const time = Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : "unknown time";
  const text = neutralizeAtMentions(
    message.text?.trim() || describeFiles(message.files),
  );
  const source = permalink ? ` · [open in Slack](${permalink})` : "";

  return [
    `@${copilotAgentName} — private request from ${author}`,
    "",
    `**${adapterLabel} · private copilot inbox · ${author}** · ${time}${source}`,
    "",
    text || "_Message contained no text._",
    "",
    "_Personal context: do not promote into shared findings without an explicit share action._",
  ].join("\n");
}

const ZERO_WIDTH_SPACE = "\u200b";

/**
 * Stop literal `@name` text from Slack being treated as a Buzz mention.
 *
 * The Buzz CLI resolves `@name` tokens (an `@` at start-of-string or after
 * ASCII whitespace, followed by `[A-Za-z0-9._-]`) against channel members and
 * refuses to send when a name does not match one. Mirrored Slack text is
 * quoted evidence, not a request for anyone's attention, so a zero-width
 * space is inserted after the `@`. Readers still see `@name`; the CLI and
 * client-side highlighters no longer see a mention. Slack's own structured
 * mentions (`<@U…>`) are untouched because their `@` follows `<`.
 */
export function neutralizeAtMentions(text) {
  if (!text || !text.includes("@")) return text;
  return text.replace(
    /(^|[ \t\r\n\f\v])@(?=[A-Za-z0-9._-])/g,
    `$1@${ZERO_WIDTH_SPACE}`,
  );
}

function describeFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return "";
  return files
    .map((file) => {
      const name = file.name || file.title || "Slack file";
      const url = file.permalink || file.url_private;
      return url ? `[${name}](${url})` : name;
    })
    .join("\n");
}

export function formatDeletedMessage(existing) {
  const header = existing?.content?.split("\n", 1)[0] || "**Slack mirror**";
  return `${header}\n\n_Deleted in Slack._`;
}

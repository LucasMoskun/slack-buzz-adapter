import path from "node:path";

const REQUIRED_ENV = [
  "SLACK_APP_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_CHANNEL_ID",
  "BUZZ_CHANNEL_ID",
  "BUZZ_PRIVATE_KEY",
];

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    slackAppToken: env.SLACK_APP_TOKEN.trim(),
    slackBotToken: env.SLACK_BOT_TOKEN.trim(),
    slackChannelId: env.SLACK_CHANNEL_ID.trim(),
    buzzChannelId: env.BUZZ_CHANNEL_ID.trim(),
    buzzCli: env.BUZZ_CLI?.trim() || "buzz",
    statePath: path.resolve(cwd, env.STATE_PATH?.trim() || ".data/state.json"),
    adapterLabel: env.ADAPTER_LABEL?.trim() || "Slack mirror",
    logLevel: env.LOG_LEVEL?.trim() || "info",
    backfillOldest: parseSlackTimestamp(env.BACKFILL_OLDEST),
  };
}

export function redactConfig(config) {
  return {
    slackChannelId: config.slackChannelId,
    buzzChannelId: config.buzzChannelId,
    buzzCli: config.buzzCli,
    statePath: config.statePath,
    adapterLabel: config.adapterLabel,
    logLevel: config.logLevel,
    backfillOldest: config.backfillOldest,
  };
}

export function parseSlackTimestamp(value) {
  if (!value?.trim()) return undefined;
  const candidate = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(candidate)) return candidate;

  const milliseconds = Date.parse(candidate);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(
      "BACKFILL_OLDEST must be an ISO-8601 date or Slack timestamp",
    );
  }
  return (milliseconds / 1000).toFixed(6);
}

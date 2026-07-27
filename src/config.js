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

  const config = {
    slackAppToken: env.SLACK_APP_TOKEN.trim(),
    slackBotToken: env.SLACK_BOT_TOKEN.trim(),
    slackChannelId: env.SLACK_CHANNEL_ID.trim(),
    buzzChannelId: env.BUZZ_CHANNEL_ID.trim(),
    buzzCli: env.BUZZ_CLI?.trim() || "buzz",
    statePath: path.resolve(cwd, env.STATE_PATH?.trim() || ".data/state.json"),
    adapterLabel: env.ADAPTER_LABEL?.trim() || "Slack mirror",
    logLevel: env.LOG_LEVEL?.trim() || "info",
    backfillOldest: parseSlackTimestamp(env.BACKFILL_OLDEST),
    copilotSlackUserId: optional(env.COPILOT_SLACK_USER_ID),
    copilotBuzzChannelId: optional(env.COPILOT_BUZZ_CHANNEL_ID),
    copilotAgentName: optional(env.COPILOT_AGENT_NAME),
    copilotAgentPubkey: optional(env.COPILOT_AGENT_PUBKEY),
    copilotHumanPubkey: optional(env.COPILOT_HUMAN_PUBKEY),
    copilotStatePath: path.resolve(
      cwd,
      env.COPILOT_STATE_PATH?.trim() || ".data/copilot-state.json",
    ),
    copilotPollIntervalMs: parsePositiveInteger(
      env.COPILOT_POLL_INTERVAL_MS,
      10_000,
      "COPILOT_POLL_INTERVAL_MS",
    ),
  };
  const partialCopilot =
    Boolean(config.copilotSlackUserId) !==
    Boolean(config.copilotBuzzChannelId);
  if (partialCopilot) {
    throw new Error(
      "COPILOT_SLACK_USER_ID and COPILOT_BUZZ_CHANNEL_ID must be configured together",
    );
  }
  if (config.copilotSlackUserId && !config.copilotAgentName) {
    throw new Error(
      "COPILOT_AGENT_NAME is required when the copilot route is enabled",
    );
  }
  return config;
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
    copilotEnabled: Boolean(config.copilotSlackUserId),
    copilotStatePath: config.copilotStatePath,
    copilotPollIntervalMs: config.copilotPollIntervalMs,
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

function optional(value) {
  return value?.trim() || undefined;
}

function parsePositiveInteger(value, fallback, name) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

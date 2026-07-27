import path from "node:path";
import { loadChannelMappings, mappingIndex } from "./channel-map.js";

const REQUIRED_ENV = [
  "SLACK_APP_TOKEN",
  "SLACK_BOT_TOKEN",
  "BUZZ_PRIVATE_KEY",
];

export function loadConfig(
  env = process.env,
  cwd = process.cwd(),
  { allowMissingMappings = false } = {},
) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const channelMappingsPath = path.resolve(
    cwd,
    env.CHANNEL_MAPPINGS_PATH?.trim() || "channel-mappings.json",
  );
  const channelMappings = loadChannelMappings(channelMappingsPath, {
    allowMissing: allowMissingMappings,
  });
  const config = {
    slackAppToken: env.SLACK_APP_TOKEN.trim(),
    slackBotToken: env.SLACK_BOT_TOKEN.trim(),
    channelMappingsPath,
    channelMappings,
    channelMappingsBySlackId: mappingIndex(channelMappings),
    buzzCli: env.BUZZ_CLI?.trim() || "buzz",
    statePath: path.resolve(cwd, env.STATE_PATH?.trim() || ".data/state.json"),
    syncStatePath: path.resolve(
      cwd,
      env.SYNC_STATE_PATH?.trim() || ".data/channel-sync-state.json",
    ),
    routeRefreshHashPath: path.resolve(
      cwd,
      env.ROUTE_REFRESH_HASH_PATH?.trim() ||
        ".data/channel-sync-applied-hash",
    ),
    channelSyncIntervalMs: parsePositiveInteger(
      env.CHANNEL_SYNC_INTERVAL_MS,
      60_000,
      "CHANNEL_SYNC_INTERVAL_MS",
    ),
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
    mirrorOwnerPubkey: parseOptionalPubkey(
      optional(env.MIRROR_OWNER_PUBKEY) ||
        optional(env.COPILOT_HUMAN_PUBKEY),
      "MIRROR_OWNER_PUBKEY",
    ),
    mirrorAgentPubkeys: parsePubkeyList(
      env.MIRROR_AGENT_PUBKEYS,
      optional(env.COPILOT_AGENT_PUBKEY),
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
    channelMappingsPath: config.channelMappingsPath,
    channelMappings: config.channelMappings.map(
      ({
        slackChannelId,
        slackChannelName,
        buzzChannelId,
        buzzChannelName,
      }) => ({
        slackChannelId,
        slackChannelName,
        buzzChannelId,
        buzzChannelName,
      }),
    ),
    buzzCli: config.buzzCli,
    statePath: config.statePath,
    syncStatePath: config.syncStatePath,
    routeRefreshHashPath: config.routeRefreshHashPath,
    channelSyncIntervalMs: config.channelSyncIntervalMs,
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

function parsePubkeyList(value, fallback) {
  const values = value?.trim()
    ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
    : fallback
      ? [fallback]
      : [];
  for (const pubkey of values) {
    if (!/^[a-f0-9]{64}$/i.test(pubkey)) {
      throw new Error(
        "MIRROR_AGENT_PUBKEYS must contain comma-separated 64-character hex pubkeys",
      );
    }
  }
  return [...new Set(values)];
}

function parseOptionalPubkey(value, name) {
  if (!value) return undefined;
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${name} must be a 64-character hex pubkey`);
  }
  return value;
}

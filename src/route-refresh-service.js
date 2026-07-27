import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  loadChannelMappings,
  mappingIndex,
} from "./channel-map.js";
import { resolveChannelRoutes } from "./channel-routes.js";
import { runBackfill } from "./backfill-service.js";

export async function refreshChannelRoutes({
  config,
  adapter,
  slackClient,
  buzzClient,
  stateStore,
  workspaceId,
  logger,
  runBackfillImpl = runBackfill,
}) {
  const previousRoutes = [...adapter.channelRoutes.values()];
  const previousMappings = config.channelMappings;
  const previousMappingIndex = config.channelMappingsBySlackId;
  const previousSlackIds = new Set(adapter.channelRoutes.keys());
  const channelMappings = loadChannelMappings(config.channelMappingsPath);
  const candidateConfig = {
    ...config,
    channelMappings,
    channelMappingsBySlackId: mappingIndex(channelMappings),
  };

  const channelRoutes = await resolveChannelRoutes({
    config: candidateConfig,
    slackClient,
    buzzClient,
    workspaceId,
    stateStore,
  });
  const addedRoutes = channelRoutes.filter(
    (route) => !previousSlackIds.has(route.slackChannelId),
  );
  const backfills = [];
  config.channelMappings = channelMappings;
  config.channelMappingsBySlackId = candidateConfig.channelMappingsBySlackId;
  adapter.setChannelRoutes(channelRoutes);
  try {
    for (const route of addedRoutes) {
      const stats = await runBackfillImpl({
        adapter,
        slackClient,
        channelId: route.slackChannelId,
        teamId: workspaceId,
        oldest: config.backfillOldest,
        logger,
      });
      backfills.push({
        slackChannelId: route.slackChannelId,
        slackChannelName: route.slackChannelName,
        ...stats,
      });
    }
    recordAppliedMappingHash(
      config.channelMappingsPath,
      config.routeRefreshHashPath,
    );
  } catch (error) {
    config.channelMappings = previousMappings;
    config.channelMappingsBySlackId = previousMappingIndex;
    adapter.setChannelRoutes(previousRoutes);
    throw error;
  }

  return {
    mappedChannels: channelRoutes.length,
    addedChannels: addedRoutes.length,
    backfills,
  };
}

export function recordAppliedMappingHash(mappingPath, hashPath) {
  const hash = mappingHash(mappingPath);
  mkdirSync(path.dirname(hashPath), { recursive: true });
  const temporaryPath = `${hashPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${hash}\n`, { mode: 0o600 });
  renameSync(temporaryPath, hashPath);
  return hash;
}

export function mappingNeedsRefresh(mappingPath, hashPath) {
  let appliedHash;
  try {
    appliedHash = readFileSync(hashPath, "utf8").trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return mappingHash(mappingPath) !== appliedHash;
}

export function mappingHash(mappingPath) {
  return createHash("sha256")
    .update(readFileSync(mappingPath))
    .digest("hex");
}

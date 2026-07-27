import { SlackBuzzAdapter } from "./adapter.js";
import { BuzzClient } from "./buzz-client.js";
import {
  InternalReconciliationLoop,
  runChannelReconciliation,
} from "./channel-reconciler.js";
import { resolveChannelRoutes } from "./channel-routes.js";
import { loadConfig, redactConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { SlackClient } from "./slack-client.js";
import { SlackSocketMode } from "./socket-mode.js";
import { JsonStateStore } from "./state-store.js";
import {
  recordAppliedMappingHash,
} from "./route-refresh-service.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  logger.info("Starting Slack to Buzz adapter", redactConfig(config));

  const slackClient = new SlackClient({
    botToken: config.slackBotToken,
    appToken: config.slackAppToken,
  });
  const buzzClient = new BuzzClient({ executable: config.buzzCli });
  const stateStore = new JsonStateStore(config.statePath);
  await stateStore.acquireLock("live adapter");
  try {
    await stateStore.load();

    const auth = await slackClient.authTest();
    const channelRoutes = await resolveChannelRoutes({
      config,
      slackClient,
      buzzClient,
      workspaceId: auth.team_id,
      stateStore,
    });

    let runtimeConfig = config;
    if (config.copilotSlackUserId) {
      const [directMessage, copilotBuzzChannel] = await Promise.all([
        slackClient.openDirectMessage(config.copilotSlackUserId),
        buzzClient.channelInfo(config.copilotBuzzChannelId),
      ]);
      if (!copilotBuzzChannel?.channel_id) {
        throw new Error(
          "The Buzz publishing identity cannot access COPILOT_BUZZ_CHANNEL_ID",
        );
      }
      const copilotSlackDmId = directMessage.channel?.id;
      if (!copilotSlackDmId) {
        throw new Error("Slack did not return a copilot App Home DM ID");
      }
      runtimeConfig = { ...config, copilotSlackDmId };
      await stateStore.recordConversation(copilotSlackDmId, {
        workspaceId: auth.team_id,
        channelId: copilotSlackDmId,
        audience: "personal_copilot",
        memberUserIds: [config.copilotSlackUserId],
        capturedAt: new Date().toISOString(),
      });
    }

    const adapter = new SlackBuzzAdapter({
      config: runtimeConfig,
      slackClient,
      buzzClient,
      stateStore,
      logger,
      workspaceUrl: auth.url,
      workspaceId: auth.team_id,
      channelRoutes,
    });
    recordAppliedMappingHash(
      runtimeConfig.channelMappingsPath,
      runtimeConfig.routeRefreshHashPath,
    );
    const reconciliationLoop = new InternalReconciliationLoop({
      intervalMs: runtimeConfig.channelSyncIntervalMs,
      logger,
      task: () =>
        runChannelReconciliation({
          config: runtimeConfig,
          adapter,
          slackClient,
          buzzClient,
          stateStore,
          workspaceId: auth.team_id,
          logger,
        }),
    });

    const socketMode = new SlackSocketMode({
      slackClient,
      logger,
      onEnvelope: (payload) => adapter.enqueue(payload),
    });

    const stop = () => {
      logger.info("Stopping Slack to Buzz adapter");
      reconciliationLoop.stop();
      socketMode.stop();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    logger.info("Adapter ready", {
      slackWorkspace: auth.team,
      mappedChannels: channelRoutes.length,
      channelSyncIntervalMs: runtimeConfig.channelSyncIntervalMs,
    });
    reconciliationLoop.start();
    await socketMode.start();
  } finally {
    await stateStore.releaseLock();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      time: new Date().toISOString(),
      level: "error",
      message: "Adapter failed to start",
      error: error.message,
    }),
  );
  process.exitCode = 1;
});

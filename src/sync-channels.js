import { BuzzClient } from "./buzz-client.js";
import { syncChannelMappings } from "./channel-sync-service.js";
import { loadConfig, redactConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { SlackClient } from "./slack-client.js";
import { JsonStateStore } from "./state-store.js";

async function main() {
  const cronMode = process.argv.includes("--cron");
  const config = loadConfig(process.env, process.cwd(), {
    allowMissingMappings: true,
  });
  const logger = createLogger(cronMode ? "warn" : config.logLevel);
  if (!cronMode) {
    logger.info("Reconciling Slack and Buzz channel mappings", {
      ...redactConfig(config),
      mirrorOwnerConfigured: Boolean(config.mirrorOwnerPubkey),
      mirrorAgentCount: config.mirrorAgentPubkeys.length,
    });
  }

  const slackClient = new SlackClient({
    botToken: config.slackBotToken,
    appToken: config.slackAppToken,
  });
  const buzzClient = new BuzzClient({ executable: config.buzzCli });
  const syncStateStore = new JsonStateStore(config.syncStatePath);
  await syncStateStore.acquireLock("channel reconciliation");
  try {
    const auth = await slackClient.authTest();
    const stats = await syncChannelMappings({
      config,
      slackClient,
      buzzClient,
      logger,
    });
    const changes =
      stats.joinedPublicChannels +
      stats.createdBuzzChannels +
      stats.renamedBuzzChannels;
    if (!cronMode || changes > 0) {
      const report = {
        ok: true,
        slackWorkspace: auth.team,
        slackWorkspaceId: auth.team_id,
        mappingFile: config.channelMappingsPath,
        ...stats,
      };
      if (cronMode) delete report.channels;
      console.log(JSON.stringify(report, null, cronMode ? 0 : 2));
    }
  } finally {
    await syncStateStore.releaseLock();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});

import { SlackBuzzAdapter } from "./adapter.js";
import { runBackfill } from "./backfill-service.js";
import { BuzzClient } from "./buzz-client.js";
import { loadConfig, redactConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { SlackClient } from "./slack-client.js";
import { JsonStateStore } from "./state-store.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  logger.info("Starting Slack history backfill", redactConfig(config));

  const slackClient = new SlackClient({
    botToken: config.slackBotToken,
    appToken: config.slackAppToken,
  });
  const buzzClient = new BuzzClient({ executable: config.buzzCli });
  const stateStore = new JsonStateStore(config.statePath);
  await stateStore.acquireLock("history backfill");

  try {
    await stateStore.load();
    const [auth, channelResponse] = await Promise.all([
      slackClient.authTest(),
      slackClient.channelInfo(config.slackChannelId),
      buzzClient.channelInfo(config.buzzChannelId),
    ]);
    const channelName =
      channelResponse.channel?.name || config.slackChannelId;
    const adapter = new SlackBuzzAdapter({
      config,
      slackClient,
      buzzClient,
      stateStore,
      logger,
      workspaceUrl: auth.url,
      channelName,
    });

    const stats = await runBackfill({
      adapter,
      slackClient,
      channelId: config.slackChannelId,
      teamId: auth.team_id,
      oldest: config.backfillOldest,
      logger,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          slackWorkspace: auth.team,
          slackChannel: channelName,
          buzzChannelId: config.buzzChannelId,
          oldest: config.backfillOldest || "all accessible history",
          ...stats,
        },
        null,
        2,
      ),
    );
  } finally {
    await stateStore.releaseLock();
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

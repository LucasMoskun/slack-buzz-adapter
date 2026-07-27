import { SlackBuzzAdapter } from "./adapter.js";
import { runBackfill } from "./backfill-service.js";
import { BuzzClient } from "./buzz-client.js";
import { resolveChannelRoutes } from "./channel-routes.js";
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
    const auth = await slackClient.authTest();
    const channelRoutes = await resolveChannelRoutes({
      config,
      slackClient,
      buzzClient,
      workspaceId: auth.team_id,
      stateStore,
    });
    const adapter = new SlackBuzzAdapter({
      config,
      slackClient,
      buzzClient,
      stateStore,
      logger,
      workspaceUrl: auth.url,
      workspaceId: auth.team_id,
      channelRoutes,
    });

    const channels = [];
    for (const route of channelRoutes) {
      const stats = await runBackfill({
        adapter,
        slackClient,
        channelId: route.slackChannelId,
        teamId: auth.team_id,
        oldest: config.backfillOldest,
        logger,
      });
      channels.push({
        slackChannelId: route.slackChannelId,
        slackChannelName: route.slackChannelName,
        buzzChannelId: route.buzzChannelId,
        ...stats,
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          slackWorkspace: auth.team,
          oldest: config.backfillOldest || "all accessible history",
          channels,
          totals: sumStats(channels),
        },
        null,
        2,
      ),
    );
  } finally {
    await stateStore.releaseLock();
  }
}

function sumStats(channels) {
  const fields = [
    "fetched",
    "created",
    "existing",
    "ignored",
    "duplicate",
    "historyPages",
    "threadPages",
  ];
  return Object.fromEntries(
    fields.map((field) => [
      field,
      channels.reduce((sum, channel) => sum + channel[field], 0),
    ]),
  );
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

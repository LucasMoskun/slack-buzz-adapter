import { SlackBuzzAdapter } from "./adapter.js";
import { BuzzClient } from "./buzz-client.js";
import { loadConfig, redactConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { SlackClient } from "./slack-client.js";
import { SlackSocketMode } from "./socket-mode.js";
import { JsonStateStore } from "./state-store.js";

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

  const socketMode = new SlackSocketMode({
    slackClient,
    logger,
    onEnvelope: (payload) => adapter.enqueue(payload),
  });

  const stop = () => {
    logger.info("Stopping Slack to Buzz adapter");
    socketMode.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  logger.info("Adapter ready", {
    slackWorkspace: auth.team,
    slackChannel: channelName,
    buzzChannelId: config.buzzChannelId,
  });
  await socketMode.start();
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

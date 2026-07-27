import { BuzzClient } from "./buzz-client.js";
import { loadConfig, redactConfig } from "./config.js";
import { CopilotDeliveryService } from "./copilot-delivery-service.js";
import { createLogger } from "./logger.js";
import { SlackClient } from "./slack-client.js";
import { JsonStateStore } from "./state-store.js";

async function main() {
  const config = loadConfig();
  requireDeliveryConfig(config);
  const logger = createLogger(config.logLevel);
  logger.info("Starting approved copilot delivery worker", redactConfig(config));

  const slackClient = new SlackClient({
    botToken: config.slackBotToken,
    appToken: config.slackAppToken,
  });
  const buzzClient = new BuzzClient({ executable: config.buzzCli });
  const stateStore = new JsonStateStore(config.copilotStatePath);
  await stateStore.acquireLock("copilot delivery");

  let stopped = false;
  const stop = () => {
    stopped = true;
    logger.info("Stopping approved copilot delivery worker");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await stateStore.load();
    const [, directMessage, copilotBuzzChannel] = await Promise.all([
      slackClient.authTest(),
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
    const runtimeConfig = { ...config, copilotSlackDmId };
    const service = new CopilotDeliveryService({
      config: runtimeConfig,
      slackClient,
      buzzClient,
      stateStore,
      logger,
    });

    while (!stopped) {
      try {
        const stats = await service.runOnce();
        if (stats.delivered > 0) {
          logger.info("Copilot delivery pass complete", stats);
        }
      } catch (error) {
        logger.error("Copilot delivery pass failed", { error: error.message });
      }
      if (!stopped) await wait(config.copilotPollIntervalMs);
    }
  } finally {
    await stateStore.releaseLock();
  }
}

function requireDeliveryConfig(config) {
  const missing = [
    ["COPILOT_SLACK_USER_ID", config.copilotSlackUserId],
    ["COPILOT_BUZZ_CHANNEL_ID", config.copilotBuzzChannelId],
    ["COPILOT_AGENT_PUBKEY", config.copilotAgentPubkey],
    ["COPILOT_APPROVER_PUBKEY", config.copilotApproverPubkey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Missing required copilot delivery variables: ${missing.join(", ")}`,
    );
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      time: new Date().toISOString(),
      level: "error",
      message: "Copilot delivery worker failed to start",
      error: error.message,
    }),
  );
  process.exitCode = 1;
});

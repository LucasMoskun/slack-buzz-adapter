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
  await stateStore.acquireLock("live adapter");
  try {
    await stateStore.load();

    const [auth, channelResponse, buzzChannel] = await Promise.all([
      slackClient.authTest(),
      slackClient.channelInfo(config.slackChannelId),
      buzzClient.channelInfo(config.buzzChannelId),
    ]);
    if (!buzzChannel?.channel_id) {
      throw new Error(
        "The Buzz publishing identity cannot access BUZZ_CHANNEL_ID",
      );
    }

    const evidenceChannel = channelResponse.channel ?? {};
    if (evidenceChannel.is_im || evidenceChannel.is_mpim) {
      throw new Error(
        "SLACK_CHANNEL_ID must identify a public or private channel, never a DM or multi-person DM",
      );
    }
    const memberUserIds = await slackClient.channelMembers(
      config.slackChannelId,
    );
    if (
      evidenceChannel.is_private &&
      config.copilotSlackUserId &&
      !memberUserIds.includes(config.copilotSlackUserId)
    ) {
      throw new Error(
        "The configured copilot human is not a member of the private evidence channel",
      );
    }
    await stateStore.recordConversation(config.slackChannelId, {
      workspaceId: auth.team_id,
      channelId: config.slackChannelId,
      name: evidenceChannel.name || config.slackChannelId,
      audience: evidenceChannel.is_private
        ? "private_channel"
        : "public_channel",
      memberUserIds,
      capturedAt: new Date().toISOString(),
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

    const channelName =
      channelResponse.channel?.name || config.slackChannelId;
    const adapter = new SlackBuzzAdapter({
      config: runtimeConfig,
      slackClient,
      buzzClient,
      stateStore,
      logger,
      workspaceUrl: auth.url,
      channelName,
      workspaceId: auth.team_id,
      evidenceAudience: evidenceChannel.is_private
        ? "private_channel"
        : "public_channel",
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

import { BuzzClient } from "./buzz-client.js";
import { resolveChannelRoutes } from "./channel-routes.js";
import { loadConfig, redactConfig } from "./config.js";
import { SlackClient } from "./slack-client.js";

async function main() {
  const config = loadConfig();
  const slack = new SlackClient({
    botToken: config.slackBotToken,
    appToken: config.slackAppToken,
  });
  const buzz = new BuzzClient({ executable: config.buzzCli });

  const [auth, socket] = await Promise.all([
    slack.authTest(),
    slack.openSocket(),
  ]);
  const channelRoutes = await resolveChannelRoutes({
    config,
    slackClient: slack,
    buzzClient: buzz,
    workspaceId: auth.team_id,
  });

  const report = {
    ok: true,
    config: redactConfig(config),
    slack: {
      workspace: auth.team,
      workspaceId: auth.team_id,
      botUserId: auth.user_id,
      socketMode: Boolean(socket.url),
    },
    channelMappings: channelRoutes.map((route) => ({
      slackChannelId: route.slackChannelId,
      slackChannelName: route.slackChannelName,
      audience: route.evidenceAudience,
      slackMemberCount: route.memberUserIds.length,
      buzzChannelId: route.buzzChannelId,
      buzzChannelName: route.buzzChannelName,
    })),
  };
  if (config.copilotSlackUserId) {
    const [directMessage, copilotBuzzChannel] = await Promise.all([
      slack.openDirectMessage(config.copilotSlackUserId),
      buzz.channelInfo(config.copilotBuzzChannelId),
    ]);
    if (!copilotBuzzChannel?.channel_id) {
      throw new Error(
        "The Buzz publishing identity cannot access COPILOT_BUZZ_CHANNEL_ID",
      );
    }
    report.copilot = {
      enabled: true,
      slackUserId: config.copilotSlackUserId,
      slackDirectMessageId: directMessage.channel?.id,
      buzzChannelId: config.copilotBuzzChannelId,
      buzzChannelName: copilotBuzzChannel.name,
      deliveryConfigured: Boolean(
        config.copilotAgentPubkey && config.copilotHumanPubkey,
      ),
    };
  }
  console.log(JSON.stringify(report, null, 2));
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

import { BuzzClient } from "./buzz-client.js";
import { loadConfig, redactConfig } from "./config.js";
import { SlackClient } from "./slack-client.js";

async function main() {
  const config = loadConfig();
  const slack = new SlackClient({
    botToken: config.slackBotToken,
    appToken: config.slackAppToken,
  });
  const buzz = new BuzzClient({ executable: config.buzzCli });

  const [auth, channel, socket, buzzChannel] = await Promise.all([
    slack.authTest(),
    slack.channelInfo(config.slackChannelId),
    slack.openSocket(),
    buzz.channelInfo(config.buzzChannelId),
  ]);
  if (!buzzChannel?.channel_id) {
    throw new Error(
      "The Buzz publishing identity cannot access BUZZ_CHANNEL_ID",
    );
  }

  const report = {
    ok: true,
    config: redactConfig(config),
    slack: {
      workspace: auth.team,
      workspaceId: auth.team_id,
      botUserId: auth.user_id,
      channel: channel.channel?.name,
      channelId: channel.channel?.id,
      isPrivate: channel.channel?.is_private,
      isDirectMessage: Boolean(channel.channel?.is_im),
      isMultiPersonDirectMessage: Boolean(channel.channel?.is_mpim),
      socketMode: Boolean(socket.url),
    },
    buzz: {
      channelId: config.buzzChannelId,
      channelName: buzzChannel.name,
      visibility: buzzChannel.visibility,
    },
  };
  if (channel.channel?.is_im || channel.channel?.is_mpim) {
    throw new Error(
      "SLACK_CHANNEL_ID must identify a public or private channel, never a DM or multi-person DM",
    );
  }
  if (config.copilotSlackUserId) {
    const [members, directMessage, copilotBuzzChannel] = await Promise.all([
      slack.channelMembers(config.slackChannelId),
      slack.openDirectMessage(config.copilotSlackUserId),
      buzz.channelInfo(config.copilotBuzzChannelId),
    ]);
    if (!copilotBuzzChannel?.channel_id) {
      throw new Error(
        "The Buzz publishing identity cannot access COPILOT_BUZZ_CHANNEL_ID",
      );
    }
    if (
      channel.channel?.is_private &&
      !members.includes(config.copilotSlackUserId)
    ) {
      throw new Error(
        "The configured copilot human is not a member of the private evidence channel",
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

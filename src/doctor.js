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
      socketMode: Boolean(socket.url),
    },
    buzz: {
      channelId: config.buzzChannelId,
      channelName: buzzChannel.name,
      visibility: buzzChannel.visibility,
    },
  };
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

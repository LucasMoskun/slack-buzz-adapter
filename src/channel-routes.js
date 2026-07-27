export async function resolveChannelRoutes({
  config,
  slackClient,
  buzzClient,
  workspaceId,
  stateStore,
}) {
  const routes = await Promise.all(
    config.channelMappings.map(async (mapping) => {
      const [channelResponse, buzzChannel, memberUserIds] = await Promise.all([
        slackClient.channelInfo(mapping.slackChannelId),
        buzzClient.channelInfo(mapping.buzzChannelId),
        slackClient.channelMembers(mapping.slackChannelId),
      ]);
      const slackChannel = channelResponse.channel ?? {};
      if (slackChannel.is_im || slackChannel.is_mpim) {
        throw new Error(
          `Mapped Slack source ${mapping.slackChannelId} is a DM or multi-person DM`,
        );
      }
      if (!buzzChannel?.channel_id) {
        throw new Error(
          `The Buzz publishing identity cannot access mapped channel ${mapping.buzzChannelId}`,
        );
      }
      if (
        slackChannel.is_private &&
        config.copilotSlackUserId &&
        !memberUserIds.includes(config.copilotSlackUserId)
      ) {
        throw new Error(
          `The configured copilot human is not a member of private source ${mapping.slackChannelId}`,
        );
      }

      const route = {
        ...mapping,
        slackChannelName:
          slackChannel.name || mapping.slackChannelName,
        buzzChannelName: buzzChannel.name || mapping.buzzChannelName,
        evidenceAudience: slackChannel.is_private
          ? "private_channel"
          : "public_channel",
        memberUserIds,
      };
      return route;
    }),
  );
  if (stateStore) {
    for (const route of routes) {
      await stateStore.recordConversation(route.slackChannelId, {
        workspaceId,
        channelId: route.slackChannelId,
        name: route.slackChannelName,
        audience: route.evidenceAudience,
        memberUserIds: route.memberUserIds,
        capturedAt: new Date().toISOString(),
      });
    }
  }
  return routes;
}

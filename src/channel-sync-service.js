import {
  mappingIndex,
  saveChannelMappings,
} from "./channel-map.js";

export async function syncChannelMappings({
  config,
  slackClient,
  buzzClient,
  logger,
}) {
  if (!config.mirrorOwnerPubkey) {
    throw new Error(
      "MIRROR_OWNER_PUBKEY or COPILOT_HUMAN_PUBKEY is required to create mirror channels",
    );
  }

  const allowedChannelIds = new Set(config.slackAllowedChannelIds ?? []);
  if (allowedChannelIds.size === 0) {
    throw new Error(
      "SLACK_ALLOWED_CHANNEL_IDS must contain at least one channel before reconciliation",
    );
  }
  const deniedChannelNames = new Set(config.slackDeniedChannelNames ?? []);
  const disallowedMappings = config.channelMappings.filter(
    (mapping) => !allowedChannelIds.has(mapping.slackChannelId),
  );
  if (disallowedMappings.length > 0) {
    throw new Error(
      `Existing mappings are outside SLACK_ALLOWED_CHANNEL_IDS: ${disallowedMappings
        .map((mapping) => mapping.slackChannelId)
        .join(", ")}`,
    );
  }

  const discovered = (await slackClient.listConversations())
    .filter(
      (channel) =>
        channel.id &&
        allowedChannelIds.has(channel.id) &&
        !deniedChannelNames.has(normalizeSlackChannelName(channel.name)) &&
        !channel.is_archived &&
        !channel.is_im &&
        !channel.is_mpim,
    )
    .sort((left, right) =>
      String(left.name || left.id).localeCompare(
        String(right.name || right.id),
      ),
    );
  let joinedPublicChannels = 0;
  for (const channel of discovered) {
    if (!channel.is_private && !channel.is_member) {
      await slackClient.joinChannel(channel.id);
      channel.is_member = true;
      joinedPublicChannels += 1;
      logger?.info("Joined public Slack source channel", {
        slackChannelId: channel.id,
        slackChannelName: channel.name,
      });
    }
  }

  const mappings = [...config.channelMappings];
  const bySlackId = mappingIndex(mappings);
  let createdBuzzChannels = 0;
  let renamedBuzzChannels = 0;
  let retainedMappings = 0;

  for (const channel of discovered) {
    const sourceName = channel.name || channel.id;
    const buzzName = `${config.buzzChannelPrefix ?? ""}${sourceName}`;
    let mapping = bySlackId.get(channel.id);
    if (!mapping) {
      const result = await buzzClient.createPrivateChannel(
        buzzName,
        `Read-only mirror of Slack #${sourceName}`,
      );
      if (!result.channel_id) {
        throw new Error(
          `Buzz did not return a channel ID for Slack source ${channel.id}`,
        );
      }
      mapping = {
        slackChannelId: channel.id,
        slackChannelName: sourceName,
        buzzChannelId: result.channel_id,
        buzzChannelName: buzzName,
      };
      mappings.push(mapping);
      bySlackId.set(channel.id, mapping);
      saveChannelMappings(config.channelMappingsPath, mappings);
      createdBuzzChannels += 1;
      logger?.info("Created private Buzz mirror channel", mapping);
    } else {
      const buzzChannel = await buzzClient.channelInfo(mapping.buzzChannelId);
      if (!buzzChannel?.channel_id) {
        throw new Error(
          `The Buzz publishing identity cannot access mapped channel ${mapping.buzzChannelId}`,
        );
      }
      if (buzzChannel.name !== buzzName) {
        await buzzClient.updateChannelName(
          mapping.buzzChannelId,
          buzzName,
        );
        renamedBuzzChannels += 1;
        logger?.info("Renamed Buzz mirror to match Slack source", {
          slackChannelId: channel.id,
          slackChannelName: sourceName,
          buzzChannelId: mapping.buzzChannelId,
          previousBuzzChannelName: buzzChannel.name,
          buzzChannelName: buzzName,
        });
      }
      mapping.slackChannelName = sourceName;
      mapping.buzzChannelName = buzzName;
      retainedMappings += 1;
    }

    await ensureMirrorMembers({
      buzzClient,
      buzzChannelId: mapping.buzzChannelId,
      ownerPubkey: config.mirrorOwnerPubkey,
      agentPubkeys: config.mirrorAgentPubkeys,
    });
  }

  saveChannelMappings(config.channelMappingsPath, mappings);
  return {
    discoveredChannels: discovered.length,
    publicChannels: discovered.filter((channel) => !channel.is_private).length,
    visiblePrivateChannels: discovered.filter((channel) => channel.is_private)
      .length,
    joinedPublicChannels,
    createdBuzzChannels,
    renamedBuzzChannels,
    retainedMappings,
    totalMappings: mappings.length,
    channels: mappings,
  };
}

function normalizeSlackChannelName(value = "") {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureMirrorMembers({
  buzzClient,
  buzzChannelId,
  ownerPubkey,
  agentPubkeys,
}) {
  const members = await buzzClient.channelMembers(buzzChannelId);
  const memberPubkeys = new Set(
    members.map((member) => member.pubkey).filter(Boolean),
  );
  if (!memberPubkeys.has(ownerPubkey)) {
    await buzzClient.addChannelMember(
      buzzChannelId,
      ownerPubkey,
      "owner",
    );
    memberPubkeys.add(ownerPubkey);
  }
  for (const pubkey of agentPubkeys) {
    if (!memberPubkeys.has(pubkey)) {
      await buzzClient.addChannelMember(buzzChannelId, pubkey, "bot");
      memberPubkeys.add(pubkey);
    }
  }
}

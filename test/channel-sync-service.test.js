import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadChannelMappings,
  saveChannelMappings,
} from "../src/channel-map.js";
import { syncChannelMappings } from "../src/channel-sync-service.js";

const OWNER = "a".repeat(64);
const AGENT = "b".repeat(64);

test("joins public sources and creates one private Buzz channel per source", async () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "slack-buzz-channel-sync-"),
  );
  const mappingPath = path.join(directory, "channel-mappings.json");
  saveChannelMappings(mappingPath, [
    {
      slackChannelId: "C1",
      slackChannelName: "existing",
      buzzChannelId: "buzz-1",
      buzzChannelName: "slack-existing",
    },
  ]);
  const calls = [];
  const memberships = new Map([
    [
      "buzz-1",
      [
        { pubkey: OWNER, role: "owner" },
        { pubkey: AGENT, role: "bot" },
      ],
    ],
  ]);
  const slackClient = {
    async listConversations() {
      return [
        {
          id: "C1",
          name: "existing-renamed",
          is_private: false,
          is_member: true,
        },
        {
          id: "C2",
          name: "new-public",
          is_private: false,
          is_member: false,
        },
        {
          id: "G1",
          name: "visible-private",
          is_private: true,
          is_member: true,
        },
      ];
    },
    async joinChannel(channelId) {
      calls.push(["join", channelId]);
    },
  };
  let nextBuzzId = 2;
  const buzzClient = {
    async channelInfo(channelId) {
      return { channel_id: channelId, name: "slack-existing" };
    },
    async createPrivateChannel(name) {
      const channelId = `buzz-${nextBuzzId++}`;
      calls.push(["create", name, channelId]);
      memberships.set(channelId, []);
      return { channel_id: channelId };
    },
    async updateChannelName(channelId, name) {
      calls.push(["rename", channelId, name]);
      return { accepted: true };
    },
    async channelMembers(channelId) {
      return memberships.get(channelId) ?? [];
    },
    async addChannelMember(channelId, pubkey, role) {
      calls.push(["add", channelId, pubkey, role]);
      memberships.get(channelId).push({ pubkey, role });
      return { accepted: true };
    },
  };

  const stats = await syncChannelMappings({
    config: {
      channelMappingsPath: mappingPath,
      channelMappings: loadChannelMappings(mappingPath),
      slackAllowedChannelIds: ["C1", "C2", "G1"],
      slackDeniedChannelNames: [],
      buzzChannelPrefix: "mlf-",
      mirrorOwnerPubkey: OWNER,
      mirrorAgentPubkeys: [AGENT],
    },
    slackClient,
    buzzClient,
  });

  assert.deepEqual(calls[0], ["join", "C2"]);
  assert.equal(stats.discoveredChannels, 3);
  assert.equal(stats.joinedPublicChannels, 1);
  assert.equal(stats.createdBuzzChannels, 2);
  assert.equal(stats.renamedBuzzChannels, 1);
  const mappings = loadChannelMappings(mappingPath);
  assert.equal(mappings.length, 3);
  assert.equal(
    mappings.find((mapping) => mapping.slackChannelId === "C1")
      .slackChannelName,
    "existing-renamed",
  );
  assert.equal(
    mappings.find((mapping) => mapping.slackChannelId === "C1")
      .buzzChannelName,
    "mlf-existing-renamed",
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "create" &&
        call[1] === "mlf-new-public",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "rename" &&
        call[1] === "buzz-1" &&
        call[2] === "mlf-existing-renamed",
    ),
  );
  assert.equal(
    memberships.get("buzz-2").find((member) => member.pubkey === OWNER)
      .role,
    "owner",
  );
  assert.equal(
    memberships.get("buzz-2").find((member) => member.pubkey === AGENT)
      .role,
    "bot",
  );
});

test("never joins or mirrors channels outside the explicit allowlist", async () => {
  const calls = [];
  const stats = await syncChannelMappings({
    config: {
      channelMappingsPath: path.join(
        mkdtempSync(path.join(os.tmpdir(), "slack-buzz-allowlist-")),
        "channel-mappings.json",
      ),
      channelMappings: [],
      slackAllowedChannelIds: ["C1"],
      slackDeniedChannelNames: ["partners"],
      mirrorOwnerPubkey: OWNER,
      mirrorAgentPubkeys: [],
    },
    slackClient: {
      async listConversations() {
        return [
          { id: "C1", name: "Partners", is_private: false, is_member: false },
          { id: "C2", name: "general", is_private: false, is_member: false },
        ];
      },
      async joinChannel(channelId) {
        calls.push(["join", channelId]);
      },
    },
    buzzClient: {
      async createPrivateChannel(name) {
        calls.push(["create", name]);
        return { channel_id: "unexpected" };
      },
    },
  });

  assert.equal(stats.discoveredChannels, 0);
  assert.deepEqual(calls, []);
});

test("fails closed when an existing mapping leaves the allowlist", async () => {
  await assert.rejects(
    () =>
      syncChannelMappings({
        config: {
          channelMappings: [{ slackChannelId: "C2" }],
          slackAllowedChannelIds: ["C1"],
          mirrorOwnerPubkey: OWNER,
          mirrorAgentPubkeys: [],
        },
      }),
    /Existing mappings are outside SLACK_ALLOWED_CHANNEL_IDS: C2/,
  );
});

test("requires an explicit human owner before creating mirrors", async () => {
  await assert.rejects(
    () =>
      syncChannelMappings({
        config: {
          channelMappings: [],
          mirrorAgentPubkeys: [],
        },
      }),
    /MIRROR_OWNER_PUBKEY/,
  );
});

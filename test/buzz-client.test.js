import assert from "node:assert/strict";
import test from "node:test";
import { BuzzClient } from "../src/buzz-client.js";

test("publishes content over stdin without invoking a shell", async () => {
  const calls = [];
  const client = new BuzzClient({
    executable: "/opt/buzz",
    runner: async (executable, args, options) => {
      calls.push({ executable, args, options });
      return JSON.stringify({ accepted: true, event_id: "a".repeat(64) });
    },
  });

  const result = await client.sendMessage("channel-1", "hello\n\nworld", "parent");

  assert.equal(result.accepted, true);
  assert.deepEqual(calls[0], {
    executable: "/opt/buzz",
    args: [
      "messages",
      "send",
      "--channel",
      "channel-1",
      "--content",
      "-",
      "--reply-to",
      "parent",
    ],
    options: { input: "hello\n\nworld" },
  });
});

test("reads a bounded copilot conversation", async () => {
  const calls = [];
  const client = new BuzzClient({
    executable: "/opt/buzz",
    runner: async (executable, args) => {
      calls.push({ executable, args });
      return JSON.stringify([{ id: "event-1", content: "draft" }]);
    },
  });

  const events = await client.getMessages("copilot-channel", 50);

  assert.equal(events[0].id, "event-1");
  assert.deepEqual(calls[0].args, [
    "messages",
    "get",
    "--channel",
    "copilot-channel",
    "--limit",
    "50",
  ]);
});

test("creates private mirror channels and manages their members", async () => {
  const calls = [];
  const responses = [
    { accepted: true, channel_id: "buzz-1" },
    { accepted: true },
    [{ pubkey: "a".repeat(64), role: "owner" }],
    { accepted: true },
  ];
  const client = new BuzzClient({
    runner: async (executable, args) => {
      calls.push({ executable, args });
      return JSON.stringify(responses.shift());
    },
  });

  const created = await client.createPrivateChannel(
    "alpha",
    "Read-only mirror",
  );
  await client.updateChannelName("buzz-1", "alpha-renamed");
  const members = await client.channelMembers("buzz-1");
  await client.addChannelMember(
    "buzz-1",
    "b".repeat(64),
    "bot",
  );

  assert.equal(created.channel_id, "buzz-1");
  assert.equal(members[0].role, "owner");
  assert.deepEqual(calls[0].args, [
    "channels",
    "create",
    "--name",
    "alpha",
    "--type",
    "stream",
    "--visibility",
    "private",
    "--description",
    "Read-only mirror",
  ]);
  assert.deepEqual(calls[1].args, [
    "channels",
    "update",
    "--channel",
    "buzz-1",
    "--name",
    "alpha-renamed",
  ]);
  assert.deepEqual(calls[3].args, [
    "channels",
    "add-member",
    "--channel",
    "buzz-1",
    "--pubkey",
    "b".repeat(64),
    "--role",
    "bot",
  ]);
});

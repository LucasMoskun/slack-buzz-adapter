import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SlackBuzzAdapter } from "../src/adapter.js";
import { JsonStateStore } from "../src/state-store.js";

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

async function createHarness() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "slack-buzz-adapter-"));
  const stateStore = new JsonStateStore(path.join(directory, "state.json"));
  await stateStore.load();

  const sends = [];
  const edits = [];
  const buzzClient = {
    async sendMessage(channelId, content, replyTo) {
      const eventId = `${sends.length + 1}`.padStart(64, "a");
      sends.push({ channelId, content, replyTo, eventId });
      return { event_id: eventId };
    },
    async editMessage(eventId, content) {
      edits.push({ eventId, content });
      return { event_id: eventId };
    },
  };
  const slackClient = {
    async userDisplayName(userId) {
      return userId === "U1" ? "Ada" : userId;
    },
  };
  const adapter = new SlackBuzzAdapter({
    config: {
      slackChannelId: "C1",
      buzzChannelId: "buzz-1",
      adapterLabel: "Slack mirror",
    },
    slackClient,
    buzzClient,
    stateStore,
    logger: createLogger(),
    workspaceUrl: "https://demo.slack.com",
    channelName: "demo",
  });
  return { adapter, sends, edits, stateStore };
}

function payload(eventId, event) {
  return {
    type: "event_callback",
    team_id: "T1",
    event_id: eventId,
    authorizations: [{ team_id: "T1" }],
    event,
  };
}

test("mirrors a message exactly once", async () => {
  const { adapter, sends } = await createHarness();
  const event = payload("Ev1", {
    type: "message",
    channel: "C1",
    user: "U1",
    ts: "1722070800.123456",
    text: "Hello Buzz",
  });

  await adapter.processPayload(event);
  await adapter.processPayload(event);

  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /Ada/);
  assert.match(sends[0].content, /Hello Buzz/);
});

test("maps Slack thread replies to the mirrored Buzz parent", async () => {
  const { adapter, sends } = await createHarness();
  await adapter.processPayload(
    payload("Ev1", {
      type: "message",
      channel: "C1",
      user: "U1",
      ts: "100.000001",
      text: "Parent",
    }),
  );
  await adapter.processPayload(
    payload("Ev2", {
      type: "message",
      channel: "C1",
      user: "U1",
      ts: "101.000001",
      thread_ts: "100.000001",
      text: "Reply",
    }),
  );

  assert.equal(sends.length, 2);
  assert.equal(sends[1].replyTo, sends[0].eventId);
});

test("edits and deletions update the existing Buzz message", async () => {
  const { adapter, sends, edits } = await createHarness();
  await adapter.processPayload(
    payload("Ev1", {
      type: "message",
      channel: "C1",
      user: "U1",
      ts: "100.000001",
      text: "Original",
    }),
  );
  await adapter.processPayload(
    payload("Ev2", {
      type: "message",
      subtype: "message_changed",
      channel: "C1",
      message: {
        type: "message",
        user: "U1",
        ts: "100.000001",
        text: "Updated",
      },
    }),
  );
  await adapter.processPayload(
    payload("Ev3", {
      type: "message",
      subtype: "message_deleted",
      channel: "C1",
      deleted_ts: "100.000001",
    }),
  );

  assert.equal(sends.length, 1);
  assert.equal(edits.length, 2);
  assert.equal(edits[0].eventId, sends[0].eventId);
  assert.match(edits[0].content, /Updated/);
  assert.match(edits[1].content, /Deleted in Slack/);
});

test("ignores messages from unmapped Slack channels", async () => {
  const { adapter, sends, stateStore } = await createHarness();
  await adapter.processPayload(
    payload("EvOther", {
      type: "message",
      channel: "C2",
      user: "U1",
      ts: "100.000001",
      text: "Not mapped",
    }),
  );

  assert.equal(sends.length, 0);
  assert.equal(stateStore.hasEvent("EvOther"), true);
});

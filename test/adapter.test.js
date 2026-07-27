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

async function createHarness(configOverrides = {}) {
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
    async userProfile(userId) {
      return {
        userId,
        displayName: userId === "U1" ? "Ada" : userId,
        isBot: false,
        isGuest: false,
        isDeleted: false,
      };
    },
    async userDisplayName(userId) {
      return userId === "U1" ? "Ada" : userId;
    },
  };
  const adapter = new SlackBuzzAdapter({
    config: {
      channelMappingsBySlackId: new Map([["C1", {}]]),
      adapterLabel: "Slack mirror",
      ...configOverrides,
    },
    slackClient,
    buzzClient,
    stateStore,
    logger: createLogger(),
    workspaceUrl: "https://demo.slack.com",
    workspaceId: "T1",
    channelRoutes: [
      {
        slackChannelId: "C1",
        slackChannelName: "demo",
        buzzChannelId: "buzz-1",
        buzzChannelName: "slack-demo",
        evidenceAudience: "private_channel",
      },
    ],
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

test("routes different Slack channels to their mapped Buzz channels", async () => {
  const { adapter, sends } = await createHarness();
  adapter.config.channelMappingsBySlackId.set("C2", {});
  adapter.channelRoutes.set("C2", {
    slackChannelId: "C2",
    slackChannelName: "second",
    buzzChannelId: "buzz-2",
    evidenceAudience: "public_channel",
  });

  await adapter.processPayload(
    payload("EvSecond", {
      type: "message",
      channel: "C2",
      user: "U1",
      ts: "200.000001",
      text: "Second channel",
    }),
  );

  assert.equal(sends[0].channelId, "buzz-2");
  assert.match(sends[0].content, /#second/);
  assert.equal(
    adapter.stateStore.getMessage("C2:200.000001").source.audience,
    "public_channel",
  );
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

test("excludes other DMs before state or message persistence", async () => {
  const { adapter, sends, stateStore } = await createHarness({
    copilotSlackUserId: "U1",
    copilotSlackDmId: "D-COPILOT",
    copilotBuzzChannelId: "buzz-copilot",
    copilotAgentName: "Ada's Research Copilot",
  });

  const result = await adapter.processPayload(
    payload("EvPrivate", {
      type: "message",
      channel: "D-OTHER",
      channel_type: "im",
      user: "U1",
      ts: "100.000001",
      text: "Never ingest this",
    }),
  );

  assert.equal(result, "excluded");
  assert.equal(sends.length, 0);
  assert.equal(stateStore.hasEvent("EvPrivate"), false);
  assert.equal(stateStore.getMessage("D-OTHER:100.000001"), undefined);
  assert.equal(stateStore.getActor("T1:U1"), undefined);
});

test("routes the exact human-copilot DM to the private Buzz inbox", async () => {
  const { adapter, sends, stateStore } = await createHarness({
    copilotSlackUserId: "U1",
    copilotSlackDmId: "D-COPILOT",
    copilotBuzzChannelId: "buzz-copilot",
    copilotAgentName: "Ada's Research Copilot",
  });

  const result = await adapter.processPayload(
    payload("EvCopilot", {
      type: "message",
      channel: "D-COPILOT",
      channel_type: "im",
      user: "U1",
      ts: "100.000001",
      text: "Help me prepare the cited update",
    }),
  );

  assert.equal(result, "created");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].channelId, "buzz-copilot");
  assert.match(sends[0].content, /private copilot inbox/);
  assert.match(sends[0].content, /@Ada's Research Copilot/);
  assert.match(sends[0].content, /do not promote into shared findings/);
  assert.equal(
    stateStore.getMessage("D-COPILOT:100.000001").source.audience,
    "personal_copilot",
  );
});

test("records stable actor and audience metadata for evidence", async () => {
  const { adapter, stateStore } = await createHarness();

  await adapter.processPayload(
    payload("EvEvidence", {
      type: "message",
      channel: "C1",
      channel_type: "group",
      user: "U1",
      ts: "100.000001",
      text: "Private-channel evidence",
    }),
  );

  const stored = stateStore.getMessage("C1:100.000001");
  assert.equal(stored.source.workspaceId, "T1");
  assert.equal(stored.source.slackUserId, "U1");
  assert.equal(stored.source.audience, "private_channel");
  assert.equal(stateStore.getActor("T1:U1").displayName, "Ada");
});

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CopilotDeliveryService } from "../src/copilot-delivery-service.js";
import { JsonStateStore } from "../src/state-store.js";

const AGENT = "a".repeat(64);
const APPROVER = "b".repeat(64);

function logger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

async function harness(events) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "copilot-delivery-"));
  const stateStore = new JsonStateStore(path.join(directory, "state.json"));
  await stateStore.load();
  const posts = [];
  const service = new CopilotDeliveryService({
    config: {
      copilotBuzzChannelId: "buzz-copilot",
      copilotSlackUserId: "U1",
      copilotAgentPubkey: AGENT,
      copilotApproverPubkey: APPROVER,
    },
    buzzClient: {
      async getMessages(channelId, limit) {
        assert.equal(channelId, "buzz-copilot");
        assert.equal(limit, 200);
        return events;
      },
      async getReactions() {
        return { reactions: [] };
      },
    },
    slackClient: {
      async postMessage(channelId, text) {
        posts.push({ channelId, text });
        return { ok: true, channel: "D1", ts: "100.000001" };
      },
    },
    stateStore,
    logger: logger(),
  });
  return { service, posts, stateStore };
}

test("delivers a cited agent suggestion after explicit human approval once", async () => {
  const suggestion = {
    id: "suggestion-1",
    pubkey: AGENT,
    content:
      "Project Omega has a blocker. [source](https://demo.slack.com/archives/C1/p100000001)",
    tags: [],
  };
  const approval = {
    id: "approval-1",
    pubkey: APPROVER,
    content: "/approve",
    tags: [["e", suggestion.id, "", "reply"]],
  };
  const { service, posts, stateStore } = await harness([
    suggestion,
    approval,
  ]);

  const first = await service.runOnce();
  const second = await service.runOnce();

  assert.equal(first.delivered, 1);
  assert.equal(second.alreadyDelivered, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channelId, "U1");
  assert.match(posts[0].text, /Suggestion from your Buzz research copilot/);
  assert.equal(
    stateStore.getDelivery(suggestion.id).approvalEventId,
    approval.id,
  );
});

test("accepts a check-mark reaction from the configured approver", async () => {
  const suggestion = {
    id: "suggestion-1",
    pubkey: AGENT,
    content:
      "Project Omega has a blocker. [source](https://demo.slack.com/archives/C1/p100000001)",
    tags: [],
  };
  const { service, posts } = await harness([suggestion]);
  service.config.copilotSlackDmId = "D1";
  service.buzzClient.getReactions = async () => ({
    reactions: [{ emoji: "✅", count: 1, pubkeys: [APPROVER] }],
  });

  const stats = await service.runOnce();

  assert.equal(stats.approvals, 1);
  assert.equal(stats.delivered, 1);
  assert.equal(posts[0].channelId, "D1");
});

test("refuses uncited suggestions and approvals from another identity", async () => {
  const suggestion = {
    id: "suggestion-1",
    pubkey: AGENT,
    content: "Unsupported claim",
    tags: [],
  };
  const approvals = [
    {
      id: "approval-wrong",
      pubkey: "c".repeat(64),
      content: "/approve",
      tags: [["e", suggestion.id, "", "reply"]],
    },
    {
      id: "approval-right",
      pubkey: APPROVER,
      content: "/approve",
      tags: [["e", suggestion.id, "", "reply"]],
    },
  ];
  const { service, posts } = await harness([suggestion, ...approvals]);

  const stats = await service.runOnce();

  assert.equal(stats.approvals, 1);
  assert.equal(stats.invalid, 1);
  assert.equal(stats.delivered, 0);
  assert.equal(posts.length, 0);
});

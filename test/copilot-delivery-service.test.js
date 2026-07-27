import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CopilotDeliveryService } from "../src/copilot-delivery-service.js";
import { JsonStateStore } from "../src/state-store.js";

const AGENT = "a".repeat(64);
const HUMAN = "b".repeat(64);

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
      copilotSlackDmId: "D1",
      copilotAgentPubkey: AGENT,
      copilotHumanPubkey: HUMAN,
    },
    buzzClient: {
      async getMessages(channelId, limit) {
        assert.equal(channelId, "buzz-copilot");
        assert.equal(limit, 200);
        return events;
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

test("automatically delivers a cited reply to the paired Slack request once", async () => {
  const request = {
    id: "request-1",
    pubkey: HUMAN,
    content:
      "Private Slack request [source](https://demo.slack.com/archives/D1/p100000000)",
    tags: [],
  };
  const suggestion = {
    id: "suggestion-1",
    pubkey: AGENT,
    content:
      "Project Omega has a blocker. [source](https://demo.slack.com/archives/C1/p100000001)",
    tags: [["e", request.id, "", "reply"]],
  };
  const { service, posts, stateStore } = await harness([request, suggestion]);

  const first = await service.runOnce();
  const second = await service.runOnce();

  assert.equal(first.delivered, 1);
  assert.equal(first.eligible, 1);
  assert.equal(second.alreadyDelivered, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channelId, "D1");
  assert.match(posts[0].text, /Suggestion from your Buzz research copilot/);
  assert.equal(
    stateStore.getDelivery(suggestion.id).sourceEventId,
    request.id,
  );
  assert.equal(
    stateStore.getDelivery(suggestion.id).deliveryType,
    "automatic_private_reply",
  );
});

test("refuses an agent message that is not linked to the paired Slack DM request", async () => {
  const wrongDmRequest = {
    id: "request-wrong-dm",
    pubkey: HUMAN,
    content:
      "Private Slack request [source](https://demo.slack.com/archives/D2/p100000000)",
    tags: [],
  };
  const wrongHumanRequest = {
    id: "request-wrong-human",
    pubkey: "c".repeat(64),
    content:
      "Private Slack request [source](https://demo.slack.com/archives/D1/p100000000)",
    tags: [],
  };
  const suggestion = {
    id: "suggestion-1",
    pubkey: AGENT,
    content:
      "Project Omega has a blocker. [source](https://demo.slack.com/archives/C1/p100000001)",
    tags: [["e", wrongDmRequest.id, "", "reply"]],
  };
  const otherSuggestion = {
    ...suggestion,
    id: "suggestion-2",
    tags: [["e", wrongHumanRequest.id, "", "reply"]],
  };
  const { service, posts } = await harness([
    wrongDmRequest,
    wrongHumanRequest,
    suggestion,
    otherSuggestion,
  ]);

  const stats = await service.runOnce();

  assert.equal(stats.invalid, 2);
  assert.equal(stats.delivered, 0);
  assert.equal(posts.length, 0);
});

test("refuses uncited suggestions and suggestions from another identity", async () => {
  const request = {
    id: "request-1",
    pubkey: HUMAN,
    content:
      "Private Slack request [source](https://demo.slack.com/archives/D1/p100000000)",
    tags: [],
  };
  const suggestion = {
    id: "suggestion-1",
    pubkey: AGENT,
    content: "Unsupported claim",
    tags: [["e", request.id, "", "reply"]],
  };
  const wrongAuthor = {
    id: "suggestion-2",
    pubkey: "c".repeat(64),
    content:
      "Unsupported author. [source](https://demo.slack.com/archives/C1/p100000001)",
    tags: [["e", request.id, "", "reply"]],
  };
  const { service, posts } = await harness([
    request,
    suggestion,
    wrongAuthor,
  ]);

  const stats = await service.runOnce();

  assert.equal(stats.invalid, 1);
  assert.equal(stats.delivered, 0);
  assert.equal(posts.length, 0);
});

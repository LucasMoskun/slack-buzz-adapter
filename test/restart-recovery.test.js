import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SlackBuzzAdapter } from "../src/adapter.js";
import { runBackfill } from "../src/backfill-service.js";
import { JsonStateStore } from "../src/state-store.js";

test("recovers a stale crash lock and resumes backfill without duplicates", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "slack-restart-"));
  const statePath = path.join(directory, "state.json");
  const messages = Array.from({ length: 13 }, (_, index) => ({
    ts: `${index + 1}.0`,
    text: `message ${index + 1}`,
    user: "U1",
    ...(index === 12 ? { thread_ts: "1.0" } : {}),
  }));
  const sends = [];
  const slackClient = {
    async channelHistory() {
      return { messages };
    },
    async threadReplies() {
      return { messages: [] };
    },
    async userDisplayName() {
      return "Ada";
    },
  };
  const buzzClient = {
    async sendMessage(channelId, content, replyTo) {
      const eventId = `E${sends.length + 1}`;
      sends.push({ channelId, content, replyTo, eventId });
      return { event_id: eventId };
    },
  };
  const createAdapter = (stateStore) =>
    new SlackBuzzAdapter({
      config: {
        adapterLabel: "Slack mirror",
        channelMappingsBySlackId: new Map([["C1", {}]]),
      },
      slackClient,
      buzzClient,
      stateStore,
      logger: { info() {}, debug() {}, error() {} },
      workspaceUrl: "https://example.slack.com",
      workspaceId: "T1",
      channelRoutes: [
        {
          slackChannelId: "C1",
          slackChannelName: "general",
          buzzChannelId: "B1",
          evidenceAudience: "private_channel",
        },
      ],
    });

  const beforeCrash = new JsonStateStore(statePath);
  await beforeCrash.acquireLock("pre-crash backfill");
  await beforeCrash.load();
  const firstAdapter = createAdapter(beforeCrash);
  for (const message of messages.slice(0, 5)) {
    await firstAdapter.processPayload({
      type: "event_callback",
      team_id: "T1",
      event_id: `backfill:C1:${message.ts}`,
      authorizations: [{ team_id: "T1" }],
      event: { ...message, type: "message", channel: "C1" },
    });
  }
  await beforeCrash.releaseLock();
  writeFileSync(
    `${statePath}.lock`,
    `${JSON.stringify({ pid: 99999999, owner: "crashed backfill" })}\n`,
  );

  const restarted = new JsonStateStore(statePath);
  await restarted.acquireLock("restarted backfill");
  await restarted.load();
  const stats = await runBackfill({
    adapter: createAdapter(restarted),
    slackClient,
    channelId: "C1",
    teamId: "T1",
  });
  await restarted.releaseLock();

  assert.equal(stats.duplicate, 5);
  assert.equal(stats.created, 8);
  assert.equal(sends.length, 13);
  assert.equal(new Set(sends.map((send) => send.content)).size, 13);
  assert.equal(sends.at(-1).replyTo, "E1");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  collectChannelMessages,
  runBackfill,
} from "../src/backfill-service.js";

test("collects paginated history and thread replies oldest-first", async () => {
  const historyCalls = [];
  const replyCalls = [];
  const slackClient = {
    async channelHistory(channelId, options) {
      historyCalls.push({ channelId, options });
      if (!options.cursor) {
        return {
          ok: true,
          messages: [
            { ts: "300.000001", text: "root", reply_count: 1 },
            { ts: "100.000001", text: "first" },
          ],
          response_metadata: { next_cursor: "page-2" },
        };
      }
      return {
        ok: true,
        messages: [{ ts: "200.000001", text: "second" }],
        response_metadata: { next_cursor: "" },
      };
    },
    async threadReplies(channelId, timestamp, options) {
      replyCalls.push({ channelId, timestamp, options });
      return {
        ok: true,
        messages: [
          { ts: "300.000001", text: "root", reply_count: 1 },
          {
            ts: "400.000001",
            thread_ts: "300.000001",
            text: "reply",
          },
        ],
        response_metadata: { next_cursor: "" },
      };
    },
  };

  const result = await collectChannelMessages({
    slackClient,
    channelId: "C1",
    oldest: "50.000000",
  });

  assert.deepEqual(
    result.messages.map((message) => message.ts),
    ["100.000001", "200.000001", "300.000001", "400.000001"],
  );
  assert.equal(result.historyPages, 2);
  assert.equal(result.threadPages, 1);
  assert.equal(historyCalls[1].options.cursor, "page-2");
  assert.equal(replyCalls[0].timestamp, "300.000001");
});

test("backfill emits deterministic event IDs and reports outcomes", async () => {
  const payloads = [];
  const adapter = {
    async processPayload(payload) {
      payloads.push(payload);
      return payload.event.ts === "100.000001" ? "created" : "existing";
    },
  };
  const slackClient = {
    async channelHistory() {
      return {
        ok: true,
        messages: [
          { ts: "200.000001", text: "already live" },
          { ts: "100.000001", text: "historical" },
        ],
      };
    },
    async threadReplies() {
      throw new Error("No thread calls expected");
    },
  };

  const stats = await runBackfill({
    adapter,
    slackClient,
    channelId: "C1",
    teamId: "T1",
  });

  assert.equal(stats.fetched, 2);
  assert.equal(stats.created, 1);
  assert.equal(stats.existing, 1);
  assert.deepEqual(
    payloads.map((payload) => payload.event_id),
    ["backfill:C1:100.000001", "backfill:C1:200.000001"],
  );
  assert.equal(payloads[0].event.channel, "C1");
});

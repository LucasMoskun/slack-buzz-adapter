import assert from "node:assert/strict";
import test from "node:test";
import { SlackClient } from "../src/slack-client.js";

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    async json() {
      return body;
    },
  };
}

test("retries Slack rate limits using Retry-After", async () => {
  const responses = [
    response(429, { ok: false, error: "ratelimited" }, { "retry-after": "2" }),
    response(200, { ok: true, team: "Demo" }),
  ];
  const delays = [];
  const client = new SlackClient({
    botToken: "xoxb-test",
    appToken: "xapp-test",
    fetchImpl: async () => responses.shift(),
    sleepImpl: async (delay) => delays.push(delay),
  });

  const result = await client.authTest();

  assert.equal(result.team, "Demo");
  assert.deepEqual(delays, [2000]);
});

test("calls Slack history and replies with cursor pagination parameters", async () => {
  const requests = [];
  const client = new SlackClient({
    botToken: "xoxb-test",
    appToken: "xapp-test",
    fetchImpl: async (url, options) => {
      requests.push({
        url,
        parameters: Object.fromEntries(new URLSearchParams(options.body)),
      });
      return response(200, { ok: true, messages: [] });
    },
  });

  await client.channelHistory("C1", {
    cursor: "history-cursor",
    oldest: "100.000000",
  });
  await client.threadReplies("C1", "200.000000", {
    cursor: "reply-cursor",
  });

  assert.deepEqual(requests, [
    {
      url: "https://slack.com/api/conversations.history",
      parameters: {
        channel: "C1",
        cursor: "history-cursor",
        oldest: "100.000000",
        limit: "200",
      },
    },
    {
      url: "https://slack.com/api/conversations.replies",
      parameters: {
        channel: "C1",
        ts: "200.000000",
        cursor: "reply-cursor",
        limit: "200",
      },
    },
  ]);
});

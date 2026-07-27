import assert from "node:assert/strict";
import test from "node:test";
import { SlackSocketMode } from "../src/socket-mode.js";

test("acknowledges a Socket Mode envelope before processing it", async () => {
  const order = [];
  const socket = {
    send(content) {
      order.push(["ack", JSON.parse(content)]);
    },
  };
  const socketMode = new SlackSocketMode({
    slackClient: {},
    logger: { info() {}, warn() {}, error() {} },
    onEnvelope: async (payload) => {
      order.push(["process", payload]);
    },
  });

  await socketMode.handleMessage(
    socket,
    JSON.stringify({
      envelope_id: "env-1",
      payload: { type: "event_callback", event_id: "Ev1" },
    }),
  );

  assert.deepEqual(order, [
    ["ack", { envelope_id: "env-1" }],
    ["process", { type: "event_callback", event_id: "Ev1" }],
  ]);
});

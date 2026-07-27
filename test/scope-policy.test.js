import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySlackMessage,
  SlackMessageScope,
} from "../src/scope-policy.js";

const CONFIG = {
  slackChannelId: "C1",
  copilotSlackDmId: "D-COPILOT",
  copilotSlackUserId: "U1",
};

test("allows the evidence channel and the exact human-copilot DM", () => {
  assert.equal(
    classifySlackMessage(CONFIG, {
      type: "message",
      channel: "C1",
      channel_type: "channel",
      user: "U1",
    }),
    SlackMessageScope.EVIDENCE,
  );
  assert.equal(
    classifySlackMessage(CONFIG, {
      type: "message",
      channel: "D-COPILOT",
      channel_type: "im",
      user: "U1",
    }),
    SlackMessageScope.COPILOT,
  );
});

test("excludes every other DM and all multi-person DMs", () => {
  const excluded = [
    {
      type: "message",
      channel: "D-OTHER",
      channel_type: "im",
      user: "U1",
    },
    {
      type: "message",
      channel: "D-COPILOT",
      channel_type: "im",
      user: "U2",
    },
    {
      type: "message",
      channel: "G-MPIM",
      channel_type: "mpim",
      user: "U1",
    },
  ];

  for (const event of excluded) {
    assert.equal(
      classifySlackMessage(CONFIG, event),
      SlackMessageScope.EXCLUDED_DM,
    );
  }
});

test("recognizes DM IDs even if Slack omits channel_type", () => {
  assert.equal(
    classifySlackMessage(CONFIG, {
      type: "message",
      channel: "D-OTHER",
      user: "U1",
    }),
    SlackMessageScope.EXCLUDED_DM,
  );
});

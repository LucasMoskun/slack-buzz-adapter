import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadConfig,
  parseSlackTimestamp,
  redactConfig,
} from "../src/config.js";

const VALID_ENV = {
  SLACK_APP_TOKEN: "xapp-test",
  SLACK_BOT_TOKEN: "xoxb-test",
  SLACK_ALLOWED_CHANNEL_IDS: "C123,G456,C123",
  BUZZ_PRIVATE_KEY: "nsec-test",
};
const PROJECT = mkdtempSync(path.join(os.tmpdir(), "slack-buzz-config-"));
writeFileSync(
  path.join(PROJECT, "channel-mappings.json"),
  JSON.stringify({
    version: 1,
    channels: [
      {
        slackChannelId: "C123",
        slackChannelName: "demo",
        buzzChannelId: "buzz-channel",
        buzzChannelName: "slack-demo",
      },
    ],
  }),
);

test("loadConfig requires all credentials and mapping values", () => {
  assert.throws(
    () => loadConfig({}),
    /SLACK_APP_TOKEN.*SLACK_BOT_TOKEN.*BUZZ_PRIVATE_KEY/,
  );
});

test("redactConfig never includes Slack credentials", () => {
  const config = loadConfig(VALID_ENV, PROJECT);
  const redacted = redactConfig(config);

  assert.equal(redacted.channelMappings[0].slackChannelId, "C123");
  assert.equal(redacted.channelMappings[0].buzzChannelId, "buzz-channel");
  assert.equal(redacted.channelSyncIntervalMs, 60_000);
  assert.deepEqual(redacted.slackAllowedChannelIds, ["C123", "G456"]);
  assert.equal("slackAppToken" in redacted, false);
  assert.equal("slackBotToken" in redacted, false);
});

test("requires and validates a stable Slack channel allowlist", () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENV, SLACK_ALLOWED_CHANNEL_IDS: "" }, PROJECT),
    /SLACK_ALLOWED_CHANNEL_IDS/,
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, SLACK_ALLOWED_CHANNEL_IDS: "general" }, PROJECT),
    /stable Slack channel IDs/,
  );

  const config = loadConfig(
    {
      ...VALID_ENV,
      SLACK_DENIED_CHANNEL_NAMES: "Partners, Board Meeting, finance-leads",
    },
    PROJECT,
  );
  assert.deepEqual(config.slackDeniedChannelNames, [
    "partners",
    "board-meeting",
    "finance-leads",
  ]);
});

test("loads a whitespace-free optional Buzz channel prefix", () => {
  assert.equal(loadConfig(VALID_ENV, PROJECT).buzzChannelPrefix, "");
  assert.equal(
    loadConfig({ ...VALID_ENV, BUZZ_CHANNEL_PREFIX: "mlf-" }, PROJECT)
      .buzzChannelPrefix,
    "mlf-",
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, BUZZ_CHANNEL_PREFIX: "mlf " }, PROJECT),
    /must not contain whitespace/,
  );
});

test("parses ISO dates and Slack timestamps for backfill", () => {
  assert.equal(parseSlackTimestamp(undefined), undefined);
  assert.equal(parseSlackTimestamp("1722070800.123456"), "1722070800.123456");
  assert.equal(
    parseSlackTimestamp("2026-07-27T00:00:00Z"),
    "1785110400.000000",
  );
  assert.throws(() => parseSlackTimestamp("last Tuesday"), /BACKFILL_OLDEST/);
});

test("requires both copilot routing endpoints and redacts identities", () => {
  assert.throws(
    () =>
      loadConfig(
        {
          ...VALID_ENV,
          COPILOT_SLACK_USER_ID: "U1",
        },
        PROJECT,
      ),
    /COPILOT_SLACK_USER_ID and COPILOT_BUZZ_CHANNEL_ID/,
  );

  const config = loadConfig(
    {
      ...VALID_ENV,
      COPILOT_SLACK_USER_ID: "U1",
      COPILOT_BUZZ_CHANNEL_ID: "buzz-copilot",
      COPILOT_AGENT_NAME: "Ada's Research Copilot",
      COPILOT_POLL_INTERVAL_MS: "5000",
    },
    PROJECT,
  );
  const redacted = redactConfig(config);
  assert.equal(config.copilotSlackUserId, "U1");
  assert.equal(config.copilotPollIntervalMs, 5000);
  assert.equal(redacted.copilotEnabled, true);
  assert.equal("copilotSlackUserId" in redacted, false);
});

test("requires an exact Buzz agent name for copilot mention routing", () => {
  assert.throws(
    () =>
      loadConfig(
        {
          ...VALID_ENV,
          COPILOT_SLACK_USER_ID: "U1",
          COPILOT_BUZZ_CHANNEL_ID: "buzz-copilot",
        },
        PROJECT,
      ),
    /COPILOT_AGENT_NAME/,
  );
});

test("loads the paired Buzz human identity for automatic delivery", () => {
  const config = loadConfig(
    {
      ...VALID_ENV,
      COPILOT_SLACK_USER_ID: "U1",
      COPILOT_BUZZ_CHANNEL_ID: "buzz-copilot",
      COPILOT_AGENT_NAME: "Ada's Research Copilot",
      COPILOT_HUMAN_PUBKEY: "b".repeat(64),
    },
    PROJECT,
  );

  assert.equal(config.copilotHumanPubkey, "b".repeat(64));
});

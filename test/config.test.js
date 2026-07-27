import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, redactConfig } from "../src/config.js";

const VALID_ENV = {
  SLACK_APP_TOKEN: "xapp-test",
  SLACK_BOT_TOKEN: "xoxb-test",
  SLACK_CHANNEL_ID: "C123",
  BUZZ_CHANNEL_ID: "buzz-channel",
  BUZZ_PRIVATE_KEY: "nsec-test",
};

test("loadConfig requires all credentials and mapping values", () => {
  assert.throws(
    () => loadConfig({}),
    /SLACK_APP_TOKEN.*SLACK_BOT_TOKEN.*SLACK_CHANNEL_ID.*BUZZ_CHANNEL_ID.*BUZZ_PRIVATE_KEY/,
  );
});

test("redactConfig never includes Slack credentials", () => {
  const config = loadConfig(VALID_ENV, "/tmp/project");
  const redacted = redactConfig(config);

  assert.equal(redacted.slackChannelId, "C123");
  assert.equal(redacted.buzzChannelId, "buzz-channel");
  assert.equal("slackAppToken" in redacted, false);
  assert.equal("slackBotToken" in redacted, false);
});

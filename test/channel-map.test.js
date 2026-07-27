import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadChannelMappings,
  saveChannelMappings,
} from "../src/channel-map.js";

function temporaryPath() {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "slack-buzz-channel-map-"),
  );
  return path.join(directory, "channel-mappings.json");
}

test("loads and atomically saves one-to-one channel mappings", () => {
  const mappingPath = temporaryPath();
  saveChannelMappings(mappingPath, [
    {
      slackChannelId: "C2",
      slackChannelName: "zeta",
      buzzChannelId: "buzz-2",
      buzzChannelName: "slack-zeta",
    },
    {
      slackChannelId: "G1",
      slackChannelName: "alpha-private",
      buzzChannelId: "buzz-1",
      buzzChannelName: "slack-alpha-private",
    },
  ]);

  const mappings = loadChannelMappings(mappingPath);
  assert.deepEqual(
    mappings.map((mapping) => mapping.slackChannelId),
    ["G1", "C2"],
  );
  assert.equal(JSON.parse(readFileSync(mappingPath)).version, 1);
});

test("rejects duplicate Slack or Buzz channel assignments", () => {
  const mappingPath = temporaryPath();
  writeFileSync(
    mappingPath,
    JSON.stringify({
      version: 1,
      channels: [
        {
          slackChannelId: "C1",
          buzzChannelId: "buzz-1",
        },
        {
          slackChannelId: "C2",
          buzzChannelId: "buzz-1",
        },
      ],
    }),
  );
  assert.throws(
    () => loadChannelMappings(mappingPath),
    /Buzz channel is mapped more than once/,
  );
});

test("fails closed when the mapping file is missing or empty", () => {
  const mappingPath = temporaryPath();
  assert.throws(
    () => loadChannelMappings(mappingPath),
    /not found/,
  );
  assert.deepEqual(
    loadChannelMappings(mappingPath, { allowMissing: true }),
    [],
  );
});


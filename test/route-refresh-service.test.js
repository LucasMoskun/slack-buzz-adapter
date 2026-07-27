import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  mappingIndex,
  saveChannelMappings,
} from "../src/channel-map.js";
import { refreshChannelRoutes } from "../src/route-refresh-service.js";

function harness() {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "slack-buzz-route-refresh-"),
  );
  const mappingPath = path.join(directory, "channel-mappings.json");
  const initialMappings = [
    {
      slackChannelId: "C1",
      slackChannelName: "one",
      buzzChannelId: "buzz-1",
      buzzChannelName: "one",
    },
  ];
  saveChannelMappings(mappingPath, [
    ...initialMappings,
    {
      slackChannelId: "C2",
      slackChannelName: "two",
      buzzChannelId: "buzz-2",
      buzzChannelName: "two",
    },
  ]);
  const adapter = {
    channelRoutes: new Map([
      [
        "C1",
        {
          ...initialMappings[0],
          evidenceAudience: "public_channel",
        },
      ],
    ]),
    setChannelRoutes(routes) {
      this.channelRoutes = new Map(
        routes.map((route) => [route.slackChannelId, route]),
      );
    },
  };
  const config = {
    channelMappingsPath: mappingPath,
    routeRefreshHashPath: path.join(directory, "applied-hash"),
    channelMappings: initialMappings,
    channelMappingsBySlackId: mappingIndex(initialMappings),
  };
  const slackClient = {
    async channelInfo(channelId) {
      return {
        channel: {
          id: channelId,
          name: channelId === "C1" ? "one" : "two",
          is_private: false,
        },
      };
    },
    async channelMembers() {
      return ["U1"];
    },
  };
  const buzzClient = {
    async channelInfo(channelId) {
      return {
        channel_id: channelId,
        name: channelId === "buzz-1" ? "one" : "two",
      };
    },
  };
  const stateStore = {
    async recordConversation() {},
  };
  return {
    adapter,
    config,
    slackClient,
    buzzClient,
    stateStore,
  };
}

test("hot-adds and backfills only newly mapped routes", async () => {
  const setup = harness();
  const backfilled = [];
  const stats = await refreshChannelRoutes({
    ...setup,
    workspaceId: "T1",
    runBackfillImpl: async ({ channelId }) => {
      backfilled.push(channelId);
      return { fetched: 3, created: 3 };
    },
  });

  assert.equal(stats.mappedChannels, 2);
  assert.equal(stats.addedChannels, 1);
  assert.deepEqual(backfilled, ["C2"]);
  assert.deepEqual(
    [...setup.adapter.channelRoutes.keys()],
    ["C1", "C2"],
  );
  assert.equal(setup.config.channelMappingsBySlackId.has("C2"), true);
  assert.match(
    readFileSync(setup.config.routeRefreshHashPath, "utf8"),
    /^[a-f0-9]{64}\n$/,
  );
});

test("rolls routes and config back when a new-channel backfill fails", async () => {
  const setup = harness();
  const previousMappings = setup.config.channelMappings;
  const previousIndex = setup.config.channelMappingsBySlackId;

  await assert.rejects(
    () =>
      refreshChannelRoutes({
        ...setup,
        workspaceId: "T1",
        runBackfillImpl: async () => {
          throw new Error("backfill failed");
        },
      }),
    /backfill failed/,
  );

  assert.deepEqual([...setup.adapter.channelRoutes.keys()], ["C1"]);
  assert.equal(setup.config.channelMappings, previousMappings);
  assert.equal(setup.config.channelMappingsBySlackId, previousIndex);
});


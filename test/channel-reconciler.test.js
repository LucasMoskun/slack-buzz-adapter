import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  InternalReconciliationLoop,
  runChannelReconciliation,
} from "../src/channel-reconciler.js";
import {
  mappingIndex,
  saveChannelMappings,
} from "../src/channel-map.js";
import { recordAppliedMappingHash } from "../src/route-refresh-service.js";

function reconciliationHarness() {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "slack-buzz-internal-sync-"),
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
  saveChannelMappings(mappingPath, initialMappings);
  const config = {
    channelMappingsPath: mappingPath,
    routeRefreshHashPath: path.join(directory, "applied-hash"),
    syncStatePath: path.join(directory, "sync-state.json"),
    channelMappings: initialMappings,
    channelMappingsBySlackId: mappingIndex(initialMappings),
  };
  recordAppliedMappingHash(mappingPath, config.routeRefreshHashPath);
  const lockCalls = [];
  const createSyncStateStore = () => ({
    async acquireLock(owner) {
      lockCalls.push(["acquire", owner]);
    },
    async releaseLock() {
      lockCalls.push(["release"]);
    },
  });
  const adapter = {
    async runExclusive(task) {
      return task();
    },
  };
  return {
    adapter,
    config,
    createSyncStateStore,
    initialMappings,
    lockCalls,
  };
}

function syncStats(overrides = {}) {
  return {
    discoveredChannels: 1,
    publicChannels: 1,
    visiblePrivateChannels: 0,
    joinedPublicChannels: 0,
    createdBuzzChannels: 0,
    renamedBuzzChannels: 0,
    retainedMappings: 1,
    totalMappings: 1,
    channels: [],
    ...overrides,
  };
}

test("internal reconciliation skips route work when the map is unchanged", async () => {
  const setup = reconciliationHarness();
  let refreshCalls = 0;
  const result = await runChannelReconciliation({
    ...setup,
    syncChannelMappingsImpl: async ({ config }) => {
      assert.equal(config.channelMappings.length, 1);
      return syncStats();
    },
    refreshChannelRoutesImpl: async () => {
      refreshCalls += 1;
    },
  });

  assert.equal(result.routesChanged, false);
  assert.equal(refreshCalls, 0);
  assert.deepEqual(setup.lockCalls, [
    ["acquire", "internal channel reconciliation"],
    ["release"],
  ]);
});

test("internal reconciliation reloads the map and applies changed routes", async () => {
  const setup = reconciliationHarness();
  let refreshCalls = 0;
  const result = await runChannelReconciliation({
    ...setup,
    syncChannelMappingsImpl: async ({ config }) => {
      assert.equal(config.channelMappings.length, 1);
      saveChannelMappings(config.channelMappingsPath, [
        ...config.channelMappings,
        {
          slackChannelId: "C2",
          slackChannelName: "two",
          buzzChannelId: "buzz-2",
          buzzChannelName: "two",
        },
      ]);
      return syncStats({
        discoveredChannels: 2,
        createdBuzzChannels: 1,
        retainedMappings: 1,
        totalMappings: 2,
      });
    },
    refreshChannelRoutesImpl: async () => {
      refreshCalls += 1;
      return { mappedChannels: 2, addedChannels: 1 };
    },
  });

  assert.equal(result.routesChanged, true);
  assert.equal(result.createdBuzzChannels, 1);
  assert.equal(result.routeStats.addedChannels, 1);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(setup.lockCalls.at(-1), ["release"]);
});

test("internal loop prevents overlap and retries after failure", async () => {
  let releaseFirst;
  let taskCalls = 0;
  const errors = [];
  const loop = new InternalReconciliationLoop({
    intervalMs: 60_000,
    task: async () => {
      taskCalls += 1;
      if (taskCalls === 1) {
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
        throw new Error("temporary failure");
      }
      return { totalMappings: 1 };
    },
    logger: {
      info() {},
      error(_message, fields) {
        errors.push(fields.error);
      },
    },
  });

  const first = loop.runNow();
  await Promise.resolve();
  assert.deepEqual(await loop.runNow(), {
    ok: true,
    skipped: "already_running",
  });
  releaseFirst();
  assert.deepEqual(await first, {
    ok: false,
    error: "temporary failure",
  });
  assert.deepEqual(await loop.runNow(), {
    ok: true,
    stats: { totalMappings: 1 },
  });
  assert.equal(taskCalls, 2);
  assert.deepEqual(errors, ["temporary failure"]);
});

test("internal loop schedules the next cycle only after completion", async () => {
  const timers = [];
  const cleared = [];
  let finishTask;
  const loop = new InternalReconciliationLoop({
    intervalMs: 60_000,
    task: () =>
      new Promise((resolve) => {
        finishTask = resolve;
      }),
    logger: {
      info() {},
      error() {},
    },
    setTimer(callback, delayMs) {
      const timer = { callback, delayMs, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      cleared.push(timer);
    },
  });

  loop.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 0);
  const firstCycle = timers[0].callback();
  await Promise.resolve();
  assert.equal(timers.length, 1);
  finishTask({ totalMappings: 1 });
  await firstCycle;
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delayMs, 60_000);

  loop.stop();
  assert.deepEqual(cleared, [timers[1]]);
});

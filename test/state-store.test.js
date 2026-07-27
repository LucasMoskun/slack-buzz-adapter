import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStateStore } from "../src/state-store.js";

test("persists message mappings and event receipts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "slack-buzz-state-"));
  const statePath = path.join(directory, "state.json");
  const store = new JsonStateStore(statePath);
  await store.load();

  await store.record({
    eventId: "Ev1",
    sourceKey: "C1:1.0",
    message: { buzzEventId: "abc" },
  });

  const reloaded = new JsonStateStore(statePath);
  await reloaded.load();
  assert.equal(reloaded.hasEvent("Ev1"), true);
  assert.deepEqual(reloaded.getMessage("C1:1.0"), { buzzEventId: "abc" });

  const raw = await readFile(statePath, "utf8");
  assert.equal(JSON.parse(raw).version, 1);
});

test("prunes the oldest event receipts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "slack-buzz-state-"));
  const store = new JsonStateStore(path.join(directory, "state.json"), {
    maxEvents: 2,
  });
  await store.load();

  await store.markEvent("Ev1");
  await new Promise((resolve) => setTimeout(resolve, 2));
  await store.markEvent("Ev2");
  await new Promise((resolve) => setTimeout(resolve, 2));
  await store.markEvent("Ev3");

  assert.equal(store.hasEvent("Ev1"), false);
  assert.equal(store.hasEvent("Ev2"), true);
  assert.equal(store.hasEvent("Ev3"), true);
});

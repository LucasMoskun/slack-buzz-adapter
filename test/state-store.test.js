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

test("prevents two processes from owning the same state path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "slack-buzz-state-"));
  const statePath = path.join(directory, "state.json");
  const liveStore = new JsonStateStore(statePath);
  const backfillStore = new JsonStateStore(statePath);

  await liveStore.acquireLock("live adapter");
  await assert.rejects(
    () => backfillStore.acquireLock("history backfill"),
    /locked by live adapter.*Stop the live adapter/,
  );
  await liveStore.releaseLock();

  await backfillStore.acquireLock("history backfill");
  await backfillStore.releaseLock();
});

test("persists actor, audience ledger, and delivery receipts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "slack-buzz-state-"));
  const statePath = path.join(directory, "state.json");
  const store = new JsonStateStore(statePath);
  await store.load();

  await store.record({
    actorKey: "T1:U1",
    actor: { userId: "U1", displayName: "Ada" },
  });
  await store.recordConversation("C1", {
    audience: "private_channel",
    memberUserIds: ["U1"],
  });
  await store.recordDelivery("suggestion-1", {
    approvalEventId: "approval-1",
  });

  const reloaded = new JsonStateStore(statePath);
  await reloaded.load();
  assert.equal(reloaded.getActor("T1:U1").displayName, "Ada");
  assert.deepEqual(reloaded.getConversation("C1").memberUserIds, ["U1"]);
  assert.equal(
    reloaded.getDelivery("suggestion-1").approvalEventId,
    "approval-1",
  );
});

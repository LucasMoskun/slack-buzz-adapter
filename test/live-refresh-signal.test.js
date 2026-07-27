import assert from "node:assert/strict";
import test from "node:test";
import { signalLiveRefresh } from "../src/live-refresh-signal.js";

test("signals only the validated live-adapter lock owner", () => {
  const signals = [];
  const result = signalLiveRefresh("/tmp/state.lock", {
    readFile() {
      return JSON.stringify({ pid: 123, owner: "live adapter" });
    },
    inspectProcess() {
      return "node --env-file-if-exists=.env src/index.js";
    },
    signal(pid) {
      signals.push(pid);
    },
  });

  assert.deepEqual(result, { pid: 123, signal: "SIGHUP" });
  assert.deepEqual(signals, [123]);
});

test("refuses to signal an unexpected lock owner", () => {
  assert.throws(
    () =>
      signalLiveRefresh("/tmp/state.lock", {
        readFile() {
          return JSON.stringify({ pid: 123, owner: "history backfill" });
        },
        inspectProcess() {
          throw new Error("must not be called");
        },
        signal() {
          throw new Error("must not be called");
        },
      }),
    /unexpected lock owner/,
  );
});

test("refuses to signal a reused PID owned by another process", () => {
  assert.throws(
    () =>
      signalLiveRefresh("/tmp/state.lock", {
        readFile() {
          return JSON.stringify({ pid: 123, owner: "live adapter" });
        },
        inspectProcess() {
          return "/usr/bin/python unrelated.py";
        },
        signal() {
          throw new Error("must not be called");
        },
      }),
    /not the live adapter/,
  );
});

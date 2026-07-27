import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export function signalLiveRefresh(
  lockPath,
  {
    readFile = readFileSync,
    inspectProcess = (pid) =>
      execFileSync(
        "/bin/ps",
        ["-p", String(pid), "-o", "command="],
        { encoding: "utf8" },
      ),
    signal = (pid) => process.kill(pid, "SIGHUP"),
  } = {},
) {
  let lock;
  try {
    lock = JSON.parse(readFile(lockPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Live adapter lock not found: ${lockPath}`);
    }
    throw new Error(`Live adapter lock is invalid: ${lockPath}`);
  }
  if (
    lock.owner !== "live adapter" ||
    !Number.isInteger(lock.pid) ||
    lock.pid < 1
  ) {
    throw new Error(`Refusing to signal unexpected lock owner: ${lockPath}`);
  }
  const command = inspectProcess(lock.pid).trim();
  if (!command.includes("node") || !command.includes("src/index.js")) {
    throw new Error(
      `Refusing to signal a process that is not the live adapter: ${lock.pid}`,
    );
  }
  signal(lock.pid);
  return { pid: lock.pid, signal: "SIGHUP" };
}

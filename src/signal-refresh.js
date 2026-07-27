import { loadConfig } from "./config.js";
import { signalLiveRefresh } from "./live-refresh-signal.js";

function main() {
  const config = loadConfig();
  const result = signalLiveRefresh(`${config.statePath}.lock`);
  if (!process.argv.includes("--quiet")) {
    console.log(JSON.stringify({ ok: true, ...result }));
  }
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: error.message,
    }),
  );
  process.exitCode = 1;
}


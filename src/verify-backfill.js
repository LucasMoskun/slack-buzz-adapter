import { writeFile } from "node:fs/promises";
import { BuzzClient } from "./buzz-client.js";
import { loadConfig } from "./config.js";
import { SlackClient } from "./slack-client.js";
import { JsonStateStore } from "./state-store.js";
import {
  formatVerificationReport,
  verifyChannelMirror,
} from "./verify-service.js";

async function main() {
  const config = loadConfig();
  const requestedChannel = argumentValue("--slack-channel");
  const reportPath = argumentValue("--report");
  const mappings = requestedChannel
    ? config.channelMappings.filter(
        (mapping) => mapping.slackChannelId === requestedChannel,
      )
    : config.channelMappings;
  if (mappings.length === 0) throw new Error("No matching channel mapping");

  const slackClient = new SlackClient({
    botToken: config.slackBotToken,
    appToken: config.slackAppToken,
  });
  const buzzClient = new BuzzClient({ executable: config.buzzCli });
  const stateStore = new JsonStateStore(config.statePath);
  await stateStore.load();
  const results = [];
  for (const mapping of mappings) {
    results.push(
      await verifyChannelMirror({
        slackClient,
        buzzClient,
        stateStore,
        mapping,
        oldest: config.backfillOldest,
      }),
    );
  }
  const report = formatVerificationReport(results);
  if (reportPath) await writeFile(reportPath, report, { mode: 0o600 });
  process.stdout.write(report);
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

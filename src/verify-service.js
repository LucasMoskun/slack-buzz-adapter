import { collectChannelMessages } from "./backfill-service.js";
import { normalizeSlackMessage, sourceKey } from "./format.js";

export async function verifyChannelMirror({
  slackClient,
  buzzClient,
  stateStore,
  mapping,
  oldest,
  buzzLimit = 200,
}) {
  const collection = await collectChannelMessages({
    slackClient,
    channelId: mapping.slackChannelId,
    oldest,
  });
  const sourceMessages = collection.messages.filter((message) => {
    const normalized = normalizeSlackMessage({
      ...message,
      type: "message",
      channel: mapping.slackChannelId,
    });
    return normalized?.action === "create" && normalized.message?.ts;
  });
  const buzzMessages = await buzzClient.getMessages(
    mapping.buzzChannelId,
    buzzLimit,
  );
  const buzzById = new Map(buzzMessages.map((message) => [message.id, message]));
  const truncated = buzzMessages.length >= buzzLimit;
  const failures = [];
  let receipts = 0;
  let present = 0;
  let threadLinks = 0;

  for (const message of sourceMessages) {
    const receipt = stateStore.getMessage(
      sourceKey(mapping.slackChannelId, message.ts),
    );
    if (!receipt?.buzzEventId) {
      failures.push(`missing receipt for ${message.ts}`);
      continue;
    }
    receipts += 1;
    const mirrored = buzzById.get(receipt.buzzEventId);
    if (mirrored) present += 1;
    else if (!truncated) failures.push(`missing Buzz event ${receipt.buzzEventId}`);

    if (message.thread_ts && message.thread_ts !== message.ts) {
      const parent = stateStore.getMessage(
        sourceKey(mapping.slackChannelId, message.thread_ts),
      );
      const hasReplyTarget = mirrored?.tags?.some(
        (tag) => tag[0] === "e" && tag[1] === parent?.buzzEventId,
      );
      if (parent?.buzzEventId && hasReplyTarget) {
        threadLinks += 1;
      } else if (mirrored || !truncated) {
        failures.push(`invalid thread parent for ${message.ts}`);
      }
    }
  }

  const changedReceipts = Object.values(stateStore.state.messages)
    .filter(
      (receipt) =>
        receipt.source?.channelId === mapping.slackChannelId &&
        (receipt.updatedAt || receipt.deletedAt),
    )
    .slice(0, 10);
  let changedSamples = 0;
  for (const receipt of changedReceipts) {
    const mirrored = buzzById.get(receipt.buzzEventId);
    if (mirrored?.content === receipt.content) changedSamples += 1;
    else if (mirrored || !truncated) {
      failures.push(`changed message mismatch for ${receipt.buzzEventId}`);
    }
  }

  return {
    ok: failures.length === 0,
    slackChannelId: mapping.slackChannelId,
    buzzChannelId: mapping.buzzChannelId,
    sourceMessages: sourceMessages.length,
    receipts,
    present: truncated ? "skipped-truncated" : present,
    threadLinks,
    changedSamples,
    buzzFetchTruncated: truncated,
    failures,
  };
}

export function formatVerificationReport(results, observedAt = new Date()) {
  const lines = [
    "Slack -> Buzz mirror verification",
    `Observed: ${observedAt.toISOString()}`,
    `Result: ${results.every((result) => result.ok) ? "PASS" : "FAIL"}`,
    "",
  ];
  for (const result of results) {
    lines.push(
      `Slack ${result.slackChannelId} -> Buzz ${result.buzzChannelId}`,
      `  result: ${result.ok ? "PASS" : "FAIL"}`,
      `  source messages: ${result.sourceMessages}`,
      `  receipts: ${result.receipts}`,
      `  Buzz presence: ${result.present}`,
      `  thread links: ${result.threadLinks}`,
      `  changed/deleted samples: ${result.changedSamples}`,
      `  Buzz fetch truncated: ${result.buzzFetchTruncated}`,
    );
    for (const failure of result.failures) lines.push(`  failure: ${failure}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

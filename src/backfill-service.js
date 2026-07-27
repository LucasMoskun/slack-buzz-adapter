export async function collectChannelMessages({
  slackClient,
  channelId,
  oldest,
  logger,
}) {
  const messages = new Map();
  let historyPages = 0;
  let threadPages = 0;
  let cursor;

  do {
    const page = await slackClient.channelHistory(channelId, { cursor, oldest });
    historyPages += 1;
    for (const message of page.messages ?? []) {
      if (message.ts) messages.set(message.ts, message);
    }
    cursor = nextCursor(page);
    logger?.debug("Fetched Slack history page", {
      historyPages,
      messages: messages.size,
    });
  } while (cursor);

  const rootsWithReplies = [...messages.values()].filter(
    (message) => message.ts && Number(message.reply_count) > 0,
  );

  for (const root of rootsWithReplies) {
    cursor = undefined;
    do {
      const page = await slackClient.threadReplies(channelId, root.ts, {
        cursor,
        oldest,
      });
      threadPages += 1;
      for (const message of page.messages ?? []) {
        if (message.ts) messages.set(message.ts, message);
      }
      cursor = nextCursor(page);
    } while (cursor);
  }

  return {
    messages: [...messages.values()].sort(compareSlackTimestamps),
    historyPages,
    threadPages,
  };
}

export async function runBackfill({
  adapter,
  slackClient,
  channelId,
  teamId,
  oldest,
  logger,
}) {
  const collection = await collectChannelMessages({
    slackClient,
    channelId,
    oldest,
    logger,
  });
  const stats = {
    fetched: collection.messages.length,
    created: 0,
    existing: 0,
    ignored: 0,
    duplicate: 0,
    historyPages: collection.historyPages,
    threadPages: collection.threadPages,
  };

  for (const message of collection.messages) {
    const status = await adapter.processPayload({
      type: "event_callback",
      team_id: teamId,
      event_id: `backfill:${channelId}:${message.ts}`,
      authorizations: [{ team_id: teamId }],
      event: {
        ...message,
        type: "message",
        channel: channelId,
      },
    });

    if (status in stats) stats[status] += 1;
    else stats.ignored += 1;
  }

  return stats;
}

function nextCursor(page) {
  return page.response_metadata?.next_cursor?.trim() || undefined;
}

function compareSlackTimestamps(left, right) {
  const difference = Number(left.ts) - Number(right.ts);
  if (Number.isFinite(difference) && difference !== 0) return difference;
  return String(left.ts).localeCompare(String(right.ts));
}

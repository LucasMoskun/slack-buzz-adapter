const SLACK_API_BASE = "https://slack.com/api";

export class SlackApiError extends Error {
  constructor(method, code, details = {}) {
    super(`Slack API ${method} failed: ${code}`);
    this.name = "SlackApiError";
    this.method = method;
    this.code = code;
    this.details = details;
  }
}

export class SlackClient {
  constructor({
    botToken,
    appToken,
    fetchImpl = globalThis.fetch,
    sleepImpl = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    maxRateLimitRetries = 5,
  }) {
    this.botToken = botToken;
    this.appToken = appToken;
    this.fetch = fetchImpl;
    this.sleep = sleepImpl;
    this.maxRateLimitRetries = maxRateLimitRetries;
    this.userCache = new Map();
  }

  async call(method, token, parameters = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetch(`${SLACK_API_BASE}/${method}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(parameters),
      });

      if (response.status === 429 && attempt < this.maxRateLimitRetries) {
        const retrySeconds = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retrySeconds)
          ? Math.max(1, retrySeconds) * 1000
          : 1000 * 2 ** attempt;
        await this.sleep(delay);
        continue;
      }

      if (!response.ok) {
        throw new SlackApiError(method, `http_${response.status}`);
      }

      const body = await response.json();
      if (!body.ok) {
        throw new SlackApiError(method, body.error || "unknown_error", body);
      }
      return body;
    }
  }

  authTest() {
    return this.call("auth.test", this.botToken);
  }

  openSocket() {
    return this.call("apps.connections.open", this.appToken);
  }

  channelInfo(channelId) {
    return this.call("conversations.info", this.botToken, {
      channel: channelId,
      include_num_members: "false",
    });
  }

  async listConversations({
    types = "public_channel,private_channel",
    excludeArchived = true,
  } = {}) {
    const channels = [];
    let cursor;
    do {
      const page = await this.call(
        "conversations.list",
        this.botToken,
        compactParameters({
          types,
          exclude_archived: String(excludeArchived),
          cursor,
          limit: "200",
        }),
      );
      channels.push(...(page.channels ?? []));
      cursor = page.response_metadata?.next_cursor?.trim() || undefined;
    } while (cursor);
    return channels;
  }

  joinChannel(channelId) {
    return this.call("conversations.join", this.botToken, {
      channel: channelId,
    });
  }

  channelHistory(channelId, { cursor, oldest, limit = 200 } = {}) {
    return this.call(
      "conversations.history",
      this.botToken,
      compactParameters({
        channel: channelId,
        cursor,
        oldest,
        limit: String(limit),
      }),
    );
  }

  threadReplies(channelId, timestamp, { cursor, oldest, limit = 200 } = {}) {
    return this.call(
      "conversations.replies",
      this.botToken,
      compactParameters({
        channel: channelId,
        ts: timestamp,
        cursor,
        oldest,
        limit: String(limit),
      }),
    );
  }

  async userDisplayName(userId) {
    if (!userId) return "Unknown user";
    return (await this.userProfile(userId)).displayName;
  }

  async userProfile(userId) {
    if (!userId) {
      return {
        userId: null,
        displayName: "Unknown user",
        isBot: false,
        isGuest: false,
        isDeleted: false,
      };
    }
    if (this.userCache.has(userId)) return this.userCache.get(userId);

    const body = await this.call("users.info", this.botToken, { user: userId });
    const profile = body.user?.profile ?? {};
    const result = {
      userId,
      displayName:
        profile.display_name ||
        profile.real_name ||
        body.user?.real_name ||
        body.user?.name ||
        userId,
      isBot: Boolean(body.user?.is_bot),
      isGuest: Boolean(
        body.user?.is_restricted || body.user?.is_ultra_restricted,
      ),
      isDeleted: Boolean(body.user?.deleted),
    };
    this.userCache.set(userId, result);
    return result;
  }

  async channelMembers(channelId) {
    const members = [];
    let cursor;
    do {
      const page = await this.call(
        "conversations.members",
        this.botToken,
        compactParameters({
          channel: channelId,
          cursor,
          limit: "200",
        }),
      );
      members.push(...(page.members ?? []));
      cursor = page.response_metadata?.next_cursor?.trim() || undefined;
    } while (cursor);
    return members;
  }

  openDirectMessage(userId) {
    return this.call("conversations.open", this.botToken, {
      users: userId,
      return_im: "true",
    });
  }

  postMessage(channelId, text) {
    return this.call("chat.postMessage", this.botToken, {
      channel: channelId,
      text,
      unfurl_links: "false",
      unfurl_media: "false",
    });
  }
}

function compactParameters(parameters) {
  return Object.fromEntries(
    Object.entries(parameters).filter(([, value]) => value !== undefined),
  );
}

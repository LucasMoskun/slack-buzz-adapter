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
  constructor({ botToken, appToken, fetchImpl = globalThis.fetch }) {
    this.botToken = botToken;
    this.appToken = appToken;
    this.fetch = fetchImpl;
    this.userCache = new Map();
  }

  async call(method, token, parameters = {}) {
    const response = await this.fetch(`${SLACK_API_BASE}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(parameters),
    });

    if (!response.ok) {
      throw new SlackApiError(method, `http_${response.status}`);
    }

    const body = await response.json();
    if (!body.ok) {
      throw new SlackApiError(method, body.error || "unknown_error", body);
    }
    return body;
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

  async userDisplayName(userId) {
    if (!userId) return "Unknown user";
    if (this.userCache.has(userId)) return this.userCache.get(userId);

    const body = await this.call("users.info", this.botToken, { user: userId });
    const profile = body.user?.profile ?? {};
    const name =
      profile.display_name ||
      profile.real_name ||
      body.user?.real_name ||
      body.user?.name ||
      userId;
    this.userCache.set(userId, name);
    return name;
  }
}

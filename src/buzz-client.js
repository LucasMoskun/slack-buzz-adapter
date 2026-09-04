import { spawn } from "node:child_process";

export class BuzzCliError extends Error {
  constructor(args, code, stderr) {
    super(`Buzz CLI failed (${code}): ${stderr || args.join(" ")}`);
    this.name = "BuzzCliError";
    this.args = args;
    this.code = code;
    this.stderr = stderr;
  }
}

export function runBuzzCli(executable, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new BuzzCliError(args, code, stderr.trim()));
        return;
      }
      resolve(stdout.trim());
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

const DEFAULT_RETRY = { attempts: 6, baseDelayMs: 2000, maxDelayMs: 30000 };

/**
 * True when a failed CLI call is worth retrying: the CLI's JSON error says
 * `retryable: true` (relay 429 quota, transient relay errors) or the exit
 * code is 2 (network). Usage errors (exit 1) and auth errors (exit 3) are not.
 */
export function isRetryableBuzzError(error) {
  if (!(error instanceof BuzzCliError)) return false;
  if (error.code === 2) return true;
  const text = error.stderr || "";
  const start = text.indexOf("{");
  if (start === -1) return false;
  try {
    const parsed = JSON.parse(text.slice(start));
    return parsed?.retryable === true;
  } catch {
    return false;
  }
}

export class BuzzClient {
  constructor({
    executable = "buzz",
    runner = runBuzzCli,
    retry = DEFAULT_RETRY,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onRetry = () => {},
  }) {
    this.executable = executable;
    this.runner = runner;
    this.retry = { ...DEFAULT_RETRY, ...(retry || {}) };
    this.sleep = sleep;
    this.onRetry = onRetry;
  }

  /**
   * Run one CLI command, retrying retryable failures with exponential
   * backoff. The relay rate-limits bursts (429 "quota exceeded"), which a
   * backfill of a few hundred messages will hit; without this the whole
   * backfill aborted on the first 429 (4 Sep 2026).
   */
  async run(args, options) {
    const attempts = Math.max(1, this.retry.attempts);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.runner(this.executable, args, options);
      } catch (error) {
        if (attempt >= attempts || !isRetryableBuzzError(error)) throw error;
        const delayMs = Math.min(
          this.retry.baseDelayMs * 2 ** (attempt - 1),
          this.retry.maxDelayMs,
        );
        this.onRetry({ attempt, delayMs, args, error });
        await this.sleep(delayMs);
      }
    }
  }

  async channelInfo(channelId) {
    const output = await this.run([
      "channels",
      "get",
      "--channel",
      channelId,
    ]);
    return JSON.parse(output);
  }

  async createPrivateChannel(name, description) {
    const output = await this.run([
      "channels",
      "create",
      "--name",
      name,
      "--type",
      "stream",
      "--visibility",
      "private",
      "--description",
      description,
    ]);
    return JSON.parse(output);
  }

  async updateChannelName(channelId, name) {
    const output = await this.run([
      "channels",
      "update",
      "--channel",
      channelId,
      "--name",
      name,
    ]);
    return JSON.parse(output);
  }

  async channelMembers(channelId) {
    const output = await this.run([
      "channels",
      "members",
      "--channel",
      channelId,
    ]);
    return JSON.parse(output);
  }

  async addChannelMember(channelId, pubkey, role) {
    const output = await this.run([
      "channels",
      "add-member",
      "--channel",
      channelId,
      "--pubkey",
      pubkey,
      "--role",
      role,
    ]);
    return JSON.parse(output);
  }

  async sendMessage(channelId, content, replyTo) {
    const args = [
      "messages",
      "send",
      "--channel",
      channelId,
      "--content",
      "-",
    ];
    if (replyTo) args.push("--reply-to", replyTo);
    const output = await this.run(args, { input: content });
    return JSON.parse(output);
  }

  async editMessage(eventId, content) {
    const output = await this.run([
      "messages",
      "edit",
      "--event",
      eventId,
      "--content",
      content,
    ]);
    return JSON.parse(output);
  }

  async getMessages(channelId, limit = 200) {
    const output = await this.run([
      "messages",
      "get",
      "--channel",
      channelId,
      "--limit",
      String(limit),
    ]);
    return JSON.parse(output);
  }
}

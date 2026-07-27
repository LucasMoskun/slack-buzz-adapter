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

export class BuzzClient {
  constructor({ executable = "buzz", runner = runBuzzCli }) {
    this.executable = executable;
    this.runner = runner;
  }

  async channelInfo(channelId) {
    const output = await this.runner(this.executable, [
      "channels",
      "get",
      "--channel",
      channelId,
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
    const output = await this.runner(this.executable, args, { input: content });
    return JSON.parse(output);
  }

  async editMessage(eventId, content) {
    const output = await this.runner(this.executable, [
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
    const output = await this.runner(this.executable, [
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

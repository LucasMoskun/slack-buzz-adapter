import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = Object.freeze({
  version: 1,
  events: {},
  messages: {},
  actors: {},
  conversations: {},
  deliveries: {},
});

export class JsonStateStore {
  constructor(filePath, { maxEvents = 50_000 } = {}) {
    this.filePath = filePath;
    this.maxEvents = maxEvents;
    this.state = structuredClone(EMPTY_STATE);
    this.lockHandle = null;
    this.lockPath = `${filePath}.lock`;
  }

  async acquireLock(owner = "adapter") {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await this.createLock(owner);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const lock = await this.readLock();
      if (lock?.pid && !isProcessRunning(lock.pid)) {
        await unlink(this.lockPath);
        await this.createLock(owner);
        return;
      }
      const details = lock
        ? `${lock.owner || "another process"} (pid ${lock.pid || "unknown"})`
        : "another process";
      throw new Error(
        `State is locked by ${details}. Stop the live adapter before running backfill.`,
      );
    }
  }

  async createLock(owner) {
    this.lockHandle = await open(this.lockPath, "wx", 0o600);
    await this.lockHandle.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        owner,
        startedAt: new Date().toISOString(),
      })}\n`,
    );
  }

  async readLock() {
    try {
      return JSON.parse(await readFile(this.lockPath, "utf8"));
    } catch {
      return null;
    }
  }

  async releaseLock() {
    if (!this.lockHandle) return;
    await this.lockHandle.close();
    this.lockHandle = null;
    try {
      await unlink(this.lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  async load() {
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content);
      if (parsed.version !== 1) {
        throw new Error(`Unsupported state version: ${parsed.version}`);
      }
      this.state = {
        version: 1,
        events: parsed.events ?? {},
        messages: parsed.messages ?? {},
        actors: parsed.actors ?? {},
        conversations: parsed.conversations ?? {},
        deliveries: parsed.deliveries ?? {},
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  hasEvent(eventId) {
    return Boolean(eventId && this.state.events[eventId]);
  }

  getMessage(sourceKey) {
    return this.state.messages[sourceKey];
  }

  getActor(actorKey) {
    return this.state.actors[actorKey];
  }

  getConversation(conversationId) {
    return this.state.conversations[conversationId];
  }

  getDelivery(eventId) {
    return this.state.deliveries[eventId];
  }

  async record({
    eventId,
    sourceKey,
    message,
    actorKey,
    actor,
    conversationId,
    conversation,
  }) {
    if (eventId) this.state.events[eventId] = Date.now();
    if (sourceKey && message) this.state.messages[sourceKey] = message;
    if (actorKey && actor) this.state.actors[actorKey] = actor;
    if (conversationId && conversation) {
      this.state.conversations[conversationId] = conversation;
    }
    this.pruneEvents();
    await this.persist();
  }

  async markEvent(eventId) {
    await this.record({ eventId });
  }

  async recordConversation(conversationId, conversation) {
    await this.record({ conversationId, conversation });
  }

  async recordDelivery(eventId, delivery) {
    this.state.deliveries[eventId] = delivery;
    await this.persist();
  }

  pruneEvents() {
    const entries = Object.entries(this.state.events);
    if (entries.length <= this.maxEvents) return;
    entries.sort(([, left], [, right]) => left - right);
    const removeCount = entries.length - this.maxEvents;
    for (const [eventId] of entries.slice(0, removeCount)) {
      delete this.state.events[eventId];
    }
  }

  async persist() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    const content = `${JSON.stringify(this.state, null, 2)}\n`;
    await writeFile(temporaryPath, content, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

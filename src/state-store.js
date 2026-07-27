import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = Object.freeze({
  version: 1,
  events: {},
  messages: {},
});

export class JsonStateStore {
  constructor(filePath, { maxEvents = 50_000 } = {}) {
    this.filePath = filePath;
    this.maxEvents = maxEvents;
    this.state = structuredClone(EMPTY_STATE);
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

  async record({ eventId, sourceKey, message }) {
    if (eventId) this.state.events[eventId] = Date.now();
    if (sourceKey && message) this.state.messages[sourceKey] = message;
    this.pruneEvents();
    await this.persist();
  }

  async markEvent(eventId) {
    await this.record({ eventId });
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

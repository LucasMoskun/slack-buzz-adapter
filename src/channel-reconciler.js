import {
  loadChannelMappings,
  mappingIndex,
} from "./channel-map.js";
import { syncChannelMappings } from "./channel-sync-service.js";
import {
  mappingNeedsRefresh,
  refreshChannelRoutes,
} from "./route-refresh-service.js";
import { JsonStateStore } from "./state-store.js";

export async function runChannelReconciliation({
  config,
  adapter,
  slackClient,
  buzzClient,
  stateStore,
  workspaceId,
  logger,
  syncChannelMappingsImpl = syncChannelMappings,
  refreshChannelRoutesImpl = refreshChannelRoutes,
  createSyncStateStore = () => new JsonStateStore(config.syncStatePath),
}) {
  const syncStateStore = createSyncStateStore();
  await syncStateStore.acquireLock("internal channel reconciliation");
  try {
    const channelMappings = loadChannelMappings(config.channelMappingsPath, {
      allowMissing: true,
    });
    const syncConfig = {
      ...config,
      channelMappings,
      channelMappingsBySlackId: mappingIndex(channelMappings),
    };
    const syncStats = await syncChannelMappingsImpl({
      config: syncConfig,
      slackClient,
      buzzClient,
      logger,
    });
    const routesChanged = mappingNeedsRefresh(
      config.channelMappingsPath,
      config.routeRefreshHashPath,
    );
    let routeStats;
    if (routesChanged) {
      routeStats = await adapter.runExclusive(() =>
        refreshChannelRoutesImpl({
          config,
          adapter,
          slackClient,
          buzzClient,
          stateStore,
          workspaceId,
          logger,
        }),
      );
    }
    const { channels: _channels, ...syncSummary } = syncStats;
    return {
      ...syncSummary,
      routesChanged,
      routeStats,
    };
  } finally {
    await syncStateStore.releaseLock();
  }
}

export class InternalReconciliationLoop {
  constructor({
    intervalMs,
    task,
    logger,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    this.intervalMs = intervalMs;
    this.task = task;
    this.logger = logger;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.inFlight = null;
    this.stopped = true;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  async runNow() {
    if (this.inFlight) {
      return { ok: true, skipped: "already_running" };
    }
    const run = this.runTask();
    this.inFlight = run;
    try {
      return await run;
    } finally {
      if (this.inFlight === run) this.inFlight = null;
    }
  }

  async runTask() {
    try {
      const stats = await this.task();
      this.logger.info("Internal channel reconciliation completed", stats);
      return { ok: true, stats };
    } catch (error) {
      this.logger.error("Internal channel reconciliation failed", {
        error: error.message,
      });
      return { ok: false, error: error.message };
    }
  }

  schedule(delayMs) {
    this.timer = this.setTimer(async () => {
      this.timer = null;
      await this.runNow();
      if (!this.stopped) this.schedule(this.intervalMs);
    }, delayMs);
    this.timer?.unref?.();
  }
}

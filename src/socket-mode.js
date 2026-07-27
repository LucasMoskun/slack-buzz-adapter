const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export class SlackSocketMode {
  constructor({
    slackClient,
    onEnvelope,
    logger,
    webSocketFactory = (url) => new WebSocket(url),
    reconnectDelays = DEFAULT_RECONNECT_DELAYS_MS,
  }) {
    this.slackClient = slackClient;
    this.onEnvelope = onEnvelope;
    this.logger = logger;
    this.webSocketFactory = webSocketFactory;
    this.reconnectDelays = reconnectDelays;
    this.stopped = false;
    this.socket = null;
  }

  stop() {
    this.stopped = true;
    this.socket?.close();
  }

  async start() {
    let failures = 0;
    while (!this.stopped) {
      try {
        await this.connectOnce();
        failures = 0;
      } catch (error) {
        if (this.stopped) break;
        failures += 1;
        this.logger.error("Socket Mode connection failed", {
          error: error.message,
          failures,
        });
      }

      if (this.stopped) break;
      const index = Math.min(failures, this.reconnectDelays.length - 1);
      const delay = this.reconnectDelays[index];
      this.logger.warn("Reconnecting Socket Mode", { delayMs: delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  async connectOnce() {
    const { url } = await this.slackClient.openSocket();
    if (!url) throw new Error("Slack did not return a Socket Mode URL");

    await new Promise((resolve, reject) => {
      const socket = this.webSocketFactory(url);
      this.socket = socket;
      let opened = false;

      socket.addEventListener("open", () => {
        opened = true;
        this.logger.info("Socket Mode connected");
      });

      socket.addEventListener("message", (message) => {
        void this.handleMessage(socket, message.data);
      });

      socket.addEventListener("error", () => {
        if (!opened) reject(new Error("Socket Mode failed before opening"));
      });

      socket.addEventListener("close", (event) => {
        this.socket = null;
        this.logger.warn("Socket Mode disconnected", {
          code: event.code,
          reason: event.reason || undefined,
        });
        if (opened) resolve();
        else reject(new Error(`Socket Mode closed before opening (${event.code})`));
      });
    });
  }

  async handleMessage(socket, rawData) {
    let envelope;
    try {
      envelope = JSON.parse(String(rawData));
    } catch {
      this.logger.warn("Ignored invalid Socket Mode payload");
      return;
    }

    if (envelope.envelope_id) {
      socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    }

    if (!envelope.payload) return;

    try {
      await this.onEnvelope(envelope.payload);
    } catch (error) {
      this.logger.error("Failed to process Slack envelope", {
        error: error.message,
        eventId: envelope.payload?.event_id,
      });
    }
  }
}

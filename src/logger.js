const LEVELS = new Map([
  ["debug", 10],
  ["info", 20],
  ["warn", 30],
  ["error", 40],
]);

export function createLogger(level = "info", sink = console) {
  const threshold = LEVELS.get(level) ?? LEVELS.get("info");

  function write(name, message, fields = {}) {
    if ((LEVELS.get(name) ?? 100) < threshold) return;
    const record = {
      time: new Date().toISOString(),
      level: name,
      message,
      ...fields,
    };
    const method = name === "error" ? "error" : name === "warn" ? "warn" : "log";
    sink[method](JSON.stringify(record));
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

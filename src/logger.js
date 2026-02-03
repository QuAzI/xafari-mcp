import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./config.js";

const defaultLogPath = path.join(dataDir, "logs", "mcp.jsonl");
const envStdoutEnabled = (process.env.LOG_STDOUT || "").toLowerCase() === "true";

function resolveLogPath(value) {
  if (!value) {
    return defaultLogPath;
  }
  return path.isAbsolute(value) ? value : path.join(dataDir, value);
}

async function ensureLogDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function serializeLog(entry) {
  return `${JSON.stringify(entry)}\n`;
}

function createLogger({ logPath, component, stdout } = {}) {
  const filePath = resolveLogPath(logPath);
  const stdoutEnabled = typeof stdout === "boolean" ? stdout : envStdoutEnabled;
  const base = {
    component: component || "app",
  };

  async function write(entry) {
    const payload = {
      ...base,
      ...entry,
      timestamp: new Date().toISOString(),
    };
    const line = serializeLog(payload);

    if (stdoutEnabled) {
      try {
        // In container logs it's important to keep severities separated:
        // - warn/error → stderr
        // - info/debug → stdout
        const level = String(payload.level || "info").toLowerCase();
        const stream =
          level === "warn" || level === "warning" || level === "error"
            ? process.stderr
            : process.stdout;
        stream.write(line);
      } catch {
        // ignore
      }
    }

    // Keep file logging as the default sink.
    await ensureLogDir(filePath);
    await fs.appendFile(filePath, line, "utf8");
  }

  function wrap(level) {
    return (message, meta = {}) => {
      const entry = {
        level,
        message,
        ...meta,
      };
      write(entry).catch(() => {});
    };
  }

  return {
    log: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    debug: wrap("debug"),
  };
}

export { createLogger };

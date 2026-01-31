import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./config.js";

const defaultLogPath = path.join(dataDir, "logs", "xafari-mcp.jsonl");

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

function createLogger({ logPath, component } = {}) {
  const filePath = resolveLogPath(logPath);
  const base = {
    component: component || "app",
  };

  async function write(entry) {
    const payload = {
      ...base,
      ...entry,
      timestamp: new Date().toISOString(),
    };
    await ensureLogDir(filePath);
    await fs.appendFile(filePath, serializeLog(payload), "utf8");
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

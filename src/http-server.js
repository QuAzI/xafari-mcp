import http from "node:http";
import { URL } from "node:url";
import { httpPort, logFile } from "./config.js";
import { createLogger } from "./logger.js";
import { handleToolCall } from "./index.js";

const logger = createLogger({ component: "http", logPath: logFile });
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== "POST" || !url.pathname.startsWith("/tools/")) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const toolName = url.pathname.replace("/tools/", "").trim();
  if (!toolName) {
    sendJson(res, 400, { error: "Tool name is required" });
    return;
  }

  try {
    const body = await readBody(req);
    const args = body ? JSON.parse(body) : {};
    logger.log("http.tools.call", { tool: toolName });
    const result = await handleToolCall(toolName, args);
    sendJson(res, 200, result);
  } catch (error) {
    logger.error("http.tools.error", { tool: toolName, error: error.message });
    sendJson(res, 500, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    logger.error("http.unhandled", { error: error.message });
    sendJson(res, 500, { error: "Internal server error" });
  });
});

server.listen(httpPort, () => {
  logger.log("http.listening", { port: httpPort });
});

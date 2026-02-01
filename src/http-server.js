import http from "node:http";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { httpPort, logFile } from "./config.js";
import { createLogger } from "./logger.js";
import { handleToolCall, handleMessage } from "./index.js";
import { runWithRequestContext } from "./request-context.js";
import { getPagesPath } from "./storage.js";

const logger = createLogger({ component: "http", logPath: logFile });
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// SSE sessions storage
const sessions = new Map();

function truncateText(text, max = 2000) {
  if (!text || typeof text !== "string") {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...<truncated>`;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function headersSummary(headers) {
  if (!headers) {
    return {};
  }
  const pick = (name) => headers[name] || headers[name?.toLowerCase()];
  return {
    host: pick("host"),
    "content-type": pick("content-type"),
    "content-length": pick("content-length"),
    "mcp-session-id": pick("mcp-session-id"),
  };
}

function sendJson(res, status, payload, meta = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
  logger.log("http.response.json", {
    requestId: meta.requestId,
    status,
    bytes: Buffer.byteLength(body),
    bodyPreview: truncateText(body, 2000),
  });
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

function writeSseEvent(res, event, data) {
  // MCP SSE transport uses:
  // - event: endpoint  (data: <uri to POST messages to>)
  // - event: message   (data: <json-rpc message as JSON string>)
  res.write(`event: ${event}\n`);
  // SSE "data:" can be multi-line; keep it single-line for simplicity
  res.write(`data: ${data}\n\n`);
}

function handleSSEConnection(req, res, sessionId, requestId) {
  // Check if session already exists
  if (sessions.has(sessionId)) {
    res.writeHead(409, { "Content-Type": "text/plain" });
    res.end("Session already exists");
    logger.warn("http.sse.connected.duplicate", { requestId, sessionId });
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Mcp-Session-Id",
  });

  // Store session
  sessions.set(sessionId, res);

  // MCP spec: first send "endpoint" event with URI to POST messages to.
  // Use a relative path (same origin) and include session_id in query string.
  // URL-encode the whole URI as many clients expect it in this form.
  const endpointUri = encodeURI(`/messages?session_id=${sessionId}`);
  writeSseEvent(res, "endpoint", endpointUri);

  // Send keep-alive every 15 seconds (SSE comment format; ignored by clients)
  const keepAliveInterval = setInterval(() => {
    if (sessions.has(sessionId)) {
      // SSE comments (starting with :) are ignored by clients and don't trigger JSON-RPC validation
      res.write(": keep-alive\n\n");
    } else {
      clearInterval(keepAliveInterval);
    }
  }, 15000);

  // Cleanup on disconnect
  req.on("close", () => {
    sessions.delete(sessionId);
    clearInterval(keepAliveInterval);
    logger.log("http.sse.disconnected", { requestId, sessionId });
  });

  logger.log("http.sse.connected", { requestId, sessionId });
}

async function handleSSEMessage(req, res, sessionId, requestId) {
  if (!sessions.has(sessionId)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
    logger.warn("http.sse.message.session_missing", { requestId, sessionId });
    return;
  }

  try {
    const body = await readBody(req);
    const parsed = body ? JSON.parse(body) : null;

    if (!parsed) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Empty request body" }));
      return;
    }

    // Create response handlers that send SSE "message" events.
    const respondFn = (id, result) => {
      const sseRes = sessions.get(sessionId);
      if (sseRes && id !== undefined && id !== null) {
        logger.log("http.sse.rpc.response", {
          requestId,
          sessionId,
          id,
          ok: true,
          resultPreview: truncateText(safeStringify(result), 2000),
        });
        writeSseEvent(
          sseRes,
          "message",
          JSON.stringify({ jsonrpc: "2.0", id, result })
        );
      }
    };

    const respondErrorFn = (id, errorMessage, code = -32000) => {
      const sseRes = sessions.get(sessionId);
      if (sseRes && id !== undefined && id !== null) {
        const logFn =
          code === -32700 || // Parse error
          code === -32600 || // Invalid Request
          code === -32601 || // Method not found
          code === -32602 // Invalid params
            ? logger.warn
            : logger.error; // Server/internal errors

        logFn("http.sse.rpc.response", {
          requestId,
          sessionId,
          id,
          ok: false,
          code,
          message: errorMessage,
        });
        writeSseEvent(
          sseRes,
          "message",
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code, message: errorMessage },
          })
        );
      }
    };

    // Handle single message or batch of messages (JSON-RPC allows arrays).
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    logger.log("http.sse.message.received", {
      requestId,
      sessionId,
      count: messages.length,
      ids: messages.map((m) => m?.id).filter((v) => v !== undefined && v !== null),
      methods: messages.map((m) => m?.method).filter(Boolean),
    });
    for (const message of messages) {
      if (!message || message.jsonrpc !== "2.0") {
        // Best-effort: emit an error if it looks like a request (has id)
        respondErrorFn(message?.id, "Invalid JSON-RPC message", -32700);
        continue;
      }
      await handleMessage(message, respondFn, respondErrorFn);
    }

    // MCP SSE transport: accept the POST; responses go via SSE stream.
    res.writeHead(202, { "Content-Type": "text/plain" });
    res.end("Accepted");
    logger.log("http.sse.message.accepted", { requestId, sessionId });
  } catch (error) {
    logger.error("http.sse.message.error", { sessionId, error: error.message });
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.message }));
  }
}

async function handleRequest(req, res, requestId) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true }, { requestId });
    return;
  }

  // SSE endpoint for MCP
  if (req.method === "GET" && url.pathname === "/sse") {
    // Allow client to provide session ID via query parameter, or generate one
    const sessionId = url.searchParams.get("sessionId") || randomUUID();
    handleSSEConnection(req, res, sessionId, requestId);
    return;
  }

  // Messages endpoint for MCP SSE
  if (req.method === "POST" && url.pathname === "/messages") {
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "session_id query param required" }));
      logger.warn("http.sse.message.bad_request", { requestId });
      return;
    }
    await handleSSEMessage(req, res, sessionId, requestId);
    return;
  }

  // Legacy REST API endpoints
  if (req.method === "POST" && url.pathname.startsWith("/tools/")) {
    const toolName = url.pathname.replace("/tools/", "").trim();
    if (!toolName) {
      sendJson(res, 400, { error: "Tool name is required" });
      return;
    }

    try {
      const body = await readBody(req);
      const args = body ? JSON.parse(body) : {};
      logger.log("http.tools.call", { requestId, tool: toolName, args });
      const result = await handleToolCall(toolName, args);
      sendJson(res, 200, result, { requestId });
    } catch (error) {
      logger.error("http.tools.error", {
        requestId,
        tool: toolName,
        error: error.message,
      });
      sendJson(res, 500, { error: error.message }, { requestId });
    }
    return;
  }

  // Not found
  sendJson(res, 404, { error: "Not found" }, { requestId });
}

function createHttpServer() {
  return http.createServer((req, res) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const filesRead = new Set();
    const ctx = { transport: "http", requestId, filesRead };

    let responseBytes = 0;
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    res.write = (chunk, encoding, cb) => {
      if (chunk) {
        responseBytes += Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(String(chunk), encoding || "utf8");
      }
      return originalWrite(chunk, encoding, cb);
    };
    res.end = (chunk, encoding, cb) => {
      if (chunk) {
        responseBytes += Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(String(chunk), encoding || "utf8");
      }
      return originalEnd(chunk, encoding, cb);
    };

    res.on("finish", () => {
      logger.log("http.request.finish", {
        requestId,
        method: req.method,
        url: req.url,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        responseBytes,
        filesReadCount: filesRead.size,
        filesRead: Array.from(filesRead),
      });
    });

    logger.log("http.request.start", {
      requestId,
      method: req.method,
      url: req.url,
      remoteAddress: req.socket?.remoteAddress,
      remotePort: req.socket?.remotePort,
      headers: headersSummary(req.headers),
    });

    Promise.resolve(
      runWithRequestContext(ctx, () => handleRequest(req, res, requestId))
    ).catch((error) => {
      logger.error("http.unhandled", { requestId, error: error.message });
      sendJson(res, 500, { error: "Internal server error" }, { requestId });
    });
  });
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const pagesPath = getPagesPath();
  logger.log("http.startup", {
    cwd: process.cwd(),
    pagesJsonPath: pagesPath,
    pagesJsonExists: fs.existsSync(pagesPath),
  });
  const server = createHttpServer();
  server.listen(httpPort, () => {
    logger.log("http.listening", { port: httpPort });
  });
}

export { createHttpServer };

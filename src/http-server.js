import http from "node:http";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { httpPort, logFile, serverInfo, serverInstructions, tools } from "./config.js";
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

function escapeHtml(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sendHtml(res, status, html, meta = {}) {
  const body = typeof html === "string" ? html : String(html ?? "");
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
  logger.log("http.response.html", {
    requestId: meta.requestId,
    status,
    bytes: Buffer.byteLength(body),
  });
}

function buildHomePage() {
  const pagesPath = getPagesPath();
  const pagesExist = fs.existsSync(pagesPath);

  const toolsList = Array.isArray(tools) ? tools : [];
  const toolsHtml = toolsList
    .map((t) => {
      const schema = t?.inputSchema ? escapeHtml(JSON.stringify(t.inputSchema, null, 2)) : "";
      return [
        `<div class="tool">`,
        `<div class="tool__name"><code>${escapeHtml(t?.name || "")}</code></div>`,
        t?.description ? `<div class="tool__desc">${escapeHtml(t.description)}</div>` : "",
        schema ? `<details class="tool__schema"><summary>inputSchema</summary><pre>${schema}</pre></details>` : "",
        `</div>`,
      ].join("\n");
    })
    .join("\n");

  const infoName = escapeHtml(serverInfo?.name || "mcp-server");
  const infoVersion = escapeHtml(serverInfo?.version || "");
  const infoDesc = escapeHtml(serverInfo?.description || "");
  const instructions = escapeHtml(serverInstructions || "");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${infoName}</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; }
      .wrap { max-width: 980px; margin: 0 auto; padding: 28px 20px; }
      .title { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
      h1 { margin: 0; font-size: 22px; }
      .ver { opacity: .7; font-size: 14px; }
      .desc { margin-top: 10px; opacity: .85; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 18px; }
      .card { border: 1px solid rgba(127,127,127,.35); border-radius: 12px; padding: 14px; }
      .kv { display: grid; grid-template-columns: 220px 1fr; gap: 8px 12px; }
      .kv b { opacity: .85; }
      pre { overflow: auto; padding: 10px; border-radius: 10px; background: rgba(127,127,127,.12); }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 13px; }
      a { color: inherit; }
      .tools { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 12px; }
      .tool__name { font-weight: 600; }
      .tool__desc { margin-top: 6px; opacity: .85; }
      .tool__schema { margin-top: 8px; }
      .muted { opacity: .7; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="title">
        <h1>${infoName}</h1>
        ${infoVersion ? `<span class="ver">v${infoVersion}</span>` : ""}
      </div>
      ${infoDesc ? `<div class="desc">${infoDesc}</div>` : ""}

      <div class="grid">
        <div class="card">
          <div class="kv">
            <b>Health</b><div><a href="/health"><code>/health</code></a></div>
            <b>MCP SSE</b><div><a href="/sse"><code>/sse</code></a> <span class="muted">(opens an SSE stream)</span></div>
            <b>Pages index</b><div><code>${escapeHtml(pagesPath)}</code> — ${pagesExist ? "found" : "missing"}</div>
          </div>
        </div>

        <div class="card">
          <b>Instructions</b>
          <pre>${instructions || "(none)"}</pre>
        </div>

        <div class="card">
          <b>Tools (${toolsList.length})</b>
          <div class="tools">
            ${toolsHtml || '<div class="muted">(no tools)</div>'}
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
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

  // Home page with server info
  if (req.method === "GET" && url.pathname === "/") {
    sendHtml(res, 200, buildHomePage(), { requestId });
    return;
  }

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

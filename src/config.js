import path from "node:path";
import { fileURLToPath } from "node:url";

// Crawler settings
const baseUrl = process.env.DOCS_BASE_URL;

// MCP server metadata
// Note: Cursor shows MCP server "instructions" in Tools & MCP.
// Keep SERVER_INFO for backward compatibility (historically used as the name).
const serverName =
  process.env.SERVER_NAME ||
  process.env.SERVER_INFO_NAME ||
  process.env.SERVER_INFO ||
  "custom-framework-mcp";

const serverDescription =
  process.env.SERVER_DESCRIPTION ||
  "MCP server for local documentation.";

const httpPort = Number.parseInt(process.env.HTTP_PORT || "3333", 10);

function normalizePrefix(value) {
  const raw = (value ?? "").toString().trim();
  if (!raw) return null;
  // Keep it tool-name safe-ish: letters, digits, underscore.
  const cleaned = raw.replace(/[^\p{L}\p{N}_]+/gu, "_");
  return cleaned || null;
}

// If no base URL is configured, fetching on cache miss can't work.
// Default: true when DOCS_BASE_URL is set; otherwise false.
const fetchOnMiss =
  !!baseUrl &&
  (process.env.FETCH_ON_MISS ?? "true").toLowerCase() !== "false";

// Tools prefix:
// - If TOOLS_PREFIX is set (and non-empty), tools are exposed as `${prefix}<name>`
// - Otherwise, tools are exposed unprefixed (base names)
const toolsPrefix = normalizePrefix(process.env.TOOLS_PREFIX) || "";

const docsHint = baseUrl
  ? `Docs at ${baseUrl})`
  : "";

const serverInfo = {
  name: serverName,
  version: "2026.2.0",
  // Non-standard field; safe for most clients and useful for UIs.
  description: serverDescription,
};

const baseTools = [
  {
    name: "search_docs",
    description:
      `Search documentation by text query.\n${docsHint}\n` +
      "Uses a local index (fast, deterministic).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (docs)." },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_page",
    description:
      `Return full extracted content for a documentation page.\n${docsHint}\n` +
      "Accepts slug or full URL.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Short slug (e.g. doc_recursive_helper).",
        },
        url: {
          type: "string",
          description: "Full page URL.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_examples",
    description:
      `Extract code examples from documentation pages related to a topic.\n${docsHint}\n`,
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to search examples for (docs)." },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["topic"],
    },
  },
  {
    name: "explain_concept",
    description:
      `Explain a concept using the most relevant documentation.\n${docsHint}\n`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Concept name (docs)." },
      },
      required: ["name"],
    },
  },
];

function addPrefix(tool, prefix) {
  return {
    ...tool,
    name: `${prefix}${tool.name}`,
    description: `${tool.description}`,
  };
}

const tools = toolsPrefix ? baseTools.map((t) => addPrefix(t, toolsPrefix)) : baseTools;

// Backward/forward compatibility: normalize prefixed calls back to base names.
const toolAliases = toolsPrefix
  ? Object.fromEntries(tools.map((t) => [t.name, t.name.replace(`${toolsPrefix}`, "")]))
  : {};

const serverInstructions =
  process.env.SERVER_INSTRUCTIONS ||
  [
    serverDescription,
    baseUrl ? `Docs base URL: ${baseUrl}` : "Docs base URL: not configured",
    `Tools: ${tools.map((t) => t.name).join(", ")}.`,
    fetchOnMiss
      ? "Fetch-on-miss: enabled (FETCH_ON_MISS=true)"
      : "Fetch-on-miss: disabled (FETCH_ON_MISS=false or DOCS_BASE_URL not set)",
    toolsPrefix ? `Tools prefix: ${toolsPrefix}*` : "Tools prefix: (none)",
  ]
    .filter(Boolean)
    .join("\n");

const maxPagesPerSession = Number.parseInt(
  process.env.MAX_PAGES_PER_SESSION || "10000", 10
);

const userAgent = process.env.USER_AGENT || "docs-mcp-crawler/0.1";

const requestTimeoutMs = Number.parseInt(
  process.env.REQUEST_TIMEOUT_MS || "15000", 10
);

const codeLanguages = (process.env.CODE_LANGUAGES ||
  "cs,js,ts,json,yaml,xml,html,css")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(projectRoot, "data");
  
const logFile = process.env.LOG_FILE || "logs/mcp.jsonl";  

export {
  baseUrl,
  dataDir,
  maxPagesPerSession,
  fetchOnMiss,
  logFile,
  codeLanguages,
  httpPort,
  requestTimeoutMs,
  userAgent,
  serverInfo,
  serverInstructions,
  tools,
  toolAliases,
};

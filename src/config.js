import path from "node:path";
import { fileURLToPath } from "node:url";

// Crawler settings
const baseUrl = process.env.DOCS_BASE_URL;

// MCP HTTP server settings
const serverInfoName = process.env.SERVER_INFO || "MCP with documentation for custom framework used in the project";

const httpPort = Number.parseInt(process.env.HTTP_PORT || "3333", 10);

// If no base URL is configured, fetching on cache miss can't work.
// Default: true when DOCS_BASE_URL is set; otherwise false.
const fetchOnMiss =
  !!baseUrl &&
  (process.env.FETCH_ON_MISS ?? "true").toLowerCase() !== "false";

// MCP server metadata (server + tools)
const serverInfo = {
  name: serverInfoName,
  version: "2026.2.0",
};

const tools = [
  {
    name: "search_docs",
    description: "Search documentation pages by text query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_page",
    description: "Return the full extracted content for a documentation page.",
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
    description: "Extract code examples related to a topic.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to search examples for." },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["topic"],
    },
  },
  {
    name: "explain_concept",
    description: "Explain a concept using the most relevant documentation.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Concept name." },
      },
      required: ["name"],
    },
  },
];

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
  tools,
};

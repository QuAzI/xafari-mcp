import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const dataDir = process.env.XAFARI_DATA_DIR
  ? path.resolve(process.env.XAFARI_DATA_DIR)
  : path.join(projectRoot, "data");

const baseUrl =
  process.env.XAFARI_DOCS_BASE_URL ||
  "https://documentation.galaktika-soft.com/xafari/";

const maxPagesPerSession = Number.parseInt(
  process.env.XAFARI_MAX_PAGES_PER_SESSION || "1000",
  10
);
const fetchOnMiss =
  (process.env.XAFARI_FETCH_ON_MISS || "true").toLowerCase() !== "false";
const logFile = process.env.XAFARI_LOG_FILE || "logs/xafari-mcp.jsonl";
const codeLanguages = (process.env.XAFARI_CODE_LANGUAGES ||
  "cs,js,ts,json,yaml,xml,html,css")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const requestTimeoutMs = Number.parseInt(
  process.env.XAFARI_REQUEST_TIMEOUT_MS || "15000",
  10
);
const userAgent =
  process.env.XAFARI_USER_AGENT ||
  "xafari-mcp-crawler/0.1 (+https://galaktika-soft.com/xafari)";

export {
  baseUrl,
  dataDir,
  maxPagesPerSession,
  fetchOnMiss,
  logFile,
  codeLanguages,
  requestTimeoutMs,
  userAgent,
};

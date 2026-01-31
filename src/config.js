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

const maxPages = Number.parseInt(process.env.XAFARI_MAX_PAGES || "300", 10);
const requestTimeoutMs = Number.parseInt(
  process.env.XAFARI_REQUEST_TIMEOUT_MS || "15000",
  10
);
const userAgent =
  process.env.XAFARI_USER_AGENT ||
  "xafari-mcp-crawler/0.1 (+https://galaktika-soft.com/xafari)";

export { baseUrl, dataDir, maxPages, requestTimeoutMs, userAgent };

#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  loadIndex,
  loadPages,
  loadPagesFromMarkdown,
  saveIndex,
  savePageMarkdown,
  savePages,
  getIndexPath,
  getPagesPath,
} from "./storage.js";
import { searchIndex } from "./search.js";
import { buildIndex } from "./indexer.js";
import {
  baseUrl,
  fetchOnMiss,
  logFile,
  requestTimeoutMs,
  userAgent,
  codeLanguages,
} from "./config.js";
import {
  extractBreadcrumbs,
  extractHeadings,
  extractLinks,
  extractText,
  extractTitle,
} from "./html.js";
import { createLogger } from "./logger.js";

const SERVER_INFO = {
  name: "xafari-mcp",
  version: "0.1.0",
};

const TOOLS = [
  {
    name: "search_docs",
    description: "Search Xafari documentation pages by text query.",
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

let pagesCache = null;
let indexCache = null;
let pageBySlug = null;
let pageByUrl = null;
const logger = createLogger({ component: "server", logPath: logFile });

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        "Accept-Language": "ru,en;q=0.8",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadData() {
  if (pagesCache && indexCache) {
    return { pages: pagesCache, index: indexCache };
  }

  try {
    const [pages, index] = await Promise.all([loadPages(), loadIndex()]);
    pagesCache = pages;
    indexCache = index;
    pageBySlug = new Map(pages.map((page) => [page.slug, page]));
    pageByUrl = new Map(pages.map((page) => [page.url, page]));
    return { pages, index };
  } catch (error) {
    const message = [
      "Index data not found.",
      `Expected files: ${getPagesPath()} and ${getIndexPath()}`,
      "Run: npm run crawl",
    ].join("\n");
    const err = new Error(message);
    err.code = "DATA_MISSING";
    throw err;
  }
}

function respond(id, result) {
  if (id === undefined || id === null) {
    return;
  }
  const payload = { jsonrpc: "2.0", id, result };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function respondError(id, message) {
  if (id === undefined || id === null) {
    return;
  }
  const payload = {
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message },
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function toolResult(text, extra = {}) {
  return {
    content: [{ type: "text", text }],
    ...extra,
  };
}

function resolvePage(slug) {
  if (!slug) {
    return null;
  }
  const trimmed = slug.trim();
  if (pageByUrl?.has(trimmed)) {
    return pageByUrl.get(trimmed);
  }
  if (pageBySlug?.has(trimmed)) {
    return pageBySlug.get(trimmed);
  }
  if (trimmed.startsWith("http")) {
    const withoutHash = trimmed.split("#")[0];
    return pageByUrl?.get(withoutHash) || null;
  }
  return pageBySlug?.get(trimmed.replace(/^\/+/, "")) || null;
}

function resolvePageFromPages(pages, slug) {
  if (!slug || !Array.isArray(pages)) {
    return null;
  }
  const trimmed = slug.trim();
  const byUrl = pages.find((page) => page.url === trimmed);
  if (byUrl) {
    return byUrl;
  }
  const normalizedSlug = trimmed.replace(/^\/+/, "");
  const bySlug = pages.find((page) => page.slug === normalizedSlug);
  if (bySlug) {
    return bySlug;
  }
  if (trimmed.startsWith("http")) {
    const withoutHash = trimmed.split("#")[0];
    return pages.find((page) => page.url === withoutHash) || null;
  }
  return null;
}
function resolvePageUrl(slug) {
  const trimmed = slug.trim();
  if (trimmed.startsWith("http")) {
    return trimmed.split("#")[0];
  }
  const safeSlug = trimmed.replace(/^\/+/, "");
  return new URL(safeSlug, baseUrl).toString();
}

async function fetchAndCachePage(slug) {
  const url = resolvePageUrl(slug);
  logger.log("get_page.fetch_on_miss.start", { slug, url });
  const html = await fetchHtml(url);
  const allowedLanguages =
    codeLanguages && codeLanguages.length > 0
      ? new Set(codeLanguages)
      : null;
  const title = extractTitle(html) || url;
  const breadcrumbs = extractBreadcrumbs(html);
  const headings = extractHeadings(html);
  const { text, codeBlocks } = extractText(html, url, { allowedLanguages });
  const links = extractLinks(html);
  const urlObj = new URL(url);
  const slugValue = urlObj.pathname.startsWith(new URL(baseUrl).pathname)
    ? urlObj.pathname.slice(new URL(baseUrl).pathname.length) || "index"
    : urlObj.pathname.replace(/^\/+/, "") || "index";

  const page = {
    slug: slugValue,
    url,
    title,
    breadcrumbs,
    headings,
    text,
    codeBlocks,
    links,
    etag: null,
    lastModified: null,
    updatedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
  };

  await savePageMarkdown(page, undefined, logger);
  const pages = await loadPagesFromMarkdown();
  const index = buildIndex(pages);
  await savePages(pages);
  await saveIndex(index);

  pagesCache = pages;
  indexCache = index;
  pageBySlug = new Map(pages.map((item) => [item.slug, item]));
  pageByUrl = new Map(pages.map((item) => [item.url, item]));

  logger.log("get_page.fetch_on_miss.saved", { slug: page.slug, url: page.url });
  return page;
}

async function handleToolCall(name, args, options = {}) {
  const { loadDataImpl, fetchOnMissOverride, fetchAndCachePageImpl } = options;
  const { pages, index } = loadDataImpl ? await loadDataImpl() : await loadData();
  logger.log("tools.call", { name, args });

  if (name === "search_docs") {
    const limit = Number.isFinite(args?.limit) ? args.limit : 5;
    const results = searchIndex(index, pages, args.query, limit);
    return toolResult(JSON.stringify(results, null, 2));
  }

  if (name === "get_page") {
    const lookup = args.url || args.slug;
    const page = resolvePage(lookup) || resolvePageFromPages(pages, lookup);
    if (!page) {
      const allowFetch =
        typeof fetchOnMissOverride === "boolean" ? fetchOnMissOverride : fetchOnMiss;
      if (allowFetch) {
        try {
          const fetched = fetchAndCachePageImpl
            ? await fetchAndCachePageImpl(lookup)
            : await fetchAndCachePage(lookup);
          return toolResult(JSON.stringify(fetched, null, 2));
        } catch (error) {
          logger.warn("get_page.fetch_on_miss.failed", {
            slug: lookup,
            error: error.message,
          });
          return toolResult(
            `Page not found and fetch failed for slug: ${lookup}. ${error.message}`,
            { isError: true }
          );
        }
      }
      return toolResult(`Page not found for slug: ${lookup}`, { isError: true });
    }
    return toolResult(JSON.stringify(page, null, 2));
  }

  if (name === "get_examples") {
    const limit = Number.isFinite(args?.limit) ? args.limit : 5;
    const search = searchIndex(index, pages, args.topic, limit);
    const examples = [];
    for (const result of search.results) {
      const page = resolvePage(result.slug);
      if (!page || !Array.isArray(page.codeBlocks)) {
        continue;
      }
      for (const code of page.codeBlocks) {
        if (!code) {
          continue;
        }
        examples.push({
          slug: page.slug,
          title: page.title,
          url: page.url,
          code,
        });
        if (examples.length >= limit) {
          break;
        }
      }
      if (examples.length >= limit) {
        break;
      }
    }
    return toolResult(JSON.stringify({ topic: args.topic, examples }, null, 2));
  }

  if (name === "explain_concept") {
    const search = searchIndex(index, pages, args.name, 3);
    if (!search.results.length) {
      return toolResult(`No documentation found for: ${args.name}`, {
        isError: true,
      });
    }
    const primary = search.results[0];
    const explanation = {
      concept: args.name,
      summary: primary.excerpt,
      page: {
        slug: primary.slug,
        title: primary.title,
        url: primary.url,
      },
      related: search.results.slice(1).map((item) => ({
        slug: item.slug,
        title: item.title,
        url: item.url,
      })),
    };
    return toolResult(JSON.stringify(explanation, null, 2));
  }

  return toolResult(`Unknown tool: ${name}`, { isError: true });
}

async function handleMessage(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    respond(id, {
      protocolVersion: "2024-11-05",
      serverInfo: SERVER_INFO,
      capabilities: {
        tools: {},
      },
    });
    return;
  }

  if (method === "tools/list") {
    respond(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    try {
      const result = await handleToolCall(params?.name, params?.arguments || {});
      respond(id, result);
    } catch (error) {
      respondError(id, error.message || "Tool call failed.");
    }
    return;
  }

  if (id !== undefined && id !== null) {
    respondError(id, `Unsupported method: ${method}`);
  }
}

function startServer() {
  let buffer = "";
  let pendingContentLength = null;
  process.stdin.setEncoding("utf8");

  function emitParseError() {
    const payload = {
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error" },
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  function processBuffer() {
    while (buffer.length > 0) {
      if (pendingContentLength !== null) {
        if (buffer.length < pendingContentLength) {
          return;
        }
        const jsonPayload = buffer.slice(0, pendingContentLength);
        buffer = buffer.slice(pendingContentLength);
        pendingContentLength = null;
        try {
          const message = JSON.parse(jsonPayload);
          handleMessage(message);
        } catch {
          emitParseError();
        }
        continue;
      }

      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd >= 0 && buffer.slice(0, headerEnd).includes("Content-Length:")) {
        const header = buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        buffer = buffer.slice(headerEnd + 4);
        if (!match) {
          emitParseError();
          continue;
        }
        pendingContentLength = Number.parseInt(match[1], 10);
        continue;
      }

      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      try {
        const message = JSON.parse(line);
        handleMessage(message);
      } catch {
        emitParseError();
      }
    }
  }

  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    processBuffer();
  });

  process.stdin.on("end", () => {
    process.exit(0);
  });
}

function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  startServer();
}

export { fetchAndCachePage, handleToolCall, startServer };

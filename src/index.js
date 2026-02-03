#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  loadIndex,
  loadPages,
  loadPagesFromMarkdown,
  loadPageMarkdownByMetadata,
  saveIndex,
  savePageMarkdown,
  savePages,
  getIndexPath,
  getPagesPath,
} from "./storage.js";
import { buildExcerpt, searchIndex } from "./search.js";
import { buildIndex } from "./indexer.js";
import {
  baseUrl,
  fetchOnMiss,
  logFile,
  requestTimeoutMs,
  userAgent,
  codeLanguages,
  serverInfo as SERVER_INFO,
  serverInstructions as SERVER_INSTRUCTIONS,
  tools as TOOLS,
  toolAliases as TOOL_ALIASES,
} from "./config.js";
import {
  extractBreadcrumbs,
  extractHeadings,
  extractLinks,
  extractText,
  extractTitle,
} from "./html.js";
import { createLogger } from "./logger.js";

let pagesCache = null;
let indexCache = null;
let pageBySlug = null;
let pageByUrl = null;
const logger = createLogger({ component: "server", logPath: logFile });
let dataMissingLogged = false;

class McpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function logStartupInfo() {
  const pagesPath = getPagesPath();
  logger.log("server.startup", {
    cwd: process.cwd(),
    pagesJsonPath: pagesPath,
    pagesJsonExists: fs.existsSync(pagesPath),
  });
}

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
    if (!dataMissingLogged) {
      dataMissingLogged = true;
      const pagesPath = getPagesPath();
      const indexPath = getIndexPath();
      let pagesStat = null;
      let indexStat = null;
      try {
        const st = fs.statSync(pagesPath);
        pagesStat = { size: st.size, mtimeMs: st.mtimeMs, mode: st.mode };
      } catch (e) {
        pagesStat = { error: e?.code || e?.message || String(e) };
      }
      try {
        const st = fs.statSync(indexPath);
        indexStat = { size: st.size, mtimeMs: st.mtimeMs, mode: st.mode };
      } catch (e) {
        indexStat = { error: e?.code || e?.message || String(e) };
      }
      logger.error("data.missing", {
        cwd: process.cwd(),
        pagesJsonPath: pagesPath,
        pagesJsonExists: fs.existsSync(pagesPath),
        pagesJsonStat: pagesStat,
        indexJsonPath: indexPath,
        indexJsonExists: fs.existsSync(indexPath),
        indexJsonStat: indexStat,
        errorName: error?.name,
        errorMessage: error?.message,
      });
    }
    const message = [
      "Index data not found (or failed to load).",
      `Expected files: ${getPagesPath()} and ${getIndexPath()}`,
      `Underlying error: ${error?.message || String(error)}`,
      "If the files exist, they may be too large or invalid JSON.",
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

function respondError(id, message, code = -32000) {
  if (id === undefined || id === null) {
    return;
  }
  const payload = {
    jsonrpc: "2.0",
    id,
    error: { code, message },
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
  const requestedName = name;
  const normalizedName = TOOL_ALIASES?.[name] || name;
  logger.log("tools.call", { name: requestedName, normalizedName, args });

  if (normalizedName === "search_docs") {
    const query = asNonEmptyString(args?.query);
    if (!query) {
      throw new McpError(-32602, 'Invalid params: "query" (string) is required.');
    }
    const { pages, index } = loadDataImpl ? await loadDataImpl() : await loadData();
    const limit = Number.isFinite(args?.limit) ? args.limit : 5;
    const results = searchIndex(index, pages, query, limit);
    // Improve excerpts/headings by loading full markdown for top results.
    const enriched = [];
    for (const item of results.results) {
      const meta = pages[item.pageId];
      const full = meta ? await loadPageMarkdownByMetadata(meta) : null;
      enriched.push({
        ...item,
        excerpt: full ? buildExcerpt(full.text || "", results.tokens) : item.excerpt,
        headings: full?.headings || item.headings || [],
      });
    }
    return toolResult(JSON.stringify({ ...results, results: enriched }, null, 2));
  }

  if (normalizedName === "get_page") {
    const lookup = asNonEmptyString(args?.url) || asNonEmptyString(args?.slug);
    if (!lookup) {
      throw new McpError(-32602, 'Invalid params: provide "slug" or "url" (string).');
    }
    const { pages, index } = loadDataImpl ? await loadDataImpl() : await loadData();
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
    const full = await loadPageMarkdownByMetadata(page);
    return toolResult(JSON.stringify(full || page, null, 2));
  }

  if (normalizedName === "get_examples") {
    const topic = asNonEmptyString(args?.topic);
    if (!topic) {
      throw new McpError(-32602, 'Invalid params: "topic" (string) is required.');
    }
    const { pages, index } = loadDataImpl ? await loadDataImpl() : await loadData();
    const limit = Number.isFinite(args?.limit) ? args.limit : 5;
    const search = searchIndex(index, pages, topic, limit);
    const examples = [];
    for (const result of search.results) {
      const pageMeta = resolvePage(result.slug);
      const page = pageMeta ? await loadPageMarkdownByMetadata(pageMeta) : null;
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
    return toolResult(JSON.stringify({ topic, examples }, null, 2));
  }

  if (normalizedName === "explain_concept") {
    const concept = asNonEmptyString(args?.name);
    if (!concept) {
      throw new McpError(-32602, 'Invalid params: "name" (string) is required.');
    }
    const { pages, index } = loadDataImpl ? await loadDataImpl() : await loadData();
    const search = searchIndex(index, pages, concept, 3);
    if (!search.results.length) {
      return toolResult(`No documentation found for: ${concept}`, {
        isError: true,
      });
    }
    const primary = search.results[0];
    const primaryMeta = primary?.pageId !== undefined ? pages[primary.pageId] : null;
    const primaryFull = primaryMeta ? await loadPageMarkdownByMetadata(primaryMeta) : null;
    const explanation = {
      concept,
      summary: primaryFull ? buildExcerpt(primaryFull.text || "", search.tokens) : primary.excerpt,
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

  return toolResult(`Unknown tool: ${requestedName}`, { isError: true });
}

async function handleMessage(message, customRespond = null, customRespondError = null) {
  const { id, method, params } = message;
  const respondFn = customRespond || respond;
  const respondErrorFn = customRespondError || respondError;

  if (method === "initialize") {
    respondFn(id, {
      protocolVersion: "2024-11-05",
      serverInfo: SERVER_INFO,
      instructions: SERVER_INSTRUCTIONS,
      capabilities: {
        tools: {},
      },
    });
    return;
  }

  if (method === "tools/list") {
    respondFn(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    try {
      const result = await handleToolCall(params?.name, params?.arguments || {});
      respondFn(id, result);
    } catch (error) {
      respondErrorFn(
        id,
        error?.message || "Tool call failed.",
        Number.isFinite(error?.code) ? error.code : -32000
      );
    }
    return;
  }

  if (id !== undefined && id !== null) {
    respondErrorFn(id, `Unsupported method: ${method}`, -32601);
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
  logStartupInfo();
  startServer();
}

export { fetchAndCachePage, handleToolCall, handleMessage, startServer };

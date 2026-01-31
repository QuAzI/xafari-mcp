import { pathToFileURL } from "node:url";
import {
  baseUrl,
  maxPagesPerSession,
  logFile,
  requestTimeoutMs,
  userAgent,
} from "./config.js";
import {
  extractBreadcrumbs,
  extractHeadings,
  extractLinks,
  extractText,
  extractTitle,
} from "./html.js";
import { buildIndex } from "./indexer.js";
import {
  loadPagesFromMarkdown,
  saveIndex,
  savePageMarkdown,
  savePages,
} from "./storage.js";
import { createLogger } from "./logger.js";

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    forceFetch: args.has("--force"),
    onlyNew: args.has("--only-new"),
  };
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isSameDomain(url, rootUrl) {
  return url.hostname === rootUrl.hostname;
}

function isWithinBasePath(url, rootUrl) {
  return url.pathname.startsWith(rootUrl.pathname);
}

function toSlug(url, rootUrl) {
  if (!url.pathname.startsWith(rootUrl.pathname)) {
    return url.pathname;
  }
  const slug = url.pathname.slice(rootUrl.pathname.length);
  return slug || "index";
}

async function fetchHtml(url, extraHeaders = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": userAgent,
        "Accept-Language": "ru,en;q=0.8",
        ...extraHeaders,
      },
      signal: controller.signal,
    });

    if (response.status === 304) {
      return {
        status: 304,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return {
      status: response.status,
      html: await response.text(),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadExistingPages(loadPagesImpl = loadPagesFromMarkdown) {
  try {
    const pages = await loadPagesImpl();
    return Array.isArray(pages) ? pages : [];
  } catch {
    return [];
  }
}

async function runCrawl(options = {}) {
  const {
    forceFetch = false,
    onlyNew = false,
    baseUrlOverride,
    maxPagesPerSessionOverride,
    maxPagesOverride,
    fetchImpl,
    loadPagesImpl,
    savePageMarkdownImpl,
    loadPagesForIndexImpl,
    savePagesImpl,
    saveIndexImpl,
    logger = createLogger({ component: "crawler", logPath: logFile }),
  } = options;
  const rootUrl = new URL(baseUrlOverride || baseUrl);
  const queue = [rootUrl.toString()];
  const visited = new Set();
  const existingPages = await loadExistingPages(loadPagesImpl);
  const existingByUrl = new Map(existingPages.map((page) => [page.url, page]));
  const pages = [];
  let reusedCount = 0;
  let fetchedCount = 0;

  const sessionLimit =
    maxPagesPerSessionOverride ??
    (Number.isFinite(maxPagesPerSession) ? maxPagesPerSession : 0);
  const effectiveSessionLimit = sessionLimit > 0 ? sessionLimit : Infinity;
  const sessionLimitLabel = Number.isFinite(effectiveSessionLimit)
    ? effectiveSessionLimit
    : "∞";
  const totalLimit =
    Number.isFinite(maxPagesOverride) && maxPagesOverride > 0
      ? maxPagesOverride
      : Infinity;
  const totalLimitLabel = Number.isFinite(totalLimit) ? totalLimit : "∞";
  logger.log("crawl.start", {
    baseUrl: rootUrl.toString(),
    sessionLimit: sessionLimitLabel,
    totalLimit: totalLimitLabel,
  });
  while (
    queue.length > 0 &&
    pages.length < totalLimit &&
    fetchedCount < effectiveSessionLimit
  ) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    let response;
    let html;
    const existing = existingByUrl.get(current);
    const conditionalHeaders = {};
    if (!forceFetch) {
      if (existing?.etag) {
        conditionalHeaders["If-None-Match"] = existing.etag;
      }
      if (existing?.lastModified) {
        conditionalHeaders["If-Modified-Since"] = existing.lastModified;
      }
    }
    try {
      if (!forceFetch && onlyNew && existing && existing.links?.length) {
        response = { status: 304, etag: existing.etag, lastModified: existing.lastModified };
      } else {
        response = await fetchHtml(current, conditionalHeaders, fetchImpl);
      }
      if (response.status === 304 && (!existing?.links || existing.links.length === 0)) {
        response = await fetchHtml(current, {}, fetchImpl);
      }
    } catch (error) {
      logger.warn("crawl.skip", { url: current, error: error.message });
      continue;
    }

    let links = [];
    if (response.status === 304 && existing) {
      const page = {
        ...existing,
        etag: response.etag ?? existing.etag ?? null,
        lastModified: response.lastModified ?? existing.lastModified ?? null,
        lastCheckedAt: new Date().toISOString(),
      };
      pages.push(page);
      links = existing.links || [];
      reusedCount += 1;
      if (savePageMarkdownImpl) {
        await savePageMarkdownImpl(page);
      } else {
        await savePageMarkdown(page);
      }
    } else {
      html = response.html;
      const title = extractTitle(html) || current;
      const breadcrumbs = extractBreadcrumbs(html);
      const headings = extractHeadings(html);
      const { text, codeBlocks } = extractText(html);
      const urlObj = new URL(current);
      links = extractLinks(html);

      const page = {
        slug: toSlug(urlObj, rootUrl),
        url: current,
        title,
        breadcrumbs,
        headings,
        text,
        codeBlocks,
        links,
        etag: response.etag || null,
        lastModified: response.lastModified || null,
        updatedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
      };
      pages.push(page);
      fetchedCount += 1;
      if (savePageMarkdownImpl) {
        await savePageMarkdownImpl(page);
      } else {
        await savePageMarkdown(page);
      }
    }

    for (const link of links) {
      if (!link || link.startsWith("#")) {
        continue;
      }
      if (link.startsWith("mailto:") || link.startsWith("javascript:")) {
        continue;
      }
      const normalized = normalizeUrl(new URL(link, current).toString());
      if (!normalized) {
        continue;
      }
      const normalizedUrl = new URL(normalized);
      if (!isSameDomain(normalizedUrl, rootUrl)) {
        continue;
      }
      if (!isWithinBasePath(normalizedUrl, rootUrl)) {
        continue;
      }
      if (!visited.has(normalized)) {
        queue.push(normalized);
      }
    }

    logger.log("crawl.progress", {
      url: current,
      total: pages.length,
      totalLimit: totalLimitLabel,
      fetched: fetchedCount,
      fetchedLimit: sessionLimitLabel,
    });
  }

  const pagesForIndex = loadPagesForIndexImpl
    ? await loadPagesForIndexImpl(pages)
    : await loadPagesFromMarkdown();
  const index = buildIndex(pagesForIndex);
  if (savePagesImpl) {
    await savePagesImpl(pagesForIndex);
  } else {
    await savePages(pagesForIndex);
  }
  if (saveIndexImpl) {
    await saveIndexImpl(index);
  } else {
    await saveIndex(index);
  }

  logger.log("crawl.saved", {
    total: pages.length,
    fetched: fetchedCount,
    reused: reusedCount,
  });
  return { pages, index, fetchedCount, reusedCount };
}

function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const { forceFetch, onlyNew } = parseArgs(process.argv.slice(2));
  runCrawl({ forceFetch, onlyNew }).catch((error) => {
    console.error(`[crawl] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export { runCrawl, parseArgs };

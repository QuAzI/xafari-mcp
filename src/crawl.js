import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  baseUrl,
  maxPagesPerSession,
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
import { buildIndex, tokenize } from "./indexer.js";
import {
  getPagesPath,
  loadPageMarkdownByMetadata,
  loadPageMetadataFromMarkdown,
  loadPagesFromMarkdown,
  saveBinaryAsset,
  saveIndex,
  savePageMarkdown,
  savePages,
} from "./storage.js";
import { createLogger } from "./logger.js";

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    forceFetch: args.has("--force"),
    onlyNew: args.has("--only-new") || !args.has("--no-only-new"),
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

function isBinaryPath(pathname) {
  const lower = pathname.toLowerCase();
  const binaryExtensions = [
    ".zip",
    ".7z",
    ".rar",
    ".tar",
    ".gz",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".mp4",
    ".mp3",
    ".avi",
    ".mov",
    ".wmv",
    ".exe",
    ".msi",
  ];
  return binaryExtensions.some((ext) => lower.endsWith(ext));
}

function isDownloadableAsset(pathname) {
  const lower = pathname.toLowerCase();
  const assetExtensions = [
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
  ];
  return assetExtensions.some((ext) => lower.endsWith(ext));
}

function isHtmlContentType(contentType) {
  return (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml")
  );
}

function isAssetContentType(contentType) {
  return (
    contentType.includes("application/pdf") ||
    contentType.startsWith("image/")
  );
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

async function fetchResource(url, extraHeaders = {}, fetchImpl = fetch) {
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

    const contentType = response.headers.get("content-type") || "";
    if (contentType && isHtmlContentType(contentType)) {
      return {
        status: response.status,
        kind: "html",
        html: await response.text(),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        contentType,
      };
    }
    if (contentType && isAssetContentType(contentType)) {
      return {
        status: response.status,
        kind: "asset",
        buffer: await response.arrayBuffer(),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        contentType,
      };
    }

    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadExistingPages(loadPagesImpl = loadPageMetadataFromMarkdown) {
  try {
    const pages = await loadPagesImpl();
    return Array.isArray(pages) ? pages : [];
  } catch {
    return [];
  }
}

function createPagesWriter(filePath) {
  const stream = fs.createWriteStream(filePath, { encoding: "utf8" });
  let first = true;
  stream.write("[\n");
  return {
    writePage(page) {
      const prefix = first ? "" : ",\n";
      first = false;
      stream.write(`${prefix}${JSON.stringify(page, null, 2)}`);
    },
    async close() {
      stream.write("\n]\n");
      await new Promise((resolve) => stream.end(resolve));
    },
  };
}

function updateIndex(terms, pageId, page) {
  const tokens = tokenize(`${page.title} ${page.text}`);
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  for (const [term, count] of counts.entries()) {
    if (!terms[term]) {
      terms[term] = {};
    }
    terms[term][pageId] = count;
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
    allowedLanguagesOverride,
    loadPagesImpl,
    savePageMarkdownImpl,
    loadPagesForIndexImpl,
    savePagesImpl,
    saveIndexImpl,
    logger = createLogger({ component: "crawler", logPath: logFile }),
    consoleLogger = console,
    collectPages = false,
  } = options;
  const rootUrl = new URL(baseUrlOverride || baseUrl);
  const queue = [rootUrl.toString()];
  const visited = new Set();
  const existingPages = await loadExistingPages(loadPagesImpl);
  const existingByUrl = new Map(existingPages.map((page) => [page.url, page]));
  const pages = [];
  const useMemoryPages = Boolean(savePagesImpl) || collectPages;
  const terms = {};
  const pagesWriter = useMemoryPages ? null : createPagesWriter(getPagesPath());
  let reusedCount = 0;
  let fetchedCount = 0;
  let pageId = 0;

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
  const allowedLanguages =
    allowedLanguagesOverride ||
    (codeLanguages && codeLanguages.length > 0
      ? new Set(codeLanguages)
      : null);
  logger.log("crawl.start", {
    baseUrl: rootUrl.toString(),
    sessionLimit: sessionLimitLabel,
    totalLimit: totalLimitLabel,
  });
  consoleLogger.log(
    `[crawl] start ${rootUrl.toString()} (fetched limit ${sessionLimitLabel}, total limit ${totalLimitLabel})`
  );
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
        response = await fetchResource(current, conditionalHeaders, fetchImpl);
      }
      if (response.status === 304 && (!existing?.links || existing.links.length === 0)) {
        response = await fetchResource(current, {}, fetchImpl);
      }
    } catch (error) {
      logger.warn("crawl.skip", { url: current, error: error.message });
      consoleLogger.warn(`[crawl] skip ${current}: ${error.message}`);
      continue;
    }

    let links = [];
    if (response.status === 304 && existing) {
      let page = await loadPageMarkdownByMetadata(existing);
      if (!page) {
        response = await fetchResource(current, {}, fetchImpl);
      } else {
        page = {
          ...page,
          etag: response.etag ?? existing.etag ?? null,
          lastModified: response.lastModified ?? existing.lastModified ?? null,
          lastCheckedAt: new Date().toISOString(),
        };
        if (useMemoryPages) {
          pages.push(page);
        } else {
          pagesWriter.writePage(page);
        }
        updateIndex(terms, pageId, page);
        pageId += 1;
        links = existing.links || [];
        reusedCount += 1;
        if (savePageMarkdownImpl) {
          await savePageMarkdownImpl(page);
        } else {
          await savePageMarkdown(page);
        }
        consoleLogger.log(`[crawl] cached ${current}`);
      }
    } else {
      if (response.kind === "asset") {
        await saveBinaryAsset(current, response.buffer, response.contentType);
        fetchedCount += 1;
        consoleLogger.log(`[crawl] asset ${current}`);
      } else {
        html = response.html;
        const title = extractTitle(html) || current;
        const breadcrumbs = extractBreadcrumbs(html);
        const headings = extractHeadings(html);
        const { text, codeBlocks } = extractText(html, current, {
          allowedLanguages,
        });
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
        if (useMemoryPages) {
          pages.push(page);
        } else {
          pagesWriter.writePage(page);
        }
        updateIndex(terms, pageId, page);
        pageId += 1;
        fetchedCount += 1;
        if (savePageMarkdownImpl) {
          await savePageMarkdownImpl(page);
        } else {
          await savePageMarkdown(page);
        }
        consoleLogger.log(`[crawl] fetched ${current}`);
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
      if (isBinaryPath(normalizedUrl.pathname) && !isDownloadableAsset(normalizedUrl.pathname)) {
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

  if (pagesWriter) {
    await pagesWriter.close();
  }
  const pagesForIndex = useMemoryPages
    ? loadPagesForIndexImpl
      ? await loadPagesForIndexImpl(pages)
      : pages
    : null;
  const index = useMemoryPages ? buildIndex(pagesForIndex) : {
    updatedAt: new Date().toISOString(),
    pageCount: pageId,
    terms,
  };
  if (savePagesImpl) {
    await savePagesImpl(pagesForIndex);
  } else if (useMemoryPages) {
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
  consoleLogger.log(
    `[crawl] saved ${pages.length} pages (fetched ${fetchedCount}, reused ${reusedCount})`
  );
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

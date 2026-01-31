import { baseUrl, maxPages, requestTimeoutMs, userAgent } from "./config.js";
import { extractHeadings, extractLinks, extractText, extractTitle } from "./html.js";
import { buildIndex } from "./indexer.js";
import { loadPages, saveIndex, savePages } from "./storage.js";

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

async function fetchHtml(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
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

async function loadExistingPages() {
  try {
    const pages = await loadPages();
    return Array.isArray(pages) ? pages : [];
  } catch {
    return [];
  }
}

async function crawl() {
  const rootUrl = new URL(baseUrl);
  const queue = [rootUrl.toString()];
  const visited = new Set();
  const existingPages = await loadExistingPages();
  const existingByUrl = new Map(existingPages.map((page) => [page.url, page]));
  const pages = [];
  let reusedCount = 0;
  let fetchedCount = 0;

  while (queue.length > 0 && pages.length < maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    let response;
    let html;
    const existing = existingByUrl.get(current);
    const conditionalHeaders = {};
    if (existing?.etag) {
      conditionalHeaders["If-None-Match"] = existing.etag;
    }
    if (existing?.lastModified) {
      conditionalHeaders["If-Modified-Since"] = existing.lastModified;
    }
    try {
      response = await fetchHtml(current, conditionalHeaders);
      if (response.status === 304 && (!existing?.links || existing.links.length === 0)) {
        response = await fetchHtml(current);
      }
    } catch (error) {
      console.warn(`[crawl] skip ${current}: ${error.message}`);
      continue;
    }

    let links = [];
    if (response.status === 304 && existing) {
      pages.push({
        ...existing,
        etag: response.etag ?? existing.etag ?? null,
        lastModified: response.lastModified ?? existing.lastModified ?? null,
        lastCheckedAt: new Date().toISOString(),
      });
      links = existing.links || [];
      reusedCount += 1;
    } else {
      html = response.html;
      const title = extractTitle(html) || current;
      const headings = extractHeadings(html);
      const { text, codeBlocks } = extractText(html);
      const urlObj = new URL(current);
      links = extractLinks(html);

      pages.push({
        slug: toSlug(urlObj, rootUrl),
        url: current,
        title,
        headings,
        text,
        codeBlocks,
        links,
        etag: response.etag || null,
        lastModified: response.lastModified || null,
        updatedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
      });
      fetchedCount += 1;
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

    console.log(`[crawl] ${pages.length}/${maxPages} ${current}`);
  }

  const index = buildIndex(pages);
  await savePages(pages);
  await saveIndex(index);

  console.log(
    `[crawl] saved ${pages.length} pages (fetched ${fetchedCount}, reused ${reusedCount})`
  );
}

crawl().catch((error) => {
  console.error(`[crawl] failed: ${error.message}`);
  process.exitCode = 1;
});

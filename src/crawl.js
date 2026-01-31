import { baseUrl, maxPages, requestTimeoutMs, userAgent } from "./config.js";
import { extractHeadings, extractLinks, extractText, extractTitle } from "./html.js";
import { buildIndex } from "./indexer.js";
import { saveIndex, savePages } from "./storage.js";

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

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function crawl() {
  const rootUrl = new URL(baseUrl);
  const queue = [rootUrl.toString()];
  const visited = new Set();
  const pages = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    let html;
    try {
      html = await fetchHtml(current);
    } catch (error) {
      console.warn(`[crawl] skip ${current}: ${error.message}`);
      continue;
    }

    const title = extractTitle(html) || current;
    const headings = extractHeadings(html);
    const { text, codeBlocks } = extractText(html);
    const urlObj = new URL(current);

    pages.push({
      slug: toSlug(urlObj, rootUrl),
      url: current,
      title,
      headings,
      text,
      codeBlocks,
      updatedAt: new Date().toISOString(),
    });

    const links = extractLinks(html);
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

  console.log(`[crawl] saved ${pages.length} pages`);
}

crawl().catch((error) => {
  console.error(`[crawl] failed: ${error.message}`);
  process.exitCode = 1;
});

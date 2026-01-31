import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./config.js";

const pagesPath = path.join(dataDir, "pages.json");
const indexPath = path.join(dataDir, "index.json");

function resolvePagesDir(baseDir = dataDir) {
  return path.join(baseDir, "pages");
}

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function ensurePagesDir(dirPath = pagesDir) {
  await fs.mkdir(dirPath, { recursive: true });
}

function sanitizePathSegment(value) {
  return value.replace(/[<>:"/\\|?*]/g, "_").trim();
}

function slugToMarkdownPath(slug, breadcrumbs = [], baseDir) {
  const normalized = (slug || "index").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean).map(sanitizePathSegment);
  const safePath = parts.length > 0 ? parts.join(path.sep) : "index";
  const breadcrumbParts = Array.isArray(breadcrumbs)
    ? breadcrumbs.map(sanitizePathSegment).filter(Boolean)
    : [];
  const dirPath = breadcrumbParts.length > 0
    ? path.join(resolvePagesDir(baseDir), ...breadcrumbParts)
    : resolvePagesDir(baseDir);
  return path.join(dirPath, `${safePath}.md`);
}

function serializePageMarkdown(page) {
  const metadata = {
    slug: page.slug,
    url: page.url,
    title: page.title,
    breadcrumbs: page.breadcrumbs || [],
    headings: page.headings || [],
    links: page.links || [],
    etag: page.etag || null,
    lastModified: page.lastModified || null,
    updatedAt: page.updatedAt || null,
    lastCheckedAt: page.lastCheckedAt || null,
  };
  const header = `---\n${JSON.stringify(metadata)}\n---\n`;
  const body = page.text || "";
  return `${header}${body}\n`;
}

function extractCodeBlocks(markdown) {
  const blocks = [];
  const regex = /```[^\n]*\n([\s\S]*?)```/g;
  let match = regex.exec(markdown);
  while (match) {
    blocks.push(match[1].trim());
    match = regex.exec(markdown);
  }
  return blocks;
}

function extractMarkdownHeadings(markdown) {
  const headings = [];
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim() });
    }
  }
  return headings;
}

function extractMarkdownLinks(markdown) {
  const links = [];
  const regex = /\[[^\]]+]\(([^)]+)\)/g;
  let match = regex.exec(markdown);
  while (match) {
    links.push(match[1]);
    match = regex.exec(markdown);
  }
  return links;
}

function parseMarkdownPage(content, filePath, baseDir) {
  const pagesDir = resolvePagesDir(baseDir);
  const headerRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
  const match = content.match(headerRegex);
  let metadata = {};
  let body = content;
  if (match) {
    try {
      metadata = JSON.parse(match[1]);
    } catch {
      metadata = {};
    }
    body = content.slice(match[0].length);
  }

  const slug =
    metadata.slug ||
    path
      .relative(pagesDir, filePath)
      .replace(/\\/g, "/")
      .replace(/\.md$/i, "");
  const inferredBreadcrumbs = path
    .relative(pagesDir, path.dirname(filePath))
    .split(path.sep)
    .filter(Boolean);

  const text = body.trim();
  const headings = Array.isArray(metadata.headings) && metadata.headings.length
    ? metadata.headings
    : extractMarkdownHeadings(text);
  const links = Array.isArray(metadata.links) && metadata.links.length
    ? metadata.links
    : extractMarkdownLinks(text);
  const codeBlocks = extractCodeBlocks(text);
  const title =
    metadata.title ||
    (headings[0] ? headings[0].text : "") ||
    slug;

  return {
    slug,
    url: metadata.url || "",
    title,
    breadcrumbs:
      Array.isArray(metadata.breadcrumbs) && metadata.breadcrumbs.length
        ? metadata.breadcrumbs
        : inferredBreadcrumbs,
    headings,
    text,
    codeBlocks,
    links,
    etag: metadata.etag || null,
    lastModified: metadata.lastModified || null,
    updatedAt: metadata.updatedAt || null,
    lastCheckedAt: metadata.lastCheckedAt || null,
  };
}

async function savePageMarkdown(page, baseDir) {
  const filePath = slugToMarkdownPath(page.slug, page.breadcrumbs, baseDir);
  await ensurePagesDir(path.dirname(filePath));
  const content = serializePageMarkdown(page);
  await fs.writeFile(filePath, content, "utf8");
}

async function loadPagesFromMarkdown(baseDir) {
  const pagesDir = resolvePagesDir(baseDir);
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walk(entryPath)));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(entryPath);
      }
    }
    return files;
  }

  try {
    await ensurePagesDir(pagesDir);
  } catch {
    return [];
  }

  const files = await walk(pagesDir);
  const pages = [];
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    pages.push(parseMarkdownPage(content, file, baseDir));
  }
  return pages;
}

async function saveJson(filePath, value) {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function savePages(pages) {
  await saveJson(pagesPath, pages);
}

async function loadPages() {
  return loadJson(pagesPath);
}

async function saveIndex(index) {
  await saveJson(indexPath, index);
}

async function loadIndex() {
  return loadJson(indexPath);
}

function getPagesPath() {
  return pagesPath;
}

function getIndexPath() {
  return indexPath;
}

export {
  savePageMarkdown,
  loadPagesFromMarkdown,
  savePages,
  loadPages,
  saveIndex,
  loadIndex,
  getPagesPath,
  getIndexPath,
};

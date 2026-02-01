import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./config.js";

const pagesPath = path.join(dataDir, "pages.json");
const indexPath = path.join(dataDir, "index.json");

function resolvePagesDir(baseDir = dataDir) {
  return path.join(baseDir, "pages");
}

function resolveAssetsDir(baseDir = dataDir) {
  return path.join(baseDir, "assets");
}

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function ensurePagesDir(dirPath = pagesDir) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function ensureAssetsDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function hashString(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function sanitizePathSegment(value, maxLength = 80) {
  const cleaned = value.replace(/[<>:"/\\|?*]/g, "_").trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  const suffix = hashString(cleaned);
  return `${cleaned.slice(0, maxLength - suffix.length - 1)}-${suffix}`;
}

function sanitizeAssetSegment(value) {
  return value.replace(/[<>:"/\\|?*]/g, "_").trim();
}

function slugToMarkdownPath(slug, breadcrumbs = [], baseDir) {
  const normalized = (slug || "index").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean).map((part) => sanitizePathSegment(part));
  const safePath = parts.length > 0 ? parts.join(path.sep) : "index";
  const breadcrumbParts = Array.isArray(breadcrumbs)
    ? breadcrumbs.map((part) => sanitizePathSegment(part)).filter(Boolean)
    : [];
  const dirPath = breadcrumbParts.length > 0
    ? path.join(resolvePagesDir(baseDir), ...breadcrumbParts)
    : resolvePagesDir(baseDir);
  let filePath = path.join(dirPath, `${safePath}.md`);
  if (filePath.length > 240) {
    const hash = hashString(`${slug}|${breadcrumbParts.join("/")}`);
    const shortName = sanitizePathSegment(normalized || "index", 40);
    filePath = path.join(dirPath, `${shortName}-${hash}.md`);
  }
  if (filePath.length > 240) {
    const hash = hashString(`${slug}|${breadcrumbParts.join("/")}`);
    filePath = path.join(resolvePagesDir(baseDir), `${hash}.md`);
  }
  return filePath;
}

function cleanMarkdown(text) {
  if (!text) {
    return "";
  }
  let output = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  output = output
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  return `${output}\n`;
}

function yamlEscape(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  const str = String(value);
  if (str === "" || /[:#\-\n]/.test(str)) {
    return JSON.stringify(str);
  }
  return str;
}

function serializeYaml(metadata) {
  const lines = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      if (value.length === 0) {
        lines.push("  []");
      } else {
        for (const item of value) {
          lines.push(`  - ${yamlEscape(item)}`);
        }
      }
      continue;
    }
    lines.push(`${key}: ${yamlEscape(value)}`);
  }
  return lines.join("\n");
}

function serializePageMarkdown(page) {
  const metadata = {
    slug: page.slug,
    url: page.url,
    title: page.title,
    breadcrumbs: page.breadcrumbs || [],
    links: page.links || [],
    etag: page.etag || null,
    lastModified: page.lastModified || null,
    updatedAt: page.updatedAt || null,
    lastCheckedAt: page.lastCheckedAt || null,
  };
  const header = `---\n${serializeYaml(metadata)}\n---\n`;
  const body = cleanMarkdown(page.text || "");
  return `${header}${body}`;
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

function parseYamlFrontMatter(raw) {
  const metadata = {};
  const lines = raw.split(/\r?\n/);
  let currentKey = null;
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(metadata[currentKey])) {
        metadata[currentKey] = [];
      }
      metadata[currentKey].push(listMatch[1].replace(/^"|"$/g, ""));
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value = kvMatch[2];
      if (value === "") {
        currentKey = key;
        metadata[currentKey] = [];
        continue;
      }
      currentKey = null;
      if (value === "null") {
        metadata[key] = null;
      } else if (value === "[]") {
        metadata[key] = [];
      } else {
        metadata[key] = value.replace(/^"|"$/g, "");
      }
    }
  }
  return metadata;
}

function parseMarkdownPage(content, filePath, baseDir) {
  const pagesDir = resolvePagesDir(baseDir);
  const headerRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
  const match = content.match(headerRegex);
  let metadata = {};
  let body = content;
  if (match) {
    metadata = parseYamlFrontMatter(match[1]);
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
  const headingsFromMeta =
    Array.isArray(metadata.headings) &&
    metadata.headings.length > 0 &&
    metadata.headings.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.level === "number" &&
        typeof item.text === "string"
    )
      ? metadata.headings
      : null;
  const headings = headingsFromMeta || extractMarkdownHeadings(text);
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

async function loadPageMetadataFromMarkdown(baseDir) {
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
    const headerRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
    const match = content.match(headerRegex);
    if (!match) {
      continue;
    }
    const metadata = parseYamlFrontMatter(match[1]);
    if (!metadata.slug || !metadata.url) {
      continue;
    }
    pages.push({
      slug: metadata.slug,
      url: metadata.url,
      breadcrumbs: metadata.breadcrumbs || [],
      links: metadata.links || [],
      etag: metadata.etag || null,
      lastModified: metadata.lastModified || null,
      updatedAt: metadata.updatedAt || null,
      lastCheckedAt: metadata.lastCheckedAt || null,
    });
  }
  return pages;
}

async function loadPageMarkdownByMetadata(metadata, baseDir) {
  if (!metadata || !metadata.slug) {
    return null;
  }
  const filePath = slugToMarkdownPath(metadata.slug, metadata.breadcrumbs, baseDir);
  try {
    const content = await fs.readFile(filePath, "utf8");
    return parseMarkdownPage(content, filePath, baseDir);
  } catch {
    return null;
  }
}

function urlToAssetPath(url, baseDir, contentType = "") {
  const assetsDir = resolveAssetsDir(baseDir);
  const urlObj = new URL(url);
  const pathname = urlObj.pathname.replace(/^\/+/, "");
  const safePath = pathname
    .split("/")
    .map(sanitizeAssetSegment)
    .join(path.sep);
  let filePath = path.join(assetsDir, safePath);
  if (!path.extname(filePath) && contentType.includes("pdf")) {
    filePath = `${filePath}.pdf`;
  }
  return filePath;
}

async function saveBinaryAsset(url, buffer, contentType, baseDir) {
  const filePath = urlToAssetPath(url, baseDir, contentType);
  await ensureAssetsDir(path.dirname(filePath));
  await fs.writeFile(filePath, Buffer.from(buffer));
  return filePath;
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
  loadPageMetadataFromMarkdown,
  loadPageMarkdownByMetadata,
  saveBinaryAsset,
  savePages,
  loadPages,
  saveIndex,
  loadIndex,
  getPagesPath,
  getIndexPath,
};

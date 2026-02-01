import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { dataDir } from "./config.js";
import { trackFileRead } from "./request-context.js";

const pagesPath = path.join(dataDir, "pages.json");
const indexPath = path.join(dataDir, "index.json");

const DEFAULT_PAGES_JSON_EXCERPT_CHARS = 4000;

function resolvePagesDir(baseDir = dataDir) {
  return path.join(baseDir, "pages");
}

function resolveAssetsDir(baseDir = dataDir) {
  return path.join(baseDir, "assets");
}

function summarizePage(page, options = {}) {
  const { excerptChars = DEFAULT_PAGES_JSON_EXCERPT_CHARS } = options;
  const text = typeof page?.text === "string" ? page.text : "";
  return {
    slug: page?.slug || "",
    url: page?.url || "",
    title: page?.title || "",
    breadcrumbs: Array.isArray(page?.breadcrumbs) ? page.breadcrumbs : [],
    headings: Array.isArray(page?.headings) ? page.headings : [],
    links: Array.isArray(page?.links) ? page.links : [],
    etag: page?.etag ?? null,
    lastModified: page?.lastModified ?? null,
    updatedAt: page?.updatedAt ?? null,
    lastCheckedAt: page?.lastCheckedAt ?? null,
    // Keep a small preview for search excerpts without loading full markdown.
    excerpt: text ? text.slice(0, excerptChars) : "",
  };
}

async function ensureDataDir() {
  await fsPromises.mkdir(dataDir, { recursive: true });
}

async function ensurePagesDir(dirPath = pagesDir) {
  await fsPromises.mkdir(dirPath, { recursive: true });
}

async function ensureAssetsDir(dirPath) {
  await fsPromises.mkdir(dirPath, { recursive: true });
}

function hashString(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10);
}

const MAX_MARKDOWN_FILENAME_PREFIX_BYTES = 240;
const MAX_MARKDOWN_PATH_CHARS = 240;

function sanitizePathSegment(value, maxLength = 80) {
  const cleaned = value.replace(/[<>:"/\\|?*]/g, "_").trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  const suffix = hashString(cleaned);
  return `${cleaned.slice(0, maxLength - suffix.length - 1)}-${suffix}`;
}

function sanitizeFileName(value) {
  return String(value ?? "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim();
}

function truncateUtf8Bytes(value, maxBytes) {
  const input = String(value ?? "");
  let output = "";
  let used = 0;
  for (const ch of input) {
    const bytes = Buffer.byteLength(ch, "utf8");
    if (used + bytes > maxBytes) {
      break;
    }
    output += ch;
    used += bytes;
  }
  return output;
}

function makeHashedMarkdownFilename(prefix, hash) {
  const rawPrefix = sanitizeFileName(prefix) || "index";
  const safePrefix =
    Buffer.byteLength(rawPrefix, "utf8") > MAX_MARKDOWN_FILENAME_PREFIX_BYTES
      ? truncateUtf8Bytes(rawPrefix, MAX_MARKDOWN_FILENAME_PREFIX_BYTES)
      : rawPrefix;
  const finalPrefix = sanitizeFileName(safePrefix) || "index";
  return `${finalPrefix}-${hash}.md`;
}

function sanitizeAssetSegment(value) {
  return value.replace(/[<>:"/\\|?*]/g, "_").trim();
}

function toSlugSegment(value) {
  return value
    .replace(/^doc_/i, "")
    .replace(/_/g, "-")
    .toLowerCase();
}

async function ensureBreadcrumbDirectories(baseDir, breadcrumbParts, logger) {
  let currentDir = resolvePagesDir(baseDir);
  for (const part of breadcrumbParts) {
    const dirName = sanitizePathSegment(part);
    const slugName = sanitizePathSegment(toSlugSegment(part));
    const dirPath = path.join(currentDir, dirName);
    const existed = fs.existsSync(dirPath);
    await fsPromises.mkdir(dirPath, { recursive: true });
    if (!existed && logger?.log) {
      logger.log("crawl.category.create", {
        category: part,
        path: dirPath,
        reason: "breadcrumb",
      });
    }
    const indexPath = path.join(dirPath, "index.md");
    const legacyCandidates = [
      `${slugName}.md`,
      `${slugName.replace(/-/g, "_")}.md`,
      `doc_${slugName}.md`,
      `doc_${slugName.replace(/-/g, "_")}.md`,
    ].map(sanitizePathSegment);
    let moved = false;
    try {
      for (const candidate of legacyCandidates) {
        const filePath = path.join(currentDir, candidate);
        if (fs.existsSync(filePath) && !fs.existsSync(indexPath)) {
          await fsPromises.rename(filePath, indexPath);
          moved = true;
          if (logger?.log) {
            logger.log("crawl.file.move", {
              from: filePath,
              to: indexPath,
              reason: "category-created",
            });
          }
        } else if (fs.existsSync(filePath) && fs.existsSync(indexPath)) {
          await fsPromises.rm(filePath, { force: true });
          moved = true;
          if (logger?.log) {
            logger.log("crawl.file.move", {
              from: filePath,
              to: indexPath,
              reason: "category-created-duplicate",
            });
          }
        }
        const innerFilePath = path.join(dirPath, candidate);
        if (fs.existsSync(innerFilePath) && !fs.existsSync(indexPath)) {
          await fsPromises.rename(innerFilePath, indexPath);
          moved = true;
          if (logger?.log) {
            logger.log("crawl.file.move", {
              from: innerFilePath,
              to: indexPath,
              reason: "category-created",
            });
          }
        } else if (fs.existsSync(innerFilePath) && fs.existsSync(indexPath)) {
          await fsPromises.rm(innerFilePath, { force: true });
          moved = true;
          if (logger?.log) {
            logger.log("crawl.file.move", {
              from: innerFilePath,
              to: indexPath,
              reason: "category-created-duplicate",
            });
          }
        }
      }
      if (!moved) {
        const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
            continue;
          }
          const name = entry.name.replace(/\.md$/i, "");
          const normalized = toSlugSegment(name.replace(/^doc_/i, ""));
          if (normalized === slugName && !fs.existsSync(indexPath)) {
            const filePath = path.join(currentDir, entry.name);
            await fsPromises.rename(filePath, indexPath);
            moved = true;
            if (logger?.log) {
              logger.log("crawl.file.move", {
                from: filePath,
                to: indexPath,
                reason: "category-created-fallback",
              });
            }
            break;
          }
          if (normalized === slugName && fs.existsSync(indexPath)) {
            const filePath = path.join(currentDir, entry.name);
            await fsPromises.rm(filePath, { force: true });
            moved = true;
            if (logger?.log) {
              logger.log("crawl.file.move", {
                from: filePath,
                to: indexPath,
                reason: "category-created-duplicate",
              });
            }
            break;
          }
        }
      }
      if (!moved) {
        const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
            continue;
          }
          const filePath = path.join(currentDir, entry.name);
          const content = await fsPromises.readFile(filePath, "utf8");
          const headerRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
          const match = content.match(headerRegex);
          if (!match) {
            continue;
          }
          const metadata = parseYamlFrontMatter(match[1]);
          const slugValue = toSlugSegment(String(metadata.slug || ""));
          const titleValue = String(metadata.title || "").toLowerCase();
          if (
            (slugValue && slugValue === slugName) ||
            (titleValue && titleValue === part.toLowerCase())
          ) {
            if (!fs.existsSync(indexPath)) {
              await fsPromises.rename(filePath, indexPath);
              if (logger?.log) {
                logger.log("crawl.file.move", {
                  from: filePath,
                  to: indexPath,
                  reason: "category-created-frontmatter",
                });
              }
            } else {
              await fsPromises.rm(filePath, { force: true });
              if (logger?.log) {
                logger.log("crawl.file.move", {
                  from: filePath,
                  to: indexPath,
                  reason: "category-created-duplicate",
                });
              }
            }
            moved = true;
            break;
          }
        }
      }
    } catch (error) {
      if (logger?.warn) {
        logger.warn("crawl.file.move.failed", {
          category: part,
          error: error.message,
        });
      }
    }
    currentDir = dirPath;
  }
}

function slugToMarkdownPath(slug, breadcrumbs = [], baseDir) {
  const normalized = (slug || "index").replace(/^\/+/, "");
  const parts = normalized
    .split("/")
    .filter(Boolean)
    .map((part) => sanitizePathSegment(toSlugSegment(part)));
  const safePath = parts.length > 0 ? parts.join(path.sep) : "index";
  const breadcrumbParts = Array.isArray(breadcrumbs)
    ? breadcrumbs.map((part) => sanitizePathSegment(part)).filter(Boolean)
    : [];
  const dirPath = breadcrumbParts.length > 0
    ? path.join(resolvePagesDir(baseDir), ...breadcrumbParts)
    : resolvePagesDir(baseDir);
  const baseName = parts.length > 0 ? parts[parts.length - 1] : "index";
  let filePath = path.join(dirPath, `${safePath}.md`);
  const targetDir = path.join(dirPath, baseName);
  if (fs.existsSync(targetDir)) {
    try {
      if (fs.statSync(targetDir).isDirectory()) {
        filePath = path.join(targetDir, "index.md");
      }
    } catch {
      // ignore
    }
  }
  if (
    breadcrumbParts.length > 0 &&
    toSlugSegment(breadcrumbParts[breadcrumbParts.length - 1]) === baseName
  ) {
    filePath = path.join(dirPath, "index.md");
  }
  if (filePath.length > MAX_MARKDOWN_PATH_CHARS) {
    const hash = hashString(`${slug}|${breadcrumbParts.join("/")}`);
    const prefix = toSlugSegment(normalized || "index") || "index";
    const fileName = makeHashedMarkdownFilename(prefix, hash);
    filePath = path.join(dirPath, fileName);
    // If breadcrumbs make the path too long, fallback to root `pages/` but
    // keep a human prefix (never hash-only).
    if (filePath.length > MAX_MARKDOWN_PATH_CHARS) {
      filePath = path.join(resolvePagesDir(baseDir), fileName);
    }
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

async function savePageMarkdown(page, baseDir, logger) {
  let filePath = slugToMarkdownPath(page.slug, page.breadcrumbs, baseDir);
  const originalPath = filePath;
  const breadcrumbParts = Array.isArray(page.breadcrumbs)
    ? page.breadcrumbs.filter(Boolean)
    : [];
  if (breadcrumbParts.length > 0) {
    await ensureBreadcrumbDirectories(baseDir, breadcrumbParts, logger);
  }
  if (breadcrumbParts.length === 0 && page?.slug) {
    const baseName = sanitizePathSegment(toSlugSegment(page.slug));
    const pagesDir = resolvePagesDir(baseDir);
    try {
      const entries = await fsPromises.readdir(pagesDir, { withFileTypes: true });
      const categoryDir = entries.find(
        (entry) =>
          entry.isDirectory() &&
          sanitizePathSegment(toSlugSegment(entry.name)) === baseName
      );
      if (categoryDir) {
        const targetDir = path.join(pagesDir, categoryDir.name);
        const targetIndex = path.join(targetDir, "index.md");
        filePath = targetIndex;
      }
    } catch {
      // ignore
    }
  }
  await ensurePagesDir(path.dirname(filePath));
  const content = serializePageMarkdown(page);
  await fsPromises.writeFile(filePath, content, "utf8");
  if (originalPath !== filePath && fs.existsSync(originalPath)) {
    await fsPromises.rm(originalPath, { force: true });
    if (logger?.log) {
      logger.log("crawl.file.move", {
        from: originalPath,
        to: filePath,
        reason: "category-exists",
      });
    }
  }
  return filePath;
}

async function loadPagesFromMarkdown(baseDir) {
  const pagesDir = resolvePagesDir(baseDir);
  async function walk(dir) {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
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
    trackFileRead(file);
    const content = await fsPromises.readFile(file, "utf8");
    pages.push(parseMarkdownPage(content, file, baseDir));
  }
  return pages;
}

async function loadPagesFromMarkdownWithPaths(baseDir) {
  const pagesDir = resolvePagesDir(baseDir);
  async function walk(dir) {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
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
    trackFileRead(file);
    const content = await fsPromises.readFile(file, "utf8");
    const page = parseMarkdownPage(content, file, baseDir);
    pages.push({ page, filePath: file });
  }
  return pages;
}

async function loadPageMetadataFromMarkdown(baseDir) {
  const pagesDir = resolvePagesDir(baseDir);
  async function walk(dir) {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
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
    trackFileRead(file);
    const content = await fsPromises.readFile(file, "utf8");
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
    trackFileRead(filePath);
    const content = await fsPromises.readFile(filePath, "utf8");
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
  await fsPromises.writeFile(filePath, Buffer.from(buffer));
  return filePath;
}

async function saveJson(filePath, value) {
  await ensureDataDir();
  await fsPromises.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function saveJsonCompact(filePath, value) {
  await ensureDataDir();
  await fsPromises.writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function loadJson(filePath) {
  trackFileRead(filePath);
  const raw = await fsPromises.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function detectJsonFormat(filePath) {
  // Detect by first non-whitespace character:
  // - '[' => JSON array
  // - otherwise => treat as NDJSON (one JSON object per line)
  const handle = await fsPromises.open(filePath, "r");
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const text = buf.slice(0, bytesRead).toString("utf8");
    const first = text.trimStart()[0];
    return first === "[" ? "array" : "ndjson";
  } finally {
    await handle.close();
  }
}

async function loadNdjsonArray(filePath) {
  trackFileRead(filePath);
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const items = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    items.push(JSON.parse(trimmed));
  }
  return items;
}

async function savePages(pages) {
  // Persist only lightweight metadata to avoid gigantic JSON (Node string limit).
  // Use NDJSON so it can be loaded streamingly even for very large datasets.
  await ensureDataDir();
  const stream = fs.createWriteStream(pagesPath, { encoding: "utf8" });
  const list = Array.isArray(pages) ? pages : [];
  for (const page of list) {
    stream.write(`${JSON.stringify(summarizePage(page))}\n`);
  }
  await new Promise((resolve) => stream.end(resolve));
}

async function loadPages() {
  const format = await detectJsonFormat(pagesPath);
  return format === "array" ? loadJson(pagesPath) : loadNdjsonArray(pagesPath);
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
  summarizePage,
  savePageMarkdown,
  loadPagesFromMarkdown,
  loadPagesFromMarkdownWithPaths,
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

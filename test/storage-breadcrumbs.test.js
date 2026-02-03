import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function importStorage() {
  const url = new URL("../src/storage.js", import.meta.url);
  return import(`${url.href}?t=${Date.now()}`);
}

test("savePageMarkdown stores file under breadcrumbs path", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "custom-mcp-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const storage = await importStorage();
  const breadcrumbs = [
    "ERP Components",
    "Xafari ASP.NET MVC",
    "Getting Started",
  ];
  const page = {
    slug: "doc_mvc_migration_from_webforms_to_mvc",
    url: "https://documentation.galaktika-soft.com/xafari/doc_mvc_migration_from_webforms_to_mvc",
    title: "Migration from WebForms to Xafari MVC",
    breadcrumbs,
    headings: [],
    text: "# Migration",
    codeBlocks: [],
    links: [],
    etag: null,
    lastModified: null,
    updatedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
  };

  await storage.savePageMarkdown(page, tempDir);
  const expectedPath = path.join(
    tempDir,
    "pages",
    "ERP Components",
    "Xafari ASP.NET MVC",
    "Getting Started",
    "mvc-migration-from-webforms-to-mvc.md"
  );
  const stat = await fs.stat(expectedPath);
  assert.equal(stat.isFile(), true);

  const pages = await storage.loadPagesFromMarkdown(tempDir);
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].breadcrumbs, breadcrumbs);
});

test("savePageMarkdown uses non-hash md filename when path is too long", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "custom-mcp-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const storage = await importStorage();
  const breadcrumbs = Array.from({ length: 10 }, (_, i) => `Category ${i} ${"A".repeat(90)}`);
  const page = {
    slug: `doc_${"a".repeat(500)}`,
    url: "https://documentation.galaktika-soft.com/xafari/doc_long_slug",
    title: "Long slug page",
    breadcrumbs,
    headings: [],
    text: "# Long",
    codeBlocks: [],
    links: [],
    etag: null,
    lastModified: null,
    updatedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
  };

  const writtenPath = await storage.savePageMarkdown(page, tempDir);
  const normalized = writtenPath.replace(/\\/g, "/");

  // Must be under root pages/ and must not be a hash-only filename.
  assert.match(normalized, /\/pages\/.+-[0-9a-f]{10}\.md$/i);
  assert.doesNotMatch(normalized, /\/pages\/[0-9a-f]{10}\.md$/i);

  // Prefix must be at most 240 bytes (UTF-8) before "-<hash>.md".
  const base = path.basename(writtenPath).replace(/\.md$/i, "");
  const suffixMatch = base.match(/^(.*)-([0-9a-f]{10})$/i);
  assert.ok(suffixMatch);
  const prefix = suffixMatch[1];
  assert.ok(Buffer.byteLength(prefix, "utf8") <= 240);

  const stat = await fs.stat(writtenPath);
  assert.equal(stat.isFile(), true);
});

test("saveBinaryAsset stores file under assets path", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "custom-mcp-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const storage = await importStorage();
  const url = "https://documentation.galaktika-soft.com/xafari/Content/app_files/sample.pdf";
  const filePath = await storage.saveBinaryAsset(
    url,
    new TextEncoder().encode("pdf"),
    "application/pdf",
    tempDir
  );
  const normalized = filePath.replace(/\\/g, "/");
  assert.match(
    normalized,
    /\/assets\/.*\/Content\/app_files\/sample\.pdf$/i
  );
  const stat = await fs.stat(filePath);
  assert.equal(stat.isFile(), true);
});

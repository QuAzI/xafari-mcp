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
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xafari-mcp-"));
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
    "doc_mvc_migration_from_webforms_to_mvc.md"
  );
  const stat = await fs.stat(expectedPath);
  assert.equal(stat.isFile(), true);

  const pages = await storage.loadPagesFromMarkdown(tempDir);
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].breadcrumbs, breadcrumbs);
});

test("saveBinaryAsset stores file under assets path", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xafari-mcp-"));
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

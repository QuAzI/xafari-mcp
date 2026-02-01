import test from "node:test";
import assert from "node:assert/strict";
import { reindex } from "../src/reindex.js";

test("reindex builds index from markdown pages", async () => {
  const pages = [
    { title: "Alpha", text: "alpha beta", slug: "alpha", url: "http://x/alpha" },
    { title: "Beta", text: "beta gamma", slug: "beta", url: "http://x/beta" },
  ];
  let savedPages = null;
  let savedIndex = null;

  const result = await reindex({
    loadPagesFromMarkdownImpl: async () => pages,
    savePagesImpl: async (value) => {
      savedPages = value;
    },
    saveIndexImpl: async (value) => {
      savedIndex = value;
    },
    logger: { log: () => {} },
  });

  assert.equal(savedPages.length, 2);
  assert.equal(savedIndex.pageCount, 2);
  assert.equal(result.index.pageCount, 2);
  assert.equal(result.pages[0].slug, "alpha");
});

import test from "node:test";
import assert from "node:assert/strict";
import { searchIndex } from "../src/search.js";
import { buildIndex } from "../src/indexer.js";

test("searchIndex returns ranked results with excerpt", () => {
  const pages = [
    { slug: "a", title: "One", url: "http://x/a", text: "alpha beta", headings: [] },
    { slug: "b", title: "Two", url: "http://x/b", text: "beta beta gamma", headings: [] },
  ];
  const index = buildIndex(pages);
  const result = searchIndex(index, pages, "beta");

  assert.equal(result.totalMatches, 2);
  assert.equal(result.results[0].slug, "b");
  assert.match(result.results[0].excerpt, /beta/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildIndex, tokenize } from "../src/indexer.js";

test("tokenize filters stop-words and short tokens", () => {
  const tokens = tokenize("Это тест и проверка of the index.");
  assert.deepEqual(tokens, ["тест", "проверка", "index"]);
});

test("buildIndex collects term counts per page", () => {
  const pages = [
    { title: "Alpha", text: "alpha beta beta" },
    { title: "Beta", text: "beta gamma" },
  ];
  const index = buildIndex(pages);
  assert.equal(index.pageCount, 2);
  assert.equal(index.terms.alpha[0], 2);
  assert.equal(index.terms.beta[0], 2);
  assert.equal(index.terms.beta[1], 2);
});

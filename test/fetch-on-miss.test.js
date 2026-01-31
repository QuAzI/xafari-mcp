import test from "node:test";
import assert from "node:assert/strict";

async function importServer() {
  const url = new URL("../src/index.js", import.meta.url);
  return import(`${url.href}?t=${Date.now()}`);
}

test("get_page fetch-on-miss returns fetched page", async () => {
  const { handleToolCall } = await importServer();
  const result = await handleToolCall(
    "get_page",
    { slug: "doc_test" },
    {
      fetchOnMissOverride: true,
      loadDataImpl: async () => ({ pages: [], index: { terms: {} } }),
      fetchAndCachePageImpl: async (slug) => ({
        slug,
        url: `https://example.com/${slug}`,
        title: "Fetched",
        text: "body",
      }),
    }
  );

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.slug, "doc_test");
  assert.equal(payload.url, "https://example.com/doc_test");
});

test("get_page fetch-on-miss disabled returns error", async () => {
  const { handleToolCall } = await importServer();
  const result = await handleToolCall(
    "get_page",
    { slug: "doc_test" },
    {
      fetchOnMissOverride: false,
      loadDataImpl: async () => ({ pages: [], index: { terms: {} } }),
    }
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Page not found/);
});

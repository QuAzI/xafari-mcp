import test from "node:test";
import assert from "node:assert/strict";

async function importServer() {
  const url = new URL("../src/index.js", import.meta.url);
  return import(`${url.href}?t=${Date.now()}`);
}

test("get_page fetch-on-miss returns fetched page", async () => {
  const { handleToolCall } = await importServer();
  let called = 0;
  const result = await handleToolCall(
    "get_page",
    { slug: "doc_test" },
    {
      fetchOnMissOverride: true,
      fetchAndCachePageImpl: async (slug) => {
        called += 1;
        return {
          slug,
          url: `https://example.com/${slug}`,
          title: "Fetched",
          text: "body",
        };
      },
      loadDataImpl: async () => ({ pages: [], index: { terms: {} } }),
    }
  );

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.slug, "doc_test");
  assert.equal(payload.url, "https://example.com/doc_test");
  assert.equal(called, 1);
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

test("get_page uses cached result after fetch", async () => {
  const { handleToolCall } = await importServer();
  let fetchCalls = 0;
  const cachedPages = [
    { slug: "doc_test", url: "https://example.com/doc_test", title: "Cached", text: "body" },
  ];

  const fetchAndCachePageImpl = async () => {
    fetchCalls += 1;
    return { slug: "doc_test", url: "https://example.com/doc_test", title: "Fetched", text: "body" };
  };

  const loadDataImpl = async () => ({
    pages: cachedPages,
    index: { terms: {} },
  });

  await handleToolCall(
    "get_page",
    { slug: "doc_test" },
    { fetchOnMissOverride: true, fetchAndCachePageImpl, loadDataImpl }
  );

  await handleToolCall(
    "get_page",
    { slug: "doc_test" },
    { fetchOnMissOverride: true, fetchAndCachePageImpl, loadDataImpl }
  );

  assert.equal(fetchCalls, 0);
});

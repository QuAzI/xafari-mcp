import test from "node:test";
import assert from "node:assert/strict";
import { runCrawl } from "../src/crawl.js";

function createFetchStub(responses) {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const response = responses[url];
    if (!response) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: {
        get: (name) => {
          const key = name.toLowerCase();
          return response.headers?.[key] ?? null;
        },
      },
      text: async () => response.body || "",
    };
  };
  return { fetchImpl, getCalls: () => calls };
}

const logger = {
  log: () => {},
  warn: () => {},
};

test("only-new reuses existing page without fetching", async () => {
  const existingPages = [
    {
      url: "https://example.com/docs/",
      slug: "index",
      title: "Existing",
      headings: [],
      text: "Existing text",
      codeBlocks: [],
      links: ["https://example.com/docs/page-2/"],
      etag: "etag-1",
      lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
    },
  ];

  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === "https://example.com/docs/page-2/") {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => "<h1>Second</h1>",
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await runCrawl({
    onlyNew: true,
    baseUrlOverride: "https://example.com/docs/",
    fetchImpl,
    loadPagesImpl: async () => existingPages,
    savePagesImpl: async () => {},
    saveIndexImpl: async () => {},
    logger,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://example.com/docs/page-2/");
  assert.equal(result.fetchedCount, 1);
  assert.equal(result.reusedCount, 1);
  assert.equal(result.pages.length, 2);
});

test("force overrides only-new and fetches", async () => {
  const existingPages = [
    {
      url: "https://example.com/docs/",
      slug: "index",
      title: "Existing",
      headings: [],
      text: "Existing text",
      codeBlocks: [],
      links: ["https://example.com/docs/page-2/"],
      etag: "etag-1",
      lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
    },
  ];

  const { fetchImpl, getCalls } = createFetchStub({
    "https://example.com/docs/": {
      status: 200,
      headers: {},
      body: "<h1>New</h1><p>Updated</p>",
    },
  });

  const result = await runCrawl({
    forceFetch: true,
    onlyNew: true,
    baseUrlOverride: "https://example.com/docs/",
    fetchImpl,
    loadPagesImpl: async () => existingPages,
    savePagesImpl: async () => {},
    saveIndexImpl: async () => {},
    logger,
  });

  assert.equal(getCalls(), 1);
  assert.equal(result.fetchedCount, 1);
  assert.equal(result.reusedCount, 0);
  assert.equal(result.pages.length, 1);
});

test("304 without links triggers refetch", async () => {
  const existingPages = [
    {
      url: "https://example.com/docs/",
      slug: "index",
      title: "Existing",
      headings: [],
      text: "Existing text",
      codeBlocks: [],
      etag: "etag-1",
      lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
    },
  ];

  let callIndex = 0;
  const fetchImpl = async () => {
    callIndex += 1;
    if (callIndex === 1) {
      return {
        ok: false,
        status: 304,
        headers: {
          get: (name) => {
            const key = name.toLowerCase();
            if (key === "etag") {
              return "etag-1";
            }
            if (key === "last-modified") {
              return "Mon, 01 Jan 2024 00:00:00 GMT";
            }
            return null;
          },
        },
        text: async () => "",
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "<h1>New</h1><p>Updated</p>",
    };
  };

  const result = await runCrawl({
    baseUrlOverride: "https://example.com/docs/",
    fetchImpl,
    loadPagesImpl: async () => existingPages,
    savePagesImpl: async () => {},
    saveIndexImpl: async () => {},
    logger,
  });

  assert.equal(callIndex, 2);
  assert.equal(result.fetchedCount, 1);
  assert.equal(result.reusedCount, 0);
  assert.equal(result.pages.length, 1);
});

test("304 with links reuses page without refetch", async () => {
  const existingPages = [
    {
      url: "https://example.com/docs/",
      slug: "index",
      title: "Existing",
      headings: [],
      text: "Existing text",
      codeBlocks: [],
      links: ["https://example.com/docs/page-2/"],
      etag: "etag-1",
      lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
    },
  ];

  const { fetchImpl, getCalls } = createFetchStub({
    "https://example.com/docs/": {
      status: 304,
      headers: { etag: "etag-1", "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT" },
      body: "",
    },
  });

  const result = await runCrawl({
    baseUrlOverride: "https://example.com/docs/",
    fetchImpl,
    maxPagesOverride: 1,
    loadPagesImpl: async () => existingPages,
    savePagesImpl: async () => {},
    saveIndexImpl: async () => {},
    logger,
  });

  assert.equal(getCalls(), 1);
  assert.equal(result.fetchedCount, 0);
  assert.equal(result.reusedCount, 1);
  assert.equal(result.pages.length, 1);
});

test("max pages per session limits fetched pages", async () => {
  const { fetchImpl, getCalls } = createFetchStub({
    "https://example.com/docs/": {
      status: 200,
      headers: {},
      body: '<h1>Root</h1><a href="/docs/page-2/">Next</a>',
    },
    "https://example.com/docs/page-2/": {
      status: 200,
      headers: {},
      body: "<h1>Second</h1>",
    },
  });

  const result = await runCrawl({
    baseUrlOverride: "https://example.com/docs/",
    maxPagesPerSessionOverride: 1,
    fetchImpl,
    loadPagesImpl: async () => [],
    savePagesImpl: async () => {},
    saveIndexImpl: async () => {},
    logger,
  });

  assert.equal(getCalls(), 1);
  assert.equal(result.fetchedCount, 1);
  assert.equal(result.pages.length, 1);
});

test("max pages per session ignores reused pages", async () => {
  const existingPages = [
    {
      url: "https://example.com/docs/",
      slug: "index",
      title: "Existing",
      headings: [],
      text: "Existing text",
      codeBlocks: [],
      links: ["https://example.com/docs/page-2/"],
      etag: "etag-1",
      lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
    },
  ];

  const { fetchImpl, getCalls } = createFetchStub({
    "https://example.com/docs/": {
      status: 304,
      headers: { etag: "etag-1", "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT" },
      body: "",
    },
    "https://example.com/docs/page-2/": {
      status: 200,
      headers: {},
      body: "<h1>Second</h1>",
    },
  });

  const result = await runCrawl({
    baseUrlOverride: "https://example.com/docs/",
    maxPagesPerSessionOverride: 1,
    fetchImpl,
    loadPagesImpl: async () => existingPages,
    savePagesImpl: async () => {},
    saveIndexImpl: async () => {},
    logger,
  });

  assert.equal(getCalls(), 2);
  assert.equal(result.reusedCount, 1);
  assert.equal(result.fetchedCount, 1);
  assert.equal(result.pages.length, 2);
});

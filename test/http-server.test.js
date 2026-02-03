import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

async function importHttpServer() {
  const url = new URL("../src/http-server.js", import.meta.url);
  return import(`${url.href}?t=${Date.now()}`);
}

async function request(method, port, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: body
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

test("http server health endpoint", async (t) => {
  const { createHttpServer } = await importHttpServer();
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;

  const res = await request("GET", port, "/health");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test("http server root page shows server info", async (t) => {
  const { createHttpServer } = await importHttpServer();
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;

  const res = await request("GET", port, "/");
  assert.equal(res.status, 200);
  assert.match(res.body, /<!doctype html>/i);
  assert.match(res.body, /Tools/i);
});

test("http server tools call", async (t) => {
  const { createHttpServer } = await importHttpServer();
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;

  const res = await request("POST", port, "/tools/search_docs", "{}");
  assert.equal(res.status, 500);
  const payload = JSON.parse(res.body);
  assert.ok(payload.error);
});

test("http server rejects large body", async (t) => {
  const { createHttpServer } = await importHttpServer();
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;

  const large = "a".repeat(2 * 1024 * 1024 + 10);
  const res = await request("POST", port, "/tools/search_docs", large);
  assert.equal(res.status, 500);
});

test("http server rejects unknown paths", async (t) => {
  const { createHttpServer } = await importHttpServer();
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const port = server.address().port;

  const res = await request("GET", port, "/unknown");
  assert.equal(res.status, 404);
});

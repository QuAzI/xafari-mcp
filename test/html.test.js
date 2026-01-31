import test from "node:test";
import assert from "node:assert/strict";
import {
  extractBreadcrumbs,
  extractHeadings,
  extractText,
  extractTitle,
} from "../src/html.js";

test("extractTitle prefers <title>, falls back to h1", () => {
  const html = "<html><head><title>Doc Title</title></head><body></body></html>";
  assert.equal(extractTitle(html), "Doc Title");

  const htmlWithH1 = "<html><body><h1>Heading Title</h1></body></html>";
  assert.equal(extractTitle(htmlWithH1), "Heading Title");
});

test("extractHeadings returns text headings", () => {
  const html = "<h1>Main</h1><h2>Sub</h2><h3>Third</h3>";
  assert.deepEqual(extractHeadings(html), [
    { level: 1, text: "Main" },
    { level: 2, text: "Sub" },
    { level: 3, text: "Third" },
  ]);
});

test("extractText keeps headings and code blocks", () => {
  const html = `
    <h1>Intro</h1>
    <p>Some text</p>
    <pre><code>const a = 1;</code></pre>
  `;
  const result = extractText(html);
  assert.match(result.text, /# Intro/);
  assert.match(result.text, /Some text/);
  assert.match(result.text, /```[\s\S]*const a = 1;[\s\S]*```/);
});

test("extractBreadcrumbs collects unique crumb labels", () => {
  const html = `
    <nav class="breadcrumb">
      <a href="/xafari/doc_home_page">Home</a>
      <a href="/xafari/doc_enterprise_solutions">ERP Components</a>
      <a href="/xafari/doc_mvc">Xafari ASP.NET MVC</a>
      <a href="/xafari/doc_mvc_getting_started">Getting Started</a>
    </nav>
  `;
  assert.deepEqual(extractBreadcrumbs(html), [
    "Home",
    "ERP Components",
    "Xafari ASP.NET MVC",
    "Getting Started",
  ]);
});

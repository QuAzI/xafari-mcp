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

test("extractBreadcrumbs falls back to doc_ links near h1", () => {
  const html = `
    <div class="nav">
      <a href="/xafari/doc_home_page">Home</a>
      <a href="/xafari/doc_general_purpose">General Components</a>
    </div>
    <div class="path">
      <a href="/xafari/doc_enterprise_solutions">ERP Components</a>
      <a href="/xafari/doc_mvc">Xafari ASP.NET MVC</a>
      <a href="/xafari/doc_mvc_getting_started">Getting Started</a>
      <a href="/xafari/doc_mvc_migration_from_webforms_to_mvc">Migration from WebForms to MVC</a>
    </div>
    <h1>Migration from WebForms to Xafari MVC</h1>
  `;

  assert.deepEqual(extractBreadcrumbs(html), [
    "ERP Components",
    "Xafari ASP.NET MVC",
    "Getting Started",
    "Migration from WebForms to MVC",
  ]);
});

test("extractText wraps language labels into fenced code blocks", () => {
  const html = `
    <div>
      <p>c#</p>
      <p>public void smth(){ RecursiveHelper.Recursive(data, a => a.Children); }</p>
      <p>VB</p>
      <p>Public Sub smth() RecursiveHelper.Recursive(data, Function(ByVal a) a.Children) End Sub</p>
    </div>
  `;
  const result = extractText(html, "https://documentation.galaktika-soft.com/xafari/");
  const text = result.text;
  assert.match(text, /```cs[\s\S]*public void smth\(\)/);
  assert.match(text, /```vb[\s\S]*Public Sub smth\(\)/);
});

test("extractText keeps images and wraps link images", () => {
  const html = `
    <p><a href="/xafari/doc_check_action">
      <img src="/xafari/Content/app_files/check_action_1.png" alt="check_action_1" />
    </a></p>
  `;
  const result = extractText(html, "https://documentation.galaktika-soft.com/xafari/");
  assert.match(
    result.text,
    /\[!\[check_action_1]\(https:\/\/documentation\.galaktika-soft\.com\/xafari\/Content\/app_files\/check_action_1\.png\)\]\(https:\/\/documentation\.galaktika-soft\.com\/xafari\/doc_check_action\)/
  );
});

test("extractText uses code_content class language", () => {
  const html = `
    <div class="code_content csharp">
      public class Class1 { public int Int1 { get; set; } }
    </div>
    <div class="code_content vb">
      Public Class Class1
        Public Property Int1 As Integer
      End Class
    </div>
  `;
  const result = extractText(html, "https://documentation.galaktika-soft.com/xafari/");
  assert.match(result.text, /```cs[\s\S]*public class Class1/);
  assert.match(result.text, /```vb[\s\S]*Public Class Class1/);
});

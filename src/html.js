const VOID_TAGS = new Set(["br", "hr"]);

function decodeHtml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, "");
}

function removeScriptStyle(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
}

function removeCommonNoise(html) {
  const tagBlocks = ["nav", "footer", "header", "aside"];
  let output = html;
  for (const tag of tagBlocks) {
    output = output.replace(
      new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"),
      ""
    );
  }

  output = output.replace(
    /<([a-z0-9]+)[^>]*class="[^"]*(breadcrumb|breadcrumbs|related|sidebar|toc|pagination|search|footer|header|nav)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi,
    ""
  );

  return output;
}

function extractLinks(html) {
  const links = [];
  const regex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match = regex.exec(html);
  while (match) {
    links.push(match[1]);
    match = regex.exec(html);
  }
  return links;
}

function extractHeadings(html) {
  const headings = [];
  const regex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match = regex.exec(html);
  while (match) {
    const level = Number.parseInt(match[1], 10);
    const text = decodeHtml(stripTags(match[2])).trim();
    if (text) {
      headings.push({ level, text });
    }
    match = regex.exec(html);
  }
  return headings;
}

function extractBreadcrumbs(html) {
  const containers = [];
  const containerRegex =
    /<([a-z0-9]+)[^>]*class="[^"]*(breadcrumb|breadcrumbs)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
  let match = containerRegex.exec(html);
  while (match) {
    containers.push(match[3]);
    match = containerRegex.exec(html);
  }

  const links = [];
  for (const container of containers) {
    const linkRegex = /<a\s+[^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch = linkRegex.exec(container);
    while (linkMatch) {
      const text = decodeHtml(stripTags(linkMatch[1])).trim();
      if (text) {
        links.push(text);
      }
      linkMatch = linkRegex.exec(container);
    }
  }

  const seen = new Set();
  const unique = [];
  for (const item of links) {
    if (!seen.has(item)) {
      seen.add(item);
      unique.push(item);
    }
  }
  if (unique.length > 0) {
    return unique;
  }

  const h1Match = html.match(/<h1[^>]*>/i);
  const h1Index = h1Match ? h1Match.index : -1;
  const windowStart = h1Index > -1 ? Math.max(0, h1Index - 6000) : 0;
  const windowEnd = h1Index > -1 ? h1Index : html.length;
  const windowHtml = html.slice(windowStart, windowEnd);
  const matches = [];
  const linkRegex =
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch = linkRegex.exec(windowHtml);
  while (linkMatch) {
    const href = linkMatch[1].toLowerCase();
    if (href.includes("doc_") || href.includes("doc%5f")) {
      const text = decodeHtml(stripTags(linkMatch[2])).trim();
      if (text) {
        matches.push({ text, index: linkMatch.index });
      }
    }
    linkMatch = linkRegex.exec(windowHtml);
  }

  if (matches.length === 0) {
    return [];
  }

  const groups = [];
  let current = [];
  let previousIndex = null;
  for (const match of matches) {
    if (previousIndex !== null && match.index - previousIndex > 400) {
      groups.push(current);
      current = [];
    }
    current.push(match.text);
    previousIndex = match.index;
  }
  if (current.length > 0) {
    groups.push(current);
  }

  let lastGroup = groups[groups.length - 1] || [];
  const navBlacklist = new Set(
    [
      "home",
      "general information",
      "what's new in help",
      "general components",
      "business components",
    ].map((item) => item.toLowerCase())
  );
  lastGroup = lastGroup.filter(
    (item) => !navBlacklist.has(item.toLowerCase())
  );
  const heuristicUnique = [];
  const heuristicSeen = new Set();
  for (const item of lastGroup) {
    if (!heuristicSeen.has(item)) {
      heuristicSeen.add(item);
      heuristicUnique.push(item);
    }
  }
  return heuristicUnique;
}

function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return decodeHtml(stripTags(titleMatch[1])).trim();
  }
  const headingMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (headingMatch) {
    return decodeHtml(stripTags(headingMatch[1])).trim();
  }
  return "";
}

function normalizeLanguage(value) {
  if (!value) {
    return "";
  }
  const lower = value.toLowerCase();
  if (lower === "c#" || lower === "cs") {
    return "cs";
  }
  if (lower === "csharp") {
    return "cs";
  }
  if (lower === "vb") {
    return "vb";
  }
  if (lower === "vbnet") {
    return "vb";
  }
  if (lower === "js") {
    return "javascript";
  }
  return lower;
}

function resolveUrl(value, baseUrl) {
  if (!value) {
    return "";
  }
  if (!baseUrl) {
    return value;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function detectLanguageFromContext(context) {
  const snippet = context.toLowerCase();
  if (snippet.includes("c#")) {
    return "cs";
  }
  if (snippet.includes("vb")) {
    return "vb";
  }
  return "";
}

function detectLanguageFromCode(code) {
  if (!code) {
    return "";
  }
  if (/\bpublic\b/i.test(code) && /\bclass\b/i.test(code) && /{/.test(code)) {
    return "cs";
  }
  if (/\bPublic\b/.test(code) && /\bClass\b/.test(code)) {
    return "vb";
  }
  return "";
}

function extractTagBlock(html, startIndex, tagName) {
  const openRe = new RegExp(`<${tagName}\\b`, "ig");
  const closeRe = new RegExp(`</${tagName}>`, "ig");
  openRe.lastIndex = startIndex;
  const firstOpen = openRe.exec(html);
  if (!firstOpen || firstOpen.index !== startIndex) {
    return null;
  }
  let depth = 1;
  openRe.lastIndex = startIndex + 1;
  closeRe.lastIndex = startIndex + 1;
  while (depth > 0) {
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) {
      return null;
    }
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        return { endIndex: closeRe.lastIndex };
      }
    }
  }
  return null;
}

function extractCodeContentBlocks(html, codeBlocks) {
  const classRegex = /class=["'][^"']*code_content[^"']*["']/gi;
  let match = classRegex.exec(html);
  let output = "";
  let cursor = 0;

  while (match) {
    const tagStart = html.lastIndexOf("<", match.index);
    if (tagStart === -1) {
      match = classRegex.exec(html);
      continue;
    }
    const tagMatch = html.slice(tagStart).match(/^<([a-z0-9]+)\b/i);
    if (!tagMatch) {
      match = classRegex.exec(html);
      continue;
    }
    const tagName = tagMatch[1].toLowerCase();
    const blockInfo = extractTagBlock(html, tagStart, tagName);
    if (!blockInfo) {
      match = classRegex.exec(html);
      continue;
    }
    const block = html.slice(tagStart, blockInfo.endIndex);
    const classMatch = block.match(/class=["']([^"']+)["']/i);
    const classValue = classMatch ? classMatch[1].toLowerCase() : "";
    let language = "";
    if (classValue.includes("csharp") || classValue.includes("cs")) {
      language = "cs";
    } else if (classValue.includes("vb")) {
      language = "vb";
    }
    let inner = block
      .replace(new RegExp(`^<${tagName}[^>]*>`, "i"), "")
      .replace(new RegExp(`</${tagName}>$`, "i"), "");
    inner = inner
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<p[^>]*>/gi, "");
    let code = decodeHtml(stripTags(inner)).trim();
    if (!language) {
      language = detectLanguageFromCode(code);
    }
    output += html.slice(cursor, tagStart);
    if (code) {
      const index = codeBlocks.length;
      codeBlocks.push({ code, language });
      output += `\n[[CODE_BLOCK_${index}]]\n`;
    }
    cursor = blockInfo.endIndex;
    classRegex.lastIndex = blockInfo.endIndex;
    match = classRegex.exec(html);
  }

  output += html.slice(cursor);
  return output;
}

function buildImageMarkdown(match, baseUrl) {
  const srcMatch = match.match(/src=["']([^"']+)["']/i);
  if (!srcMatch) {
    return "";
  }
  const altMatch = match.match(/alt=["']([^"']*)["']/i);
  const alt = decodeHtml(altMatch?.[1] || "").trim();
  const src = resolveUrl(decodeHtml(srcMatch[1]).trim(), baseUrl);
  if (!src) {
    return "";
  }
  return `![${alt}](${src})`;
}

function convertLanguageLabels(text) {
  const normalizedText = text
    .replace(/c#\s*VB/gi, "c#\nVB")
    .replace(/c#\s*public/gi, "c#\npublic")
    .replace(/VB\s*Public/gi, "VB\nPublic");
  const lines = normalizedText.split(/\r?\n/);
  const output = [];
  let currentLang = null;
  let buffer = [];

  function flush() {
    if (!currentLang) {
      return;
    }
    const code = buffer.join("\n").trim();
    if (code) {
      output.push(`\`\`\`${currentLang}`);
      output.push(code);
      output.push("```");
      output.push("");
    }
    currentLang = null;
    buffer = [];
  }

  function isLikelyCodeLine(value) {
    if (!value) {
      return false;
    }
    const hasCodeChars = /[{}();]/.test(value);
    const hasKeywords = /\b(public|private|class|void|sub|end|function|if|then|for|next)\b/i.test(
      value
    );
    const wordCount = value.trim().split(/\s+/).length;
    if (hasCodeChars || hasKeywords) {
      return true;
    }
    return wordCount <= 3;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("```")) {
      flush();
      output.push(lines[i]);
      continue;
    }
    const label = line.replace(/^[-*]\s+/, "");
    const normalized = normalizeLanguage(label);
    if (normalized === "cs" || normalized === "vb") {
      flush();
      currentLang = normalized;
      continue;
    }

    if (currentLang) {
      if (line && !isLikelyCodeLine(line)) {
        flush();
        output.push(lines[i]);
        continue;
      }
      if (line.startsWith("#") && buffer.length > 0) {
        flush();
        output.push(lines[i]);
        continue;
      }
      if (line === "" && buffer.length > 0) {
        const next = lines.slice(i + 1).find((l) => l.trim() !== "");
        const nextLabel = next ? normalizeLanguage(next.replace(/^[-*]\s+/, "").trim()) : "";
        if (nextLabel === "cs" || nextLabel === "vb") {
          flush();
          continue;
        }
      }
      buffer.push(lines[i]);
      continue;
    }

    output.push(lines[i]);
  }

  flush();
  return output.join("\n");
}

function splitMixedCodeSamples(code) {
  const csIndex = code.indexOf("public ");
  const vbIndex = code.indexOf("Public ");
  if (csIndex !== -1 && vbIndex !== -1 && csIndex < vbIndex) {
    const csCode = code.slice(0, vbIndex).trim();
    const vbCode = code.slice(vbIndex).trim();
    if (csCode && vbCode) {
      return [
        { code: csCode, language: "cs" },
        { code: vbCode, language: "vb" },
      ];
    }
  }
  return null;
}

function splitMixedFencedBlocks(text) {
  return text.replace(/```([a-z0-9]*)\n([\s\S]*?)```/gi, (match, lang, code) => {
    const mixed = splitMixedCodeSamples(code);
    if (!mixed) {
      return match;
    }
    return [
      `\`\`\`cs`,
      mixed[0].code,
      "```",
      "",
      "```vb",
      mixed[1].code,
      "```",
    ].join("\n");
  });
}

function normalizeFenceLanguages(text) {
  return text.replace(/```([A-Za-z0-9#+-]+)/g, (_, lang) => {
    const normalized = normalizeLanguage(lang);
    return `\`\`\`${normalized || lang.toLowerCase()}`;
  });
}

function extractText(html, baseUrl) {
  let working = removeScriptStyle(html);
  working = removeCommonNoise(working);

  const codeBlocks = [];
  working = extractCodeContentBlocks(working, codeBlocks);
  working = working.replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, (match, offset) => {
    const languageMatch = match.match(
      /<code[^>]*class=["'][^"']*language-([a-z0-9+#-]+)[^"']*["'][^>]*>/i
    );
    const dataLangMatch = match.match(
      /<code[^>]*data-language=["']([^"']+)["'][^>]*>/i
    );
    const contextual = working.slice(Math.max(0, offset - 300), offset);
    const language = normalizeLanguage(
      (languageMatch?.[1] || dataLangMatch?.[1] || "").trim() ||
        detectLanguageFromContext(contextual)
    );
    let code = stripTags(match);
    code = decodeHtml(code).trim();
    if (code) {
      const mixed = splitMixedCodeSamples(code);
      if (mixed) {
        const indices = mixed.map((entry) => {
          const index = codeBlocks.length;
          codeBlocks.push(entry);
          return `[[CODE_BLOCK_${index}]]`;
        });
        return `\n${indices.join("\n")}\n`;
      }
      const index = codeBlocks.length;
      codeBlocks.push({ code, language });
      return `\n[[CODE_BLOCK_${index}]]\n`;
    }
    return "\n";
  });

  working = working.replace(/<img[^>]*>/gi, (match) => {
    const image = buildImageMarkdown(match, baseUrl);
    return image ? `\n${image}\n` : "\n";
  });

  working = working.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, content) => {
      const resolved = resolveUrl(href, baseUrl);
      if (content.includes("<img")) {
        const image = buildImageMarkdown(content, baseUrl);
        if (!image) {
          return resolved ? `\n${resolved}\n` : "\n";
        }
        return resolved ? `\n[${image}](${resolved})\n` : `\n${image}\n`;
      }
      const text = decodeHtml(stripTags(content)).trim();
      if (!text) {
        return resolved ? `\n${resolved}\n` : "\n";
      }
      return resolved ? `\n[${text}](${resolved})\n` : `\n${text}\n`;
    }
  );
  working = working.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, level, content) => {
      const text = decodeHtml(stripTags(content)).trim();
      if (!text) {
        return "\n";
      }
      return `\n${"#".repeat(Number(level))} ${text}\n`;
    }
  );

  working = working.replace(
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_, content) => {
      const text = decodeHtml(stripTags(content)).trim();
      return text ? `\n- ${text}\n` : "\n";
    }
  );

  working = working.replace(
    /<p[^>]*>([\s\S]*?)<\/p>/gi,
    (_, content) => {
      const text = decodeHtml(stripTags(content)).trim();
      return text ? `\n${text}\n` : "\n";
    }
  );

  working = working.replace(/<br\s*\/?>/gi, "\n");
  working = working.replace(/<hr\s*\/?>/gi, "\n");

  working = working.replace(/<[^>]+>/g, "");
  working = decodeHtml(working);

  let text = working.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  text = text.replace(/\[\[CODE_BLOCK_(\d+)]]/g, (_, index) => {
    const entry = codeBlocks[Number(index)];
    if (!entry) {
      return "";
    }
    const language = entry.language ? entry.language.toLowerCase() : "";
    return `\n\`\`\`${language}\n${entry.code}\n\`\`\`\n`;
  });

  const normalizedText = splitMixedFencedBlocks(text.trim());
  const labeledText = convertLanguageLabels(normalizedText);
  return { text: normalizeFenceLanguages(labeledText), codeBlocks };
}

function sanitizeHtml(html) {
  return removeCommonNoise(removeScriptStyle(html));
}

export {
  decodeHtml,
  extractBreadcrumbs,
  extractLinks,
  extractHeadings,
  extractText,
  extractTitle,
  sanitizeHtml,
  stripTags,
  VOID_TAGS,
};

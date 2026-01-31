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

function extractText(html) {
  let working = removeScriptStyle(html);
  working = removeCommonNoise(working);

  const codeBlocks = [];
  working = working.replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, (match) => {
    let code = stripTags(match);
    code = decodeHtml(code).trim();
    if (code) {
      const index = codeBlocks.length;
      codeBlocks.push(code);
      return `\n[[CODE_BLOCK_${index}]]\n`;
    }
    return "\n";
  });

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
    const code = codeBlocks[Number(index)] || "";
    if (!code) {
      return "";
    }
    return `\n\`\`\`\n${code}\n\`\`\`\n`;
  });

  return { text: text.trim(), codeBlocks };
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

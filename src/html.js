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
  extractLinks,
  extractHeadings,
  extractText,
  extractTitle,
  sanitizeHtml,
  stripTags,
  VOID_TAGS,
};

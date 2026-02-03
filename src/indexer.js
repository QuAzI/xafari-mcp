const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "or",
  "the",
  "to",
  "of",
  "in",
  "on",
  "for",
  "is",
  "are",
  "with",
  "by",
  "be",
  "as",
  "at",
  "from",
  "что",
  "как",
  "это",
  "для",
  "или",
  "и",
  "в",
  "на",
  "по",
  "из",
  "к",
  "с",
  "о",
  "об",
  "обо",
  "при",
  "без",
  "над",
  "под",
  "про",
]);

function tokenize(text) {
  const input =
    typeof text === "string" ? text : text === undefined || text === null ? "" : String(text);
  return input
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .filter((token) => !STOP_WORDS.has(token));
}

function buildIndex(pages) {
  const terms = {};

  pages.forEach((page, pageId) => {
    const tokens = tokenize(`${page.title} ${page.text}`);
    const counts = new Map();
    for (const token of tokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }

    for (const [term, count] of counts.entries()) {
      if (!terms[term]) {
        terms[term] = {};
      }
      terms[term][pageId] = count;
    }
  });

  return {
    updatedAt: new Date().toISOString(),
    pageCount: pages.length,
    terms,
  };
}

export { buildIndex, tokenize };

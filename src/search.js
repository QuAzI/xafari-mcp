import { tokenize } from "./indexer.js";

function buildExcerpt(text, queryTokens, maxLength = 360) {
  const lower = text.toLowerCase();
  let hitIndex = -1;

  for (const token of queryTokens) {
    const idx = lower.indexOf(token);
    if (idx >= 0 && (hitIndex === -1 || idx < hitIndex)) {
      hitIndex = idx;
    }
  }

  if (hitIndex === -1) {
    return text.slice(0, maxLength).trim();
  }

  const start = Math.max(0, hitIndex - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);
  return text.slice(start, end).trim();
}

function searchIndex(index, pages, query, limit = 5) {
  const tokens = tokenize(query);
  const scores = new Map();

  for (const token of tokens) {
    const postings = index.terms[token];
    if (!postings) {
      continue;
    }
    for (const [pageId, count] of Object.entries(postings)) {
      const id = Number(pageId);
      scores.set(id, (scores.get(id) || 0) + count);
    }
  }

  const ranked = Array.from(scores.entries())
    .map(([pageId, score]) => ({
      pageId,
      score,
      page: pages[pageId],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ page, score }) => ({
      slug: page.slug,
      title: page.title,
      url: page.url,
      score,
      excerpt: buildExcerpt(page.text, tokens),
      headings: page.headings || [],
    }));

  return {
    query,
    tokens,
    totalMatches: ranked.length,
    results: ranked,
  };
}

export { buildExcerpt, searchIndex };

import { buildIndex } from "./indexer.js";
import {
  loadPagesFromMarkdown,
  saveIndex,
  savePages,
} from "./storage.js";
import { pathToFileURL } from "node:url";

async function reindex({
  loadPagesFromMarkdownImpl = loadPagesFromMarkdown,
  savePagesImpl = savePages,
  saveIndexImpl = saveIndex,
  logger = console,
} = {}) {
  const pages = await loadPagesFromMarkdownImpl();
  const index = buildIndex(pages);
  await savePagesImpl(pages);
  await saveIndexImpl(index);
  logger.log(`[reindex] saved ${pages.length} pages`);
  return { pages, index };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reindex().catch((error) => {
    console.error(`[reindex] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export { reindex };

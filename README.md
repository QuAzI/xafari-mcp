# Xafari MCP

MCP server and crawler for Xafari documentation. It crawls the official docs,
extracts clean text and code samples, builds a lightweight index, and exposes
tools for search and explanations.

## Quick start

1. Crawl and build the local index:
   - `npm run crawl`
2. Start the MCP server (stdio):
   - `npm run start`

## Environment

- `XAFARI_DOCS_BASE_URL` (default: `https://documentation.galaktika-soft.com/xafari/`)
- `XAFARI_MAX_PAGES` (default: `300`)
- `XAFARI_DATA_DIR` (default: `./data`)
- `XAFARI_REQUEST_TIMEOUT_MS` (default: `15000`)
- `XAFARI_USER_AGENT`

## MCP tools

- `search_docs(query, limit?)`
- `get_page(slug)`
- `get_examples(topic, limit?)`
- `explain_concept(name)`

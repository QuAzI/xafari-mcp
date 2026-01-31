# Xafari MCP

MCP‑сервер и краулер для документации Xafari. Он скачивает официальные страницы,
извлекает чистый текст и примеры кода, строит легковесный индекс и предоставляет
инструменты для поиска и объяснений.

## Быстрый старт

1. Запустить краулер и собрать локальный индекс:
   - `npm run crawl`
2. Запустить MCP‑сервер (stdio):
   - `npm run start`

## Переменные окружения

- `XAFARI_DOCS_BASE_URL` (по умолчанию: `https://documentation.galaktika-soft.com/xafari/`)
- `XAFARI_MAX_PAGES` (по умолчанию: `300`)
- `XAFARI_DATA_DIR` (по умолчанию: `./data`)
- `XAFARI_REQUEST_TIMEOUT_MS` (по умолчанию: `15000`)
- `XAFARI_USER_AGENT`

## MCP‑инструменты

- `search_docs(query, limit?)`
- `get_page(slug)`
- `get_examples(topic, limit?)`
- `explain_concept(name)`

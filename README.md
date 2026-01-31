# Xafari MCP

MCP‑сервер и краулер для документации Xafari. Он скачивает официальные страницы,
извлекает чистый текст и примеры кода, строит легковесный индекс и предоставляет
инструменты для поиска и объяснений.

## Быстрый старт

1. Запустить краулер и собрать локальный индекс:
   - `npm run crawl`
2. Запустить MCP‑сервер (stdio):
   - `npm run start`

Опции краулера:
- `npm run crawl -- --force` — перекачать все страницы.
- `npm run crawl -- --only-new` — скачивать только новые страницы (старые не перезаписывать).

## Переменные окружения

- `XAFARI_DOCS_BASE_URL` (по умолчанию: `https://documentation.galaktika-soft.com/xafari/`)
- `XAFARI_MAX_PAGES_PER_SESSION` (по умолчанию: `1000`)
- `XAFARI_FETCH_ON_MISS` (по умолчанию: `true`)
- `XAFARI_DATA_DIR` (по умолчанию: `./data`)
- `XAFARI_REQUEST_TIMEOUT_MS` (по умолчанию: `15000`)
- `XAFARI_USER_AGENT`
- `XAFARI_LOG_FILE` (по умолчанию: `logs/xafari-mcp.jsonl`)

## Формат хранения

- Сырые страницы сохраняются в `data/pages/*.md` с метаданными в заголовке.
- `pages.json` формируется из markdown-файлов после завершения краулинга.
- При сохранении учитываются breadcrumbs: страницы попадают в поддиректории по темам.

## Логи

Структурированные логи пишутся в `data/logs/xafari-mcp.jsonl` (JSON Lines).

## MCP‑инструменты

- `search_docs(query, limit?)`
- `get_page(slug)`
- `get_examples(topic, limit?)`
- `explain_concept(name)`

## Примеры запросов

- `search_docs`: "Как работает модуль Performance Enhancement?"
- `search_docs`: "подключение к DevExpress XAF"
- `get_page`: `getting-started/` или `https://documentation.galaktika-soft.com/xafari/getting-started/`
- `get_examples`: "Business Components"
- `explain_concept`: "Security System"

## Подключение MCP в Cursor

1. Откройте настройки MCP в Cursor.
2. Добавьте новый сервер со следующими параметрами:
   - `name`: `xafari-mcp`
   - `command`: `node`
   - `args`: `["C:\\Projects\\xafari-mcp\\src\\index.js"]`
   - `cwd`: `C:\\Projects\\xafari-mcp`
3. Перезапустите MCP‑сервер в Cursor.

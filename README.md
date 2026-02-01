# Xafari MCP

MCP‑сервер и краулер для документации Xafari. Он скачивает официальные страницы,
извлекает чистый текст и примеры кода, строит легковесный индекс и предоставляет
инструменты для поиска и объяснений.

## Зачем нужен MCP

MCP (Model Context Protocol) позволяет IDE и агентам обращаться к локальным данным
как к «инструментам». Вместо ручного поиска по сайту документации, ассистент
вызывает методы `search_docs`, `get_page` и `get_examples`, а сервер отвечает
структурированными данными. Это ускоряет работу, дает воспроизводимые ответы и
снижает зависимость от внешнего интернета.

## Как работает MCP в этом проекте

1. Краулер скачивает HTML, превращает его в markdown и сохраняет в `data/pages`.
2. Из markdown строятся `pages.json` и `index.json` для быстрого поиска.
3. MCP‑сервер читает индекс и отвечает на вызовы инструментов через stdio.
4. IDE подключается к серверу и использует инструменты прямо в чате.

## Быстрый старт

1. Запустить краулер и собрать локальный индекс:
   - `npm run crawl`
2. Запустить MCP‑сервер (stdio):
   - `npm run start`

Опции краулера:
- `npm run crawl` — по умолчанию скачивает только новые страницы.
- `npm run crawl -- --force` — перекачать все страницы.
- `npm run crawl -- --no-only-new` — отключить режим "только новые".

Примечание:
- `--no-only-new` делает полный обход с кешем (ETag/Last-Modified), а `--force` перекачивает все без учета кеша.

## Что делает краулер

- Скачивает HTML‑страницы документации и извлекает читабельный markdown.
- Сохраняет изображения и PDF как файлы в `data/assets`.
- Кэширует страницы и использует ETag/Last‑Modified при повторных запусках.
- Формирует индекс `pages.json` + `index.json` для быстрого поиска.

## Переменные окружения

- `XAFARI_DOCS_BASE_URL` (по умолчанию: `https://documentation.galaktika-soft.com/xafari/`)
- `XAFARI_MAX_PAGES_PER_SESSION` (по умолчанию: `1000`)
- `XAFARI_FETCH_ON_MISS` (по умолчанию: `true`)
- `XAFARI_DATA_DIR` (по умолчанию: `./data`)
- `XAFARI_REQUEST_TIMEOUT_MS` (по умолчанию: `15000`)
- `XAFARI_USER_AGENT`
- `XAFARI_LOG_FILE` (по умолчанию: `logs/xafari-mcp.jsonl`)
- `XAFARI_CODE_LANGUAGES` (по умолчанию: `cs,js,ts,json,yaml,xml,html,css`)

## Формат хранения

- Сырые страницы сохраняются в `data/pages/*.md` с метаданными в заголовке.
- `pages.json` формируется из markdown-файлов после завершения краулинга.
- При сохранении учитываются breadcrumbs: страницы попадают в поддиректории по темам.
- Ассеты (PDF/картинки) сохраняются в `data/assets`, ссылки в markdown остаются абсолютными.

## Примеры кода

- Примеры сохраняются только для языков из `XAFARI_CODE_LANGUAGES`.
- Языки нормализуются: `c#`/`csharp` → `cs`, `javascript` → `js`, `typescript` → `ts`, `yml` → `yaml`.
- Если язык не разрешен — блок кода не сохраняется.

## Fetch on miss

`get_page` может автоматически догружать страницу, если ее нет в кэше.
Управляется флагом `XAFARI_FETCH_ON_MISS` (по умолчанию `true`).

## Логи

Структурированные логи пишутся в `data/logs/xafari-mcp.jsonl` (JSON Lines).

## MCP‑инструменты

- `search_docs(query, limit?)`
  - Ищет по индексу документации и возвращает список результатов с `title`, `url`, `excerpt`, `headings`.
  - `limit` ограничивает количество результатов (1–20, по умолчанию 5).
- `get_page(slug)`
  - Возвращает полный контент страницы (markdown‑текст, headings, codeBlocks, links, breadcrumbs).
  - `slug` можно передать как относительный путь (`doc_recursive_helper`) или полный URL.
  - При включенном `XAFARI_FETCH_ON_MISS` страница догружается, если ее нет в кэше.
- `get_examples(topic, limit?)`
  - Ищет страницы по теме и извлекает фрагменты кода.
  - Учитывает фильтр языков из `XAFARI_CODE_LANGUAGES`.
  - `limit` ограничивает количество примеров (1–20, по умолчанию 5).
- `explain_concept(name)`
  - Возвращает краткое описание концепта и ссылку на наиболее релевантную страницу.
  - В `related` добавляет похожие разделы документации.

## Примеры API‑запросов (HTTPYac)

```http
POST http://localhost:3333/tools/search_docs
Content-Type: application/json

{
  "query": "Как работает модуль Performance Enhancement?",
  "limit": 5
}
```

```http
POST http://localhost:3333/tools/search_docs
Content-Type: application/json

{
  "query": "подключение к DevExpress XAF",
  "limit": 5
}
```

```http
POST http://localhost:3333/tools/get_page
Content-Type: application/json

{
  "slug": "doc_recursive_helper"
}
```

```http
POST http://localhost:3333/tools/get_page
Content-Type: application/json

{
  "slug": "https://documentation.galaktika-soft.com/xafari/doc_recursive_helper"
}
```

```http
POST http://localhost:3333/tools/get_examples
Content-Type: application/json

{
  "topic": "Business Components",
  "limit": 5
}
```

```http
POST http://localhost:3333/tools/explain_concept
Content-Type: application/json

{
  "name": "Security System"
}
```

## Подключение MCP в Cursor

1. Откройте настройки MCP в Cursor.
2. Добавьте новый сервер со следующими параметрами:
   - `name`: `xafari-mcp`
   - `command`: `node`
   - `args`: `["C:\\Projects\\xafari-mcp\\src\\index.js"]`
   - `cwd`: `C:\\Projects\\xafari-mcp`
3. Перезапустите MCP‑сервер в Cursor.

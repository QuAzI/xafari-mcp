# Xafari MCP

MCP‑сервер и краулер для документации Xafari. Он скачивает официальные страницы,
извлекает чистый текст и примеры кода, строит легковесный индекс и предоставляет
инструменты для поиска и объяснений.

## Зачем нужен MCP

MCP (Model Context Protocol) позволяет IDE и агентам обращаться к локальным данным
как к «инструментам». Вместо ручного поиска по сайту документации, ассистент
вызывает методы `search_docs`, `get_page` и `get_examples`, а сервер отвечает
структурированными данными. Это ускоряет работу, дает воспроизводимые ответы и
снижает зависимость от внешних источников.

### Как MCP ускоряет работу:

- Меньше ручного поиска: вместо переходов по сайту и копипасты — один вызов `search_docs/get_page`.
- Мгновенная выборка: локальный индекс и кэш дают ответы быстрее, чем браузер + поиск.
- Точнее ответы: инструменты возвращают структуру (заголовки, ссылки, код), а не разрозненный текст.
- Повторяемость: один и тот же запрос даёт одинаковый результат — удобно для командной работы.
- Автодогрузка: если страницы нет в кэше, get_page может скачать её автоматически.
- Офлайн‑режим: можно работать без доступа к сайту после первичного краула.

### Как работает MCP в этом проекте

- Краулер
  - Скачивает HTML, извлекает читабельный markdown и сохраняет в `data/pages`.
  - Кэширует страницы и использует ETag/Last‑Modified при повторных запусках.
  - Из markdown строится индекс `pages.json` + `index.json` для быстрого поиска.
- MCP‑сервер читает индекс и отвечает на вызовы инструментов через stdio/http.
- IDE подключается к серверу и использует инструменты прямо в чате.

## Быстрый старт

1. Запустить краулер и собрать локальный индекс:
   - `npm run crawl`
2. Запустить MCP‑сервер (stdio):
   - `npm run start`
3. Запустить HTTP‑режим (опционально):
   - `npm run start:http`
4. Пересобрать индекс без краулинга:
   - `npm run reindex`

Опции краулера:
- `npm run crawl` — по умолчанию скачивает только новые страницы.
- `npm run crawl -- --force` — перекачать все страницы.
- `npm run crawl -- --no-only-new` — отключить режим "только новые".

Примечание:
- `--no-only-new` делает полный обход с кешем (ETag/Last-Modified), а `--force` перекачивает все без учета кеша.

## Переменные окружения

- `XAFARI_DOCS_BASE_URL` (по умолчанию: `https://documentation.galaktika-soft.com/xafari/`)
- `XAFARI_MAX_PAGES_PER_SESSION` (по умолчанию: `1000`)
- `XAFARI_FETCH_ON_MISS` (по умолчанию: `true`)
- `XAFARI_DATA_DIR` (по умолчанию: `./data`)
- `XAFARI_REQUEST_TIMEOUT_MS` (по умолчанию: `15000`)
- `XAFARI_USER_AGENT`
- `XAFARI_LOG_FILE` (по умолчанию: `logs/xafari-mcp.jsonl`)
- `XAFARI_CODE_LANGUAGES` (по умолчанию: `cs,js,ts,json,yaml,xml,html,css`)
- `XAFARI_HTTP_PORT` (по умолчанию: `3333`)

### Примеры кода

- Примеры сохраняются только для языков из `XAFARI_CODE_LANGUAGES`.
- Языки нормализуются: `c#`/`csharp` → `cs`, `javascript` → `js`, `typescript` → `ts`, `yml` → `yaml`.
- Если язык не разрешен — блок кода не сохраняется.

### Fetch on miss

`get_page` может автоматически догружать страницу, если ее нет в кэше.
Управляется флагом `XAFARI_FETCH_ON_MISS` (по умолчанию `true`).

## Подключение MCP в IDE на примере Cursor

1. Откройте настройки MCP в Cursor.
2. Добавьте новый сервер со следующими параметрами:
   - `name`: `xafari-mcp`
   - `command`: `node`
   - `args`: `["C:\\Projects\\xafari-mcp\\src\\index.js"]`
   - `cwd`: `C:\\Projects\\xafari-mcp`
3. Перезапустите MCP‑сервер в Cursor.

## MCP‑инструменты

- `search_docs(query, limit?)`
  - Ищет по индексу документации и возвращает список результатов с `title`, `url`, `excerpt`, `headings`.
  - `limit` ограничивает количество результатов (1–20, по умолчанию 5).
- `get_page(slug)`
  - Возвращает полный контент страницы (markdown‑текст, headings, codeBlocks, links, breadcrumbs).
  - `slug` можно передать как относительный путь (`doc_recursive_helper`) или полный URL.
- `get_examples(topic, limit?)`
  - Ищет страницы по теме и извлекает фрагменты кода.
    - Делает search_docs(topic, limit) по индексу.
    - Берёт первые подходящие страницы и вытаскивает их codeBlocks.
    - Возвращает список примеров с slug, title, url, code.
  - `limit` ограничивает количество примеров (1–20, по умолчанию 5).
- `explain_concept(name)`
  - Возвращает краткое описание концепта и ссылку на наиболее релевантную страницу.
    - Делает search_docs(name, 3).
    - Берёт самый релевантный результат и возвращает:
      - summary — это excerpt из результата,
      - page — основная ссылка,
      - related — оставшиеся 1–2 страницы.
  - В `related` добавляет похожие разделы документации.

## stdio‑режим

stdio — MCP‑сервер общается с IDE через стандартные потоки ввода/вывода. Это нативный режим MCP: быстрее, проще в настройке, без сети и портов. Подходит для локального использования.

Транспорт и формат обмена:
- Общение по stdin/stdout.
- Формат: JSON‑RPC 2.0, построчно или через Content-Length.
  - Построчно — каждое сообщение это одна JSON‑строка, разделенная \n. Сервер читает строки и парсит каждую как отдельный JSON‑RPC запрос.
  - Через Content-Length — перед сообщением идут заголовки (как в LSP). Сервер сначала читает длину, потом ровно столько байт JSON‑тела.

Использовать можно не только из IDE, но и как локальную сервис‑утилиту:
- CLI/скрипты: можно запускать сервер и слать ему JSON‑RPC из скриптов (например, на CI или для массового прогрева кэша).
- Мост/прокси: stdio удобнее как backend для собственного HTTP‑прокси — он проще, чем держать внутри сервера HTTP‑слой.
- Интеграции: другой агент/процесс может общаться с MCP через pipe/stdin‑stdout, без открытого порта.
- Безопасность: нет открытых портов, меньше требований к сетевой конфигурации.

### Примеры stdio‑запросов

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
        "name": "search_docs",
        "arguments": {
            "query": "Performance Enhancement"
        }
    }
}
```

## HTTP‑режим

http — режим, в котором MCP‑сервер поднимает HTTP‑endpoint и принимает запросы по сети. Удобно для внешних клиентов и инструментов (например, HTTPYac), но требует поднять отдельный процесс и порт.

- Сервер поднимается командой `npm run start:http` (порт `XAFARI_HTTP_PORT`, по умолчанию `3333`).
- Каждый инструмент доступен через `POST /tools/{toolName}` с JSON‑телом аргументов.
- Для проверки доступен `GET /health`.

### Примеры HTTP‑запросов

Подходят для инструментов типа HTTPYac, плагинов HTTP Request в IDE.

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

## Формат хранения

- Сырые страницы сохраняются в `data/pages/*.md` с метаданными в заголовке.
- `pages.json` формируется из markdown-файлов после завершения краулинга.
- При сохранении учитываются breadcrumbs: страницы попадают в поддиректории по темам.
- Ассеты (PDF/картинки) сохраняются в `data/assets`, ссылки в markdown остаются абсолютными.

## Ручное пополнение документации

1. Создайте `.md` в `data/pages` (подкаталоги = breadcrumbs).
2. Добавьте YAML‑front‑matter с минимумом полей:
   ```
   ---
   slug: my_custom_doc
   url: https://example.local/my_custom_doc
   title: Мой документ
   breadcrumbs:
     - Custom
     - Docs
   ---
   ```
3. Добавьте тело документа ниже фронт‑маттера.
4. Пересоберите индекс без краулинга:
   - `npm run reindex`

## Логи

Структурированные логи пишутся в `data/logs/xafari-mcp.jsonl` (JSON Lines).

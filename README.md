# Custom Framework MCP

MCP-сервер для внутренней документации построенной на основе Markdown-документации. Строит легковесный индекс и предоставляет инструменты для поиска и объяснений.
Так же включает crawler, который может скачивать документацию Xafari с официального сайта, извлекать чистый текст и примеры кода. 

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
- Офлайн-режим: можно работать без доступа к сайту после первичного краула.

### Как работает MCP в этом проекте

- Краулер
  - Скачивает HTML, извлекает читабельный markdown и сохраняет в `data/pages`.
  - Кэширует страницы и использует ETag/Last-Modified при повторных запусках.
  - Из markdown строится индекс `pages.json` + `index.json` для быстрого поиска.
- MCP-сервер читает индекс и отвечает на вызовы инструментов через stdio/http.
- IDE подключается к серверу и использует инструменты прямо в чате.

## Быстрый старт

1. Запустить краулер и собрать локальный индекс:
   - `npm run crawl`
2. Запустить MCP-сервер (stdio):
   - `npm run start`
3. Запустить HTTP-режим (опционально):
   - `npm run start:http`
4. Пересобрать индекс без краулинга:
   - `npm run reindex`

## Переменные окружения

- `DOCS_BASE_URL` (например: `https://documentation.galaktika-soft.com/xafari/`)
- `MAX_PAGES_PER_SESSION` (по умолчанию: `10000`)
- `FETCH_ON_MISS` (по умолчанию: `true`, **только если** задан `DOCS_BASE_URL`)
- `DATA_DIR` (по умолчанию: `./data`)
- `REQUEST_TIMEOUT_MS` (по умолчанию: `15000`)
- `USER_AGENT`
- `LOG_FILE` (по умолчанию: `logs/mcp.jsonl`, путь относительно `DATA_DIR`)
- `LOG_STDOUT` (по умолчанию: `false`) — если `true`, логи дублируются в stdout (удобно в Docker)
- `CODE_LANGUAGES` (по умолчанию: `cs,js,ts,json,yaml,xml,html,css`)
- `HTTP_PORT` (по умолчанию: `3333`)
- `TOOLS_PREFIX` — если задана (непустая), инструменты будут иметь имена вида `${TOOLS_PREFIX}search_docs`, `${TOOLS_PREFIX}get_page`, ...

### Примеры кода

- Примеры сохраняются только для языков из `CODE_LANGUAGES`.
- Языки нормализуются: `c#`/`csharp` → `cs`, `javascript` → `js`, `typescript` → `ts`, `yml` → `yaml`.
- Если язык не разрешен — блок кода не сохраняется.

### Fetch on miss

`get_page` может автоматически догружать страницу, если ее нет в кэше.
Управляется флагом `FETCH_ON_MISS` (по умолчанию `true` если задан `DOCS_BASE_URL`).

## Подключение MCP в IDE на примере Cursor

### stdio-режим (локальный запуск)

1. Откройте настройки MCP в Cursor.
2. Добавьте новый сервер со следующими параметрами:
   - `name`: `custom-framework-mcp`
   - `command`: `node`
   - `args`: `["C:\\Projects\\custom-framework-mcp\\src\\index.js"]`
   - `cwd`: `C:\\Projects\\custom-framework-mcp`

Пример `~/.cursor/mcp.json`
```json
{
  "mcpServers": {
    "custom-framework-mcp": {
      "command": "node",
      "args": ["C:\\Projects\\custom-framework-mcp\\src\\index.js"],
      "cwd": "C:\\Projects\\custom-framework-mcp"
    }
  }
}
```

### stdio-режим (через Docker)

Если сервис запущен в Docker, можно использовать `docker exec`:

```json
{
  "mcpServers": {
    "custom-framework-mcp": {
      "command": "docker",
      "args": ["exec", "-i", "mcp-service", "node", "/app/src/index.js"]
    }
  }
}
```

### HTTP-режим (SSE)

Если сервис запущен в HTTP-режиме (например, через `docker compose`), используйте SSE transport:

```json
{
  "mcpServers": {
    "custom-framework-mcp": {
      "url": "http://localhost:3333/sse"
    }
  }
}
```

**Примечание:** HTTP-режим требует, чтобы сервис был запущен с `npm run start:http` или через `docker compose` (который автоматически запускает HTTP-сервер).

3. Перезапустите MCP-сервер в Cursor.

Чтобы проверить в окне чата напишите
```
list tools
```

Запросите какую-либо документацию с источника

## Запуск через docker compose

```shell
git clone https://github.com/QuAzI/custom-framework-mcp.git
cd custom-framework-mcp
docker compose up -d
```

## Запуск через npx

Локально в репозитории:

- `npm install`
- `npx .` — запустит MCP-сервер (stdio) через `src/index.js`.

Чтобы запускать из любого каталога:

- `npm link`
- `npx --no-install custom-framework-mcp`

Запуск прямо из GitHub (без публикации в npm):

- `npx github:QuAzI/custom-framework-mcp`

Опции краулера:
- `npm run crawl` — по умолчанию скачивает только новые страницы.
- `npm run crawl -- --force` — перекачать все страницы.
- `npm run crawl -- --no-only-new` — отключить режим "только новые".

Примечание:
- `--no-only-new` делает полный обход с кешем (ETag/Last-Modified), а `--force` перекачивает все без учета кеша.

## GitLab CI/CD (внешний репозиторий документации → индекс → деплой на VM)

В репозитории есть пример пайплайна [`.gitlab-ci.yml`](./.gitlab-ci.yml) для сценария:

- скачать документацию из **внешнего git-репозитория**
- собрать индекс из markdown (`npm run reindex`, данные в `DATA_DIR/pages`)
- задеплоить на VM по SSH и перезапустить `docker compose`, чтобы HTTP-сервер поднялся с актуальными `pages.json/index.json`

### CI/CD variables (настраиваются в GitLab → Settings → CI/CD → Variables)

Переменные для скачивания документации:

- `DOCS_REPO_URL` — URL внешнего репозитория документации (SSH или HTTPS)
- `DOCS_REF` — ветка/тег (по умолчанию: `main`)
- `DOCS_SUBDIR` — подкаталог в репозитории документации с markdown-деревом (по умолчанию: `docs`)
- `DOCS_SSH_PRIVATE_KEY` — **опционально**, SSH ключ для доступа к docs repo (если `DOCS_REPO_URL` по SSH)
- `DOCS_HTTP_TOKEN` — **опционально**, токен для доступа по HTTPS (используется через `~/.netrc`)
- `DOCS_HTTP_USER` — **опционально**, логин для `~/.netrc` (по умолчанию: `oauth2`, удобно для GitLab)

Переменные для деплоя на VM:

- `DEPLOY_HOST` — хост VM (DNS/IP)
- `DEPLOY_USER` — пользователь на VM
- `DEPLOY_PATH` — каталог на VM, где лежит сервис
- `DEPLOY_SSH_PRIVATE_KEY` — SSH ключ для деплоя
- `DEPLOY_SSH_PORT` — **опционально**, порт SSH (по умолчанию: `22`)
- `DEPLOY_COMPOSE_SERVICE` — **опционально**, имя сервиса compose (по умолчанию: `mcp-service`)
- `DEPLOY_HEALTHCHECK_URL` — **опционально**, URL для проверки после деплоя (например `http://<host>:3333/health`)

### Ожидаемая структура на VM (`DEPLOY_PATH`)

Пайплайн предполагает, что на VM уже есть каталог сервиса с `docker-compose.yml` и исходниками (а CI обновляет только `data/`):

```
DEPLOY_PATH/
  docker-compose.yml
  package.json
  src/
  data/              # обновляется из CI (pages/, pages.json, index.json, assets/)
```

После доставки `data.tgz` CI выполняет:

- `docker compose up -d --remove-orphans`
- `docker compose restart mcp-service` (чтобы сервер перечитал индекс, т.к. он кэшируется в памяти процесса)

### Расписание (Schedule)

Чтобы документация/индекс обновлялись регулярно:

1. GitLab → **CI/CD → Schedules** → Create a new schedule
2. Выберите ветку `master`
3. Добавьте нужные variables (например `DOCS_REPO_URL`, `DOCS_REF`, `DOCS_SUBDIR`)

Job `deploy_vm` в `.gitlab-ci.yml` уже настроен так, чтобы запускаться только для `master` и `schedule` (и не запускаться в Merge Request pipeline).

## MCP-инструменты

- `search_docs(query, limit?)`
  - Ищет по индексу документации и возвращает список результатов с `title`, `url`, `excerpt`, `headings`.
  - `limit` ограничивает количество результатов (1–20, по умолчанию 5).
- `get_page(slug | url)`
  - Возвращает полный контент страницы (markdown-текст, headings, codeBlocks, links, breadcrumbs).
  - `slug` — короткая форма (например, `doc_recursive_helper`).
  - `url` — полный адрес страницы документации.
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

## stdio-режим

stdio — MCP-сервер общается с IDE через стандартные потоки ввода/вывода. Это нативный режим MCP: быстрее, проще в настройке, без сети и портов. Подходит для локального использования.

Транспорт и формат обмена:
- Общение по stdin/stdout.
- Формат: JSON-RPC 2.0, построчно или через Content-Length.
  - Построчно — каждое сообщение это одна JSON-строка, разделенная \n. Сервер читает строки и парсит каждую как отдельный JSON-RPC запрос.
  - Через Content-Length — перед сообщением идут заголовки (как в LSP). Сервер сначала читает длину, потом ровно столько байт JSON-тела.

Использовать можно не только из IDE, но и как локальную сервис-утилиту:
- CLI/скрипты: можно запускать сервер и слать ему JSON-RPC из скриптов (например, на CI или для массового прогрева кэша).
- Мост/прокси: stdio удобнее как backend для собственного HTTP-прокси — он проще, чем держать внутри сервера HTTP-слой.
- Интеграции: другой агент/процесс может общаться с MCP через pipe/stdin-stdout, без открытого порта.
- Безопасность: нет открытых портов, меньше требований к сетевой конфигурации.

### Примеры stdio-запросов

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

## HTTP-режим

http — режим, в котором MCP-сервер поднимает HTTP-endpoint и принимает запросы по сети. Удобно для внешних клиентов и инструментов (например, HTTPYac), но требует поднять отдельный процесс и порт.

- Сервер поднимается командой `npm run start:http` (порт `HTTP_PORT`, по умолчанию `3333`).
- Каждый инструмент доступен через `POST /tools/{toolName}` с JSON-телом аргументов.
- Для проверки доступен `GET /health`.

### Примеры HTTP-запросов

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
  "url": "https://documentation.galaktika-soft.com/xafari/doc_recursive_helper"
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
- `pages.json` формируется из markdown-файлов после завершения краулинга (по умолчанию это **NDJSON**: один JSON-объект на строку, чтобы файл можно было читать потоково даже при больших объёмах).
- При сохранении учитываются breadcrumbs: страницы попадают в поддиректории по темам.
- Ассеты (PDF/картинки) сохраняются в `data/assets`, ссылки в markdown остаются абсолютными.

## Ручное пополнение документации

1. Создайте `.md` в `data/pages` (подкаталоги = breadcrumbs).
2. Добавьте YAML-front-matter с минимумом полей:
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
3. Добавьте тело документа ниже фронт-маттера.
4. Пересоберите индекс без краулинга:
   - `npm run reindex`

## Логи

Структурированные логи пишутся в `data/logs/mcp.jsonl` (JSON Lines) при `DATA_DIR=./data` и дефолтном `LOG_FILE=logs/mcp.jsonl`.

## Зачем Compose

Стенд из нескольких контейнеров описывается одним YAML-файлом вместо набора длинных `docker run`. Сети, тома, порядок запуска — декларативно.

```yaml
services:
  server:
    build:
      context: .
      dockerfile: docker/Dockerfile
    image: docker-nginx-fastcgi:1.0
    container_name: fastcgi-server
    restart: unless-stopped
    networks:
      - app-network

  proxy:
    image: nginx:1.30-alpine
    container_name: nginx-proxy
    restart: unless-stopped
    ports:
      - "80:8080"
    volumes:
      - ./nginx/proxy.conf:/etc/nginx/conf.d/default.conf:ro
    networks:
      - app-network
    depends_on:
      server:
        condition: service_healthy

networks:
  app-network:
    driver: bridge
```

> Поле `version:` в начале файла устарело — Compose v2 его игнорирует и предупреждает. В проекте его нет.

## build + image

| Запись | Что делает Compose |
|---|---|
| только `image:` | скачивает образ; `docker compose build` ничего не делает |
| только `build:` | собирает, образ получает имя `<проект>-<сервис>` |
| **`build:` + `image:`** | собирает и называет образ указанным тегом |

До ревью у `server` было только `image: my-fastcgi:1.0` — образ нужно было собрать отдельной командой `docker build`, иначе `up` падал. Теперь всё одной командой:

```bash
docker compose up --build -d
```

`context: .` — корень репозитория (иначе `COPY app/server.c` не найдёт файл), `dockerfile:` — путь к Dockerfile относительно контекста.

## Сеть и DNS

Compose создаёт bridge-сеть (`docker-nginx-fastcgi_app-network`). Внутри неё контейнеры находят друг друга **по имени сервиса** через встроенный DNS Docker (`127.0.0.11`):

```nginx
proxy_pass http://server:81;     # server — имя сервиса
```

| Порт | Кому доступен |
|---|---|
| `81` у `server` (только `EXPOSE`) | другим контейнерам в `app-network` |
| `ports: "80:8080"` у `proxy` | всем — порт опубликован на хосте |

`server` наружу не опубликован: попасть к нему можно только через прокси. Это и есть смысл reverse proxy.

> Сеть по умолчанию (`docker run` без `--network`) **не** даёт DNS по именам контейнеров — только пользовательские сети. Compose всегда создаёт пользовательскую.

## depends_on и healthcheck

| Запись | Чего ждёт Compose перед стартом `proxy` |
|---|---|
| `depends_on: [server]` | контейнер `server` **запущен** (процесс стартовал) |
| `condition: service_started` | то же |
| **`condition: service_healthy`** | `server` прошёл `HEALTHCHECK` |
| `condition: service_completed_successfully` | `server` завершился с кодом 0 (миграции, init-задачи) |

Лог из проекта:

```
Container fastcgi-server  Started
Container fastcgi-server  Waiting
Container fastcgi-server  Healthy
Container nginx-proxy     Starting
```

`service_healthy` работает, только если у сервиса есть healthcheck — в Dockerfile или в `healthcheck:` в Compose.

> `depends_on` влияет только на **запуск** через Compose. Если `server` упадёт позже, `proxy` будет отдавать 502 — приложение должно уметь переживать недоступность зависимостей.

## Монтирование конфига

```yaml
volumes:
  - ./nginx/proxy.conf:/etc/nginx/conf.d/default.conf:ro
```

- Официальный `nginx` подключает все `/etc/nginx/conf.d/*.conf` из своего `nginx.conf` — подмена `default.conf` заменяет сайт по умолчанию.
- `:ro` — контейнер не может изменить файл на хосте.
- Свой образ для прокси не нужен: конфиг меняется без пересборки (`docker compose restart proxy`).

## restart

| Политика | Перезапуск |
|---|---|
| `no` (по умолчанию) | никогда |
| `on-failure` | при выходе с ненулевым кодом |
| `always` | всегда, включая перезапуск Docker; даже если контейнер остановили вручную — поднимется после рестарта демона |
| `unless-stopped` | всегда, кроме случая, когда контейнер остановили вручную |

## Основные команды

```bash
docker compose up --build -d     # собрать и запустить в фоне
docker compose ps                # статус и health
docker compose logs -f proxy     # логи сервиса
docker compose exec server sh    # оболочка в контейнере
docker compose config            # итоговый YAML после подстановок — проверка синтаксиса
docker compose down              # остановить и удалить контейнеры и сеть
docker compose down -v           # … и тома
```

`container_name` фиксирует имя контейнера, но мешает масштабированию: `docker compose up --scale server=3` с ним невозможен — имена не могут повторяться.

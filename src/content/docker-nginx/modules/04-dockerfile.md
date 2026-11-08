## Инструкции Dockerfile

| Инструкция | Что делает | Новый слой? |
|---|---|---|
| `FROM debian:13-slim` | базовый образ | — |
| `RUN cmd` | выполнить команду при сборке | да |
| `COPY src dst` | скопировать файлы из контекста сборки | да |
| `WORKDIR /server` | рабочий каталог для следующих инструкций (создаётся, если нет) | метаданные |
| `ENV K=v` | переменная окружения при сборке и запуске | метаданные |
| `USER appuser` | от кого выполнять следующие `RUN` и сам контейнер | метаданные |
| `EXPOSE 81` | **документирует** порт — сам ничего не открывает | метаданные |
| `HEALTHCHECK` | команда проверки состояния | метаданные |
| `ENTRYPOINT` / `CMD` | что запускать при старте контейнера | метаданные |

`COPY` и `ADD`: `ADD` ещё умеет скачивать URL и распаковывать архивы. Предпочтительнее `COPY` — поведение предсказуемо.

## Слои и кеш сборки

Каждая `RUN` / `COPY` создаёт слой. При повторной сборке Docker переиспользует слой из кеша, пока инструкция и её входные данные не изменились. Изменилась одна инструкция — **все следующие** пересобираются.

Поэтому:

- редко меняющееся (установка пакетов) — **выше**, часто меняющееся (код) — **ниже**;
- `apt-get update` и `install` — в **одной** `RUN`. Отдельный `RUN apt-get update` закешируется, и через месяц `install` возьмёт устаревшие списки пакетов;
- очистка кеша apt — в той же `RUN`, иначе файлы уже записаны в предыдущий слой и место не освобождается.

```dockerfile
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libc6-dev libfcgi-dev && \
    rm -rf /var/lib/apt/lists/*
```

| Часть | Зачем |
|---|---|
| `-y` | без интерактивного подтверждения |
| `--no-install-recommends` | только обязательные зависимости — образ меньше |
| `rm -rf /var/lib/apt/lists/*` | удалить списки пакетов (десятки MB) в том же слое |

## ENTRYPOINT и CMD

| | `ENTRYPOINT` | `CMD` |
|---|---|---|
| Роль | что запускается всегда | аргументы по умолчанию (или команда, если ENTRYPOINT нет) |
| `docker run img args` | `args` дописываются как аргументы | `args` **заменяют** CMD |
| Переопределить | `--entrypoint` | просто аргументами |

### exec-форма и shell-форма

| Запись | Как запускается | PID 1 |
|---|---|---|
| `ENTRYPOINT ["/server/entrypoint.sh"]` | exec-форма: напрямую | сам скрипт |
| `ENTRYPOINT /server/entrypoint.sh` | shell-форма: `/bin/sh -c "…"` | `sh`, который **не пересылает сигналы** |

Всегда — exec-форма (JSON-массив).

## entrypoint.sh и PID 1

```bash
#!/bin/bash
set -e

spawn-fcgi -a 127.0.0.1 -p 8080 -f /server/server
nginx -t
exec nginx -g "daemon off;"
```

| Строка | Зачем |
|---|---|
| `set -e` | выйти при первой ошибке: упал `nginx -t` — контейнер не стартует с битым конфигом |
| `spawn-fcgi …` | запустить FastCGI в фоне (модуль 03) |
| `nginx -t` | проверка конфига до старта |
| `daemon off;` | nginx не уходит в фон — иначе главный процесс завершится, и контейнер остановится |
| **`exec`** | заменить процесс bash на nginx: nginx становится **PID 1** |

Зачем `exec`. Процесс с PID 1 получает сигналы от `docker stop` (SIGTERM). Без `exec` PID 1 — это bash: он ждёт nginx и сигнал ему не передаёт. Через 10 секунд Docker убивает всё SIGKILL — nginx не успевает корректно закрыть соединения.

Из вывода `ps` проекта:

```
appuser 1  nginx: master process nginx -g daemon off;
appuser 8  /server/server
appuser 10 nginx: worker process
```

PID 1 — nginx, как и задумано.

> PID 1 в Linux ещё и «усыновляет» процессы-сироты и должен собирать их статусы завершения (иначе остаются зомби). Если главный процесс этого не умеет, используют мини-init: `docker run --init` или `tini` в `ENTRYPOINT`.

## .gitattributes: окончания строк

```
* text=auto eol=lf
```

Скрипт с Windows-окончаниями `CRLF` внутри Linux-контейнера падает с непонятной ошибкой: `/bin/bash^M: bad interpreter`. Файл проекта заставляет git хранить LF на любой ОС.

## Права и владелец

```dockerfile
RUN chmod +x server entrypoint.sh
```

`COPY` сохраняет права из контекста, но при сборке на Windows бит исполнения теряется — `chmod +x` в Dockerfile надёжнее. Короче: `COPY --chmod=755 docker/entrypoint.sh .` (BuildKit).

## Сборка и запуск

```bash
docker build -f docker/Dockerfile -t docker-nginx-fastcgi:1.0 .
docker run -d --name srv -p 8081:81 docker-nginx-fastcgi:1.0
docker history docker-nginx-fastcgi:1.0     # слои и их размер
```

`.` в конце `build` — **контекст сборки**: каталог, содержимое которого отправляется демону Docker. `COPY` видит только файлы из контекста.

## Проблема single-stage

Первая версия образа ставила компилятор в тот же образ, где работает сервер:

```dockerfile
FROM debian:12-slim
RUN apt-get install -y gcc libc6-dev libfcgi-dev spawn-fcgi nginx …
COPY app/server.c .
RUN gcc -o server server.c -lfcgi
```

- gcc, заголовки, `libc6-dev` — сотни мегабайт, которые после сборки не нужны;
- компилятор в продакшен-образе — лишняя поверхность атаки: попавший в контейнер злоумышленник может собирать свои бинарники.

## Multi-stage

Несколько `FROM` в одном Dockerfile. Каждый начинает новую стадию с чистого листа; в финальный образ попадает **только последняя** стадия.

```dockerfile
# ---- стадия сборки ----
FROM debian:13-slim AS builder
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libc6-dev libfcgi-dev && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY app/server.c .
RUN gcc -O2 -o server server.c -lfcgi

# ---- финальная стадия ----
FROM debian:13-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends libfcgi0t64 spawn-fcgi nginx curl && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /server
COPY --from=builder /build/server .
```

| Элемент | Значение |
|---|---|
| `AS builder` | имя стадии |
| `COPY --from=builder /build/server .` | взять файл из другой стадии — только готовый бинарник |
| пакеты `-dev` | только в builder |
| `libfcgi0t64` | только разделяемая библиотека для запуска |

> Бинарник собран под Debian 13 и запускается на Debian 13 — версии glibc совпадают. Собрать в `debian:13`, а запускать в `alpine` (musl вместо glibc) так просто не получится.

## Результат

Замер из README (Docker Desktop 29.0.1):

| Образ | База | gcc внутри | `docker images` | сжатый |
|---|---|---|---|---|
| single-stage | Debian 12, nginx 1.22.1 | да | **397 MB** | 102 MB |
| multi-stage | Debian 13, nginx 1.26.3 | нет | **149 MB** (−62%) | 38 MB (−63%) |

`docker images` показывает распакованный размер на диске, «сжатый» — сколько скачивается из registry.

Меньше образ — быстрее `pull` на серверах и в CI, меньше пакетов — меньше CVE в отчётах сканеров (Trivy, Docker Scout).

## Обновление базы: Debian 12 → 13

При переходе на `debian:13-slim` (trixie) runtime-библиотека переименована: `libfcgi0ldbl` → `libfcgi0t64`. Суффикс `t64` — переход Debian на 64-битный `time_t` (проблема 2038 года): библиотеки с изменённым ABI получили новые имена пакетов.

> При обновлении базового образа имена пакетов могут измениться — сборка упадёт на `apt-get install` с `Unable to locate package`. Это нормальная часть обновления.

## .dockerignore

```
# пропускаем только нужное
*
!app/
!docker/
!nginx/
```

Перед сборкой Docker отправляет демону **весь контекст** (каталог `.`). В проекте туда уходил `container.tar` на 156 MB из модуля 01 — сборка ждала передачи лишних данных.

| Подход | Пример |
|---|---|
| чёрный список | `.git`, `*.tar`, `node_modules` |
| белый список (проект) | `*` + исключения `!app/` … — новый мусор в корне не попадёт в контекст сам |

Ещё одна причина `.dockerignore` — безопасность: `.env` с секретами не должен оказаться в контексте и, через неосторожный `COPY . .`, в образе.

## Другие способы уменьшить образ

| Способ | Размер базы | Нюанс |
|---|---|---|
| `debian:13-slim` | ~75 MB | glibc, привычный apt |
| `alpine` | ~8 MB | musl libc, `apk`; бинарники glibc не работают |
| `distroless` | ~2–20 MB | нет shell и пакетного менеджера — `docker exec … sh` невозможен |
| `scratch` | 0 | только статически собранный бинарник |

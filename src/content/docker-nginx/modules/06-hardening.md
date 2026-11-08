## Dockle

Линтер образов: проверяет собранный образ на соответствие CIS Docker Benchmark и практикам безопасности.

```bash
docker save docker-nginx-fastcgi:1.0 -o docker-nginx-fastcgi.tar
dockle --input docker-nginx-fastcgi.tar
```

| Уровень | Значение |
|---|---|
| `FATAL` | серьёзная проблема (секреты в образе) |
| `WARN` | нарушение практики (запуск от root) |
| `INFO` | рекомендация |
| `SKIP` / `PASS` | проверка пропущена / пройдена |

Dockle смотрит на **конфигурацию образа и файлы**. Уязвимости в пакетах (CVE) ищут другие сканеры: Trivy, Docker Scout, Grype.

## Что нашёл Dockle в первой версии

Первая версия была на `nginx:latest`:

| Код | Что | Почему |
|---|---|---|
| `FATAL CIS-DI-0010` | секреты в слоях образа | в слоях официального образа лежали переменные `NGINX_GPGKEYS` — Dockle считает ключи в `ENV` подозрительными |
| `WARN CIS-DI-0001` | запуск от root | в Dockerfile нет `USER` |

Финальный результат:

```
INFO - CIS-DI-0005: Enable Content trust for Docker
```

Ни FATAL, ни WARN. `CIS-DI-0005` — совет включить проверку подписей образов (`DOCKER_CONTENT_TRUST=1`).

> Проблему CIS-DI-0010 нельзя исправить «удалением файла» в своём Dockerfile: слои базового образа неизменяемы, и `RUN rm` только скрывает файл, но он остаётся в нижнем слое. Поэтому база заменена на `debian-slim`.

## Не root

```dockerfile
RUN useradd -r -s /usr/sbin/nologin appuser
…
USER appuser
```

| Флаг `useradd` | Значение |
|---|---|
| `-r` | системный пользователь (UID < 1000, без домашнего каталога по умолчанию) |
| `-s /usr/sbin/nologin` | войти интерактивно нельзя |

Почему важно: root в контейнере — это root ядра хоста, ограниченный namespaces. При уязвимости побега из контейнера (или ошибочно смонтированном `/var/run/docker.sock`, `/`) root внутри становится root на хосте. Непривилегированный пользователь резко ограничивает ущерб.

Что пришлось сделать, чтобы nginx заработал не от root (модуль 02):

```dockerfile
RUN mkdir -p /var/lib/nginx /var/log/nginx /tmp/client_temp /tmp/proxy_temp \
        /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp && \
    chown -R appuser:appuser /var/lib/nginx /var/log/nginx /tmp
```

+ `pid /tmp/nginx.pid` и `*_temp_path /tmp/…` в конфиге.

> `USER` ставят **после** всех `RUN`, которым нужен root (apt, chown, chmod).

## SUID и SGID

Бит **SUID** — программа выполняется с правами **владельца файла**, а не того, кто её запустил. У `passwd`, `su`, `mount` владелец — root: так обычный пользователь меняет свой пароль. В контейнере эти программы не нужны, а SUID-бинарник — классический путь повышения привилегий.

```bash
find / -perm /6000 -type f 2>/dev/null    # найти все SUID (4000) и SGID (2000) файлы
```

```dockerfile
RUN chmod u-s /usr/bin/passwd /usr/bin/mount /usr/bin/chfn /usr/bin/newgrp \
              /usr/bin/chsh /usr/bin/umount /usr/bin/gpasswd /usr/bin/su 2>/dev/null || true && \
    chmod g-s /usr/sbin/unix_chkpwd /usr/bin/expiry /usr/bin/chage 2>/dev/null || true
```

| Часть | Значение |
|---|---|
| `u-s` | снять SUID |
| `g-s` | снять SGID |
| `2>/dev/null \|\| true` | не падать, если какого-то файла нет в этой версии Debian |

Список захардкожен: появись в базе новый SUID-файл — он останется. Универсально:

```dockerfile
RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null || true
```

Дополнительно на уровне запуска: `docker run --security-opt no-new-privileges` — процесс не может получить больше прав даже через SUID.

## Фиксированные теги

| Тег | Что получишь через месяц |
|---|---|
| `nginx:latest` | другую версию — сейчас это mainline-ветка |
| `nginx:1.30-alpine` | последний патч stable 1.30 |
| `nginx:1.30.0-alpine` | ровно эту версию |
| `nginx@sha256:…` | побайтно тот же образ |

`latest` — невоспроизводимая сборка: вчера работало, сегодня после `pull` сломалось. В проекте `nginx:latest` заменён на `nginx:1.30-alpine`.

## HEALTHCHECK

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://127.0.0.1:81/status || exit 1
```

| Параметр | Значение |
|---|---|
| `--interval=30s` | как часто проверять |
| `--timeout=5s` | дольше — проверка провалена |
| `--start-period=5s` | время на запуск: провалы не считаются; проверки в этот период идут с `start-interval` (по умолчанию 5 с) |
| `--retries=3` | столько провалов подряд → `unhealthy` |
| `curl -f` | вернуть ошибку на HTTP 4xx/5xx, а не только на сетевую ошибку |
| `\|\| exit 1` | код 1 = unhealthy (код 2 зарезервирован) |

Статус: `docker ps` → `Up 9 seconds (healthy)`, подробности — `docker inspect --format '{{json .State.Health}}' fastcgi-server`.

> Healthcheck требует `curl` в runtime-образе — ещё один пакет. И в проекте он проверяет `/status` nginx, а не FastCGI — модуль 03.

> Сам Docker **не перезапускает** контейнер со статусом `unhealthy`. Статус используют `depends_on: service_healthy` в Compose, Swarm и оркестраторы.

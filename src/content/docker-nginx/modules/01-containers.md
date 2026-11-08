## Образ и контейнер

| | Образ (image) | Контейнер (container) |
|---|---|---|
| Что это | шаблон: файловая система слоями + метаданные (команда запуска, порты, переменные) | запущенный экземпляр образа |
| Меняется? | нет, только читается | поверх образа — свой слой для записи |
| Аналогия | класс | объект |

Из одного образа можно запустить сколько угодно контейнеров. Удалили контейнер — его записывающий слой пропал, образ остался.

> Контейнер — не виртуальная машина. Это обычный процесс Linux, изолированный **namespaces** (свои PID, сеть, файловая система, hostname) и ограниченный **cgroups** (CPU, память). Ядро общее с хостом.

## Жизненный цикл

```bash
docker pull nginx:1.30-alpine                 # скачать образ
docker run -d --name web -p 8080:80 nginx:1.30-alpine
docker ps                                     # запущенные контейнеры
docker ps -a                                  # включая остановленные
docker logs -f web                            # stdout / stderr контейнера
docker exec -it web sh                        # командная оболочка внутри
docker stop web                               # SIGTERM, через 10 с — SIGKILL
docker start web
docker restart web
docker rm web                                 # удалить контейнер
docker rmi nginx:1.30-alpine                  # удалить образ
```

| Флаг `run` | Значение |
|---|---|
| `-d` | в фоне (detached) |
| `--name web` | имя вместо случайного |
| `-p 8080:80` | порт **хоста** 8080 → порт **контейнера** 80 |
| `-v src:dst` | монтировать файл или каталог хоста |
| `-e KEY=val` | переменная окружения |
| `--rm` | удалить контейнер после остановки |

> В `-p 8080:80` слева — хост, справа — контейнер. Перепутать — самая частая ошибка.

## docker inspect

```bash
docker inspect web
docker inspect -f '{{.NetworkSettings.IPAddress}}' web
docker inspect -f '{{.State.Health.Status}}' fastcgi-server
```

JSON со всем: образ, команда, переменные, порты, тома, IP, статус healthcheck. `-f` — шаблон Go, чтобы вытащить одно поле.

## Изменение конфига в работающем контейнере

Из проекта: подложить свой `nginx.conf` и применить без перезапуска.

```bash
docker cp nginx.conf web:/etc/nginx/nginx.conf
docker exec web nginx -t          # проверить синтаксис
docker exec web nginx -s reload   # перечитать конфиг
curl localhost:8080/status
```

`nginx -s reload` — мастер-процесс перечитывает конфиг и плавно заменяет worker-процессы, не обрывая текущие соединения.

> Изменения через `docker cp` живут только в этом контейнере и пропадут при его пересоздании. Правильный способ — смонтировать файл (`-v ./nginx.conf:/etc/nginx/nginx.conf:ro`) или собрать свой образ.

## export / import и save / load

| Команды | Что сохраняется | Слои и метаданные |
|---|---|---|
| `docker export web > c.tar` → `docker import c.tar img` | **файловая система контейнера** одним слоем | история, `CMD`, `ENTRYPOINT`, `ENV`, `EXPOSE` **теряются** |
| `docker save img > i.tar` → `docker load < i.tar` | **образ** со всеми слоями | сохраняются |

После `import` образ не знает, какую команду запускать — её нужно указать явно:

```bash
docker export web > container.tar
docker import container.tar my-nginx:imported
docker run -d -p 8081:80 my-nginx:imported nginx -g "daemon off;"
```

Для переноса образа между машинами без registry — `save` / `load`. В проекте `docker save` использовался для проверки образа в Dockle.

## Очистка

```bash
docker system df          # сколько места занимают образы, контейнеры, тома, кеш
docker system prune       # удалить остановленные контейнеры, неиспользуемые сети, dangling-образы
docker image prune -a     # удалить все образы без контейнеров
```

## Структура конфига

```nginx
pid /tmp/nginx.pid;              # главный контекст

events {
    worker_connections 1024;     # соединений на один worker-процесс
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    server {                     # виртуальный сервер
        listen 81;
        server_name localhost;

        location / { … }         # правила для путей
        location /status { … }
    }
}
```

| Контекст | Для чего |
|---|---|
| main | процессы, пользователь, pid-файл, логи ошибок |
| `events` | обработка соединений |
| `http` | всё про HTTP: типы файлов, логи, временные каталоги |
| `server` | один сайт: порт, имя хоста |
| `location` | что делать с запросами по пути |

nginx — **master** (читает конфиг, управляет) + несколько **worker**-процессов (обрабатывают запросы, каждый — тысячи соединений через epoll).

## location: выбор правила

| Запись | Совпадение | Приоритет |
|---|---|---|
| `location = /status` | точно `/status` | 1 — высший |
| `location ^~ /static/` | префикс, регулярки не проверяются | 2 |
| `location ~ \.php$` | регулярное выражение (с учётом регистра; `~*` — без) | 3, в порядке записи |
| `location /status` | префикс | 4 — самый длинный совпавший |
| `location /` | префикс — всё остальное | последний |

`/status` в проекте — префиксная: под неё попадёт и `/status123`. Точнее — `location = /status`.

## stub_status

```nginx
location /status {
    stub_status;
}
```

```
Active connections: 1
server accepts handled requests
 3 3 3
Reading: 0 Writing: 1 Waiting: 0
```

| Поле | Значение |
|---|---|
| `Active connections` | открытые соединения сейчас, включая ожидающие |
| `accepts` / `handled` / `requests` | всего принято соединений / обработано / запросов |
| `Reading` / `Writing` / `Waiting` | читается заголовок / пишется ответ / keep-alive простаивает |

`accepts` ≠ `handled` — nginx отбрасывал соединения из-за лимитов (`worker_connections`). Модуль `ngx_http_stub_status_module` — источник метрик для `nginx-prometheus-exporter`.

> `/status` раскрывает информацию о нагрузке. Его закрывают: `allow 127.0.0.1; deny all;`. В проекте внутри образа стоит `allow all`, а прокси пробрасывает `/status` наружу на порт 80 — страница доступна всем.

## Reverse proxy

```nginx
server {
    listen 8080;
    location / {
        proxy_pass http://server:81;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

| Директива | Зачем |
|---|---|
| `proxy_pass http://server:81` | переслать запрос бэкенду; `server` — имя сервиса в Compose, резолвится DNS Docker |
| `Host $host` | бэкенд получает исходное имя хоста, а не `server:81` |
| `X-Real-IP $remote_addr` | IP клиента — иначе бэкенд видит IP прокси |
| `X-Forwarded-For $proxy_add_x_forwarded_for` | цепочка IP через несколько прокси (в проекте не задан) |

Что даёт прокси перед приложением: единая точка входа, TLS, балансировка между несколькими бэкендами, кеш, ограничение частоты запросов, защита бэкенда от медленных клиентов.

> В `proxy.conf` проекта отдельный `location /status` лишний: `location /` и так проксирует любой путь, включая `/status`, на тот же бэкенд.

### Слеш в конце proxy_pass

| Запись | `/app/page` уходит на бэкенд как |
|---|---|
| `location /app/ { proxy_pass http://b; }` | `/app/page` — путь без изменений |
| `location /app/ { proxy_pass http://b/; }` | `/page` — префикс `location` заменён на `/` |

## Проверка и применение

```bash
nginx -t              # синтаксис и пути
nginx -s reload       # перечитать конфиг без остановки
nginx -T              # вывести итоговый конфиг со всеми include
```

## nginx без root

Обычно master работает от root (чтобы открыть порты < 1024 и писать в `/var/run`), а workers — от `nginx` / `www-data`. В образе проекта всё работает от `appuser`, поэтому:

```nginx
pid /tmp/nginx.pid;
client_body_temp_path /tmp/client_temp;
proxy_temp_path       /tmp/proxy_temp;
fastcgi_temp_path     /tmp/fastcgi_temp;
```

- pid-файл и временные каталоги — туда, куда у `appuser` есть права;
- порт `81` меньше 1024, то есть **привилегированный**: на обычном Linux процесс без root его не откроет. В контейнере это работает, потому что Docker (с версии 20.10) ставит в сетевом namespace контейнера `net.ipv4.ip_unprivileged_port_start=0`. Вне Docker или с `--network host` nginx от `appuser` на `:81` упадёт с `Permission denied` — надёжнее порт ≥ 1024, например 8081.

## Что такое FastCGI

Протокол между веб-сервером и приложением. nginx сам умеет отдавать статику, а динамические ответы получает от отдельного процесса.

| Подход | Как работает | Проблема |
|---|---|---|
| CGI | на **каждый** запрос запускается новый процесс | fork + exec на каждый запрос — медленно |
| **FastCGI** | процесс приложения живёт постоянно и обрабатывает запросы в цикле | — |

FastCGI — двоичный протокол поверх TCP или Unix-сокета. Так nginx работает с PHP-FPM; Python использует похожие протоколы — WSGI, uWSGI.

## Сервер на C

```c
#include <fcgi_stdio.h>

int main() {
    while (FCGI_Accept() >= 0) {
        printf("Content-type: text/html\r\n\r\n");
        printf("<html><head><title>Hello, World!</title></head>");
        printf("<body><h1>Hello, World!</h1>");
        printf("<p>This is a FastCGI server running on port 8080</p>");
        printf("</body></html>");
    }
    return 0;
}
```

| Часть | Что делает |
|---|---|
| `fcgi_stdio.h` | подменяет `printf`, `stdin`, `stdout` — вывод уходит в FastCGI-ответ, а не в терминал |
| `FCGI_Accept()` | ждёт следующий запрос; `< 0` — ошибка или завершение |
| `Content-type: …\r\n\r\n` | заголовок ответа и **пустая строка** — граница между заголовками и телом |

Ответ одинаковый на любой путь: сервер не смотрит `REQUEST_URI`, поэтому `/anything` → 200 (ограничение из README). Путь доступен как `getenv("REQUEST_URI")`.

## Сборка

```bash
gcc -O2 -o server server.c -lfcgi
```

| Флаг | Значение |
|---|---|
| `-O2` | оптимизация |
| `-o server` | имя бинарника |
| `-lfcgi` | слинковать с библиотекой `libfcgi` |

Для сборки нужен пакет с заголовками (`libfcgi-dev`), для запуска — только разделяемая библиотека (`libfcgi0t64` в Debian 13). На этом различии построена multi-stage сборка (модуль 05).

## spawn-fcgi

```bash
spawn-fcgi -a 127.0.0.1 -p 8080 -f /server/server
```

| Флаг | Значение |
|---|---|
| `-a 127.0.0.1` | слушать только локальный интерфейс контейнера |
| `-p 8080` | порт |
| `-f /server/server` | какую программу запустить |
| `-n` | не уходить в фон (в проекте не используется) |

spawn-fcgi открывает сокет, запускает программу, передаёт ей сокет и **завершается** сам. Программа остаётся работать в фоне.

> Если `/server/server` упадёт, его никто не перезапустит: spawn-fcgi уже завершился, а nginx (PID 1) — не супервизор. В выводе `ps` проекта видно: `appuser 8 /server/server` — обычный процесс без надзора.

## nginx → FastCGI

```nginx
location / {
    fastcgi_pass 127.0.0.1:8080;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    include /etc/nginx/fastcgi_params;
}
```

| Директива | Зачем |
|---|---|
| `fastcgi_pass` | адрес FastCGI-процесса (аналог `proxy_pass` для HTTP) |
| `include fastcgi_params` | стандартный набор переменных: `REQUEST_METHOD`, `QUERY_STRING`, `REQUEST_URI`, `REMOTE_ADDR`… |
| `SCRIPT_FILENAME` | путь к скрипту — нужен PHP-FPM; нашему серверу на C не важен |

## Путь запроса целиком

```
curl localhost/            хост :80
  → nginx-proxy :8080      proxy_pass http://server:81
  → nginx в server :81     fastcgi_pass 127.0.0.1:8080
  → /server/server         FCGI_Accept → printf
  ← HTML обратно по той же цепочке
```

Три перехода: два HTTP и один FastCGI.

## Найденная проблема: healthcheck проверяет не то

```dockerfile
HEALTHCHECK CMD curl -f http://127.0.0.1:81/status || exit 1
```

`/status` отдаёт **сам nginx** (`stub_status`), FastCGI-сервер в этом не участвует. Если `/server/server` упадёт, `/status` продолжит отвечать 200, контейнер останется `healthy`, а `/` будет отдавать `502 Bad Gateway`. Проверять нужно то, ради чего контейнер существует:

```dockerfile
HEALTHCHECK CMD curl -f http://127.0.0.1:81/ || exit 1
```

Вывод из `ps` — заодно аргумент за «один процесс на контейнер»: FastCGI в своём контейнере со своим healthcheck и `restart: unless-stopped` перезапускался бы автоматически.

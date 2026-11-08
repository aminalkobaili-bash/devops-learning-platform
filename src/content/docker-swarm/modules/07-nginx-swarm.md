## Роль nginx в стеке

В Compose наружу открыты сами `session-service:8081` и `gateway-service:8087`. В Swarm порты публикует **только nginx** — единая точка входа:

```yaml
nginx:
  image: nginx:1.30.6-alpine
  ports:
    - "8081:8081"
    - "8087:8087"
  volumes:
    - /vagrant/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
  deploy:
    placement:
      constraints: [node.role == manager]
```

Клиенты (и Postman) используют те же порты, что в Compose, — меняется только хост: `192.168.56.10` вместо `localhost`.

## Конфиг

```nginx
events {}

http {
    resolver 127.0.0.11 valid=10s ipv6=off;

    server {
        listen 8081;
        location / {
            set $session_service http://session-service:8081;
            proxy_pass $session_service;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }

    server {
        listen 8087;
        location / {
            set $gateway_service http://gateway-service:8087;
            proxy_pass $gateway_service;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_connect_timeout 30s;
            proxy_send_timeout 300s;
            proxy_read_timeout 300s;
        }
    }
}
```

## Почему переменная в proxy_pass

| Запись | Когда nginx резолвит имя | Что если сервиса ещё нет |
|---|---|---|
| `proxy_pass http://session-service:8081;` | **один раз при старте** | `host not found in upstream` — nginx **не запускается** |
| `set $s http://session-service:8081;` + `proxy_pass $s;` | **при каждом запросе** через `resolver` | nginx стартует; запрос получит 502, пока сервис не появится |

В Swarm все сервисы стартуют одновременно (`depends_on` игнорируется), и Java-сервисы поднимаются дольше nginx. Со статическим `proxy_pass` nginx падал бы на старте, пока DNS-записи сервисов не появились.

Вторая причина — **кеширование IP**. Статический `proxy_pass` запоминает IP навсегда. Если сервис пересоздан с другим адресом, nginx продолжит слать запросы на старый. С `resolver … valid=10s` адрес перепроверяется не реже раза в 10 секунд.

| Директива | Значение |
|---|---|
| `resolver 127.0.0.11` | встроенный DNS Docker — доступен в каждом контейнере пользовательской сети |
| `valid=10s` | сколько кешировать ответ DNS |
| `ipv6=off` | не запрашивать AAAA-записи |

> В Swarm имя сервиса резолвится в **VIP** — виртуальный IP, который не меняется при пересоздании задач. Поэтому для Swarm-сервисов вторая причина менее критична, а первая (старт nginx раньше сервисов) — главная.

### Тонкость с путём

С переменной в `proxy_pass` nginx **не подставляет** URI запроса автоматически, если в переменной указан путь. Здесь в переменной только `http://host:port` без пути — URI передаётся как есть, поведение такое же, как у статической записи.

## Таймауты

| Директива | По умолчанию | В проекте | Что ограничивает |
|---|---|---|---|
| `proxy_connect_timeout` | 60s | 30s | установка соединения с бэкендом |
| `proxy_send_timeout` | 60s | 300s | паузы при отправке запроса бэкенду |
| `proxy_read_timeout` | 60s | 300s | паузы между пакетами ответа бэкенда |

Почему 300s: запрос **Book Hotel** синхронно обрабатывает каждый из 61 дня брони — около 250 внутренних HTTP-запросов между сервисами. В Compose это 6–7 секунд, на слабом стенде Swarm — больше минуты; с таймаутом 60s nginx обрывал запрос с `504 Gateway Timeout`.

> Увеличенный таймаут лечит симптом. Причина — синхронная обработка долгой операции. Правильнее — асинхронно: принять запрос (`202 Accepted`), обработать в фоне (очередь, как уже сделано для статистики через RabbitMQ), отдать статус по отдельному запросу.

## Отличие от модуля про FastCGI

В проекте Docker nginx (FastCGI) был один `upstream` в Compose со статическим `proxy_pass` — там `depends_on: service_healthy` гарантировал, что сервер уже работает. Здесь такой гарантии нет — отсюда `resolver` и переменная.

## Проверка

```bash
docker service logs myapp_nginx
docker exec -it $(docker ps -q -f name=myapp_nginx) nginx -t
curl -s http://192.168.56.10:8081/api/v1/auth/authorize …   # через Postman / newman
```

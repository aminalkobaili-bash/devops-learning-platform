## Проблема

Java-сервис при старте сразу подключается к PostgreSQL. Если база ещё инициализируется — `Connection refused`, Spring Boot падает. RabbitMQ стартует ещё дольше (10–20 секунд).

`depends_on: [database]` **не помогает**: Compose ждёт только **запуска контейнера** базы, а не готовности PostgreSQL принимать соединения.

## Healthcheck для PostgreSQL и RabbitMQ

```yaml
database:
  image: postgres:18.6-alpine
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
    interval: 5s
    timeout: 5s
    retries: 10
    start_period: 10s

rabbitmq:
  image: rabbitmq:4.3.7-management-alpine
  healthcheck:
    test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
    interval: 10s
    timeout: 10s
    retries: 10
    start_period: 20s
```

| Проверка | Что делает |
|---|---|
| `pg_isready` | спрашивает сервер, принимает ли он соединения; код 0 — готов |
| `rabbitmq-diagnostics -q ping` | проверяет, что узел RabbitMQ запущен и отвечает |

### CMD и CMD-SHELL

| Форма | Как выполняется | Переменные окружения |
|---|---|---|
| `["CMD", "prog", "arg"]` | напрямую | не раскрываются |
| `["CMD-SHELL", "prog $VAR"]` | через `/bin/sh -c` | раскрываются shell внутри контейнера |

### $$ в Compose

```yaml
test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
```

Compose сам подставляет `${VAR}` из `.env` при разборе файла. `$$` — экранирование: Compose превратит его в один `$`, и `${POSTGRES_USER}` раскроет **shell внутри контейнера** из переменных контейнера.

## depends_on с условием

```yaml
x-depends-db-mq: &depends-db-mq
  database:
    condition: service_healthy
  rabbitmq:
    condition: service_healthy

booking-service:
  depends_on: *depends-db-mq
```

| condition | Чего ждёт Compose |
|---|---|
| `service_started` | контейнер запущен (то же, что список) |
| `service_healthy` | healthcheck прошёл |
| `service_completed_successfully` | контейнер завершился с кодом 0 (миграции) |

Лог из проекта:

```
Container docker-compose-microservices-database-1  Healthy
Container docker-compose-microservices-rabbitmq-1  Healthy
…
Container docker-compose-microservices-gateway-service-1  Started
```

> У Java-сервисов healthcheck нет. Поэтому `gateway-service` с `depends_on: [session-service]` ждёт только запуска контейнера session — JVM в этот момент ещё поднимается. Spring Boot Actuator даёт `/actuator/health` — его можно использовать как healthcheck сервиса.

## wait-for-it.sh: ожидание внутри образа

```dockerfile
ENTRYPOINT ["./wait-for-it.sh", "database:5432", "--", "java", "-jar", "app.jar"]
```

Зачем, если есть `depends_on`: **в Swarm `depends_on` игнорируется** (модуль 06). Ожидание должно быть в самом сервисе.

`wait-for-it.sh` в цикле пробует открыть TCP-соединение (`/dev/tcp/host/port` или `nc -z`), а после успеха выполняет `exec java …` — java становится PID 1 и получает сигналы.

### Найденное: ожидание не гарантирует запуск после БД

Из кода `wait-for-it.sh`:

```bash
WAITFORIT_TIMEOUT=${WAITFORIT_TIMEOUT:-15}
WAITFORIT_STRICT=${WAITFORIT_STRICT:-0}
…
if [[ $WAITFORIT_RESULT -ne 0 && $WAITFORIT_STRICT -eq 1 ]]; then
    exit $WAITFORIT_RESULT
fi
exec "${WAITFORIT_CLI[@]}"
```

| Параметр | По умолчанию | Следствие |
|---|---|---|
| таймаут | **15 секунд** | дольше не ждёт |
| strict | **выключен** | после таймаута **всё равно запускает** `java` |

В проекте вызов без `-t` и `-s`: если PostgreSQL не открыл порт за 15 секунд (холодный старт на слабой ВМ, база на другой ноде ещё скачивает образ), сервис стартует без базы и падает. Swarm его перезапустит — отсюда часть `Failed` задач в `docker stack ps`.

Надёжнее:

```dockerfile
ENTRYPOINT ["./wait-for-it.sh", "database:5432", "-t", "120", "-s", "--", "java", "-jar", "app.jar"]
```

### Ещё два ограничения

- **Открытый порт ≠ готовая база.** PostgreSQL открывает порт, пока ещё выполняет `init.sql`. `pg_isready` точнее, чем TCP-проверка.
- **Ждём только базу.** `booking-service` и `report-service` зависят и от RabbitMQ, но в образе ждут лишь `database:5432`.

## Правильная модель: приложение переживает недоступность

Любые «ожидания при старте» — костыль: база может упасть и **после** старта сервиса. Устойчивый сервис:

- повторяет подключение с паузой (retry с backoff) — Spring Boot умеет через настройки пула соединений и Spring Retry;
- отдаёт `/health` = `DOWN`, пока зависимости недоступны;
- оркестратор перезапускает его, если он не может восстановиться.

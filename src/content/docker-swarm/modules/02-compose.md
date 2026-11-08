## Схема

```
Клиент ──► :8081 session-service ──► PostgreSQL (6 баз)
       └─► :8087 gateway-service ──► session, hotel, booking, loyalty, report
                                      booking ──► hotel, payment, loyalty
                                      booking ──► RabbitMQ ──► report
```

7 Spring Boot сервисов + PostgreSQL + RabbitMQ в одной bridge-сети. Наружу открыты только `8081` и `8087`.

## Адреса сервисов — через окружение

```yaml
booking-service:
  environment:
    HOTEL_SERVICE_HOST: hotel-service
    HOTEL_SERVICE_PORT: 8082
    PAYMENT_SERVICE_HOST: payment-service
    …
```

В `application.properties` сервиса — `${HOTEL_SERVICE_HOST}`. Spring подставляет переменные окружения.

- `localhost` внутри контейнера — это **сам контейнер**, а не соседний сервис.
- Имя сервиса Compose (`hotel-service`) резолвится встроенным DNS Docker в IP контейнера.
- Конфигурация не зашита в образ: тот же образ работает в Compose, в Swarm и на любом стенде.

Это принцип **12-factor app**: конфигурация — в окружении.

## YAML-якоря: убрать повторы

Одни и те же переменные PostgreSQL и RabbitMQ повторялись в 7 сервисах. Теперь:

```yaml
x-postgres-env: &postgres-env
  POSTGRES_HOST: database
  POSTGRES_PORT: 5432
  POSTGRES_USER: postgres
  POSTGRES_PASSWORD: postgres

x-depends-db: &depends-db
  database:
    condition: service_healthy

services:
  hotel-service:
    environment:
      <<: [*postgres-env, *jwt-env]
      POSTGRES_DB: hotels_db
    depends_on: *depends-db
```

| Синтаксис | Значение |
|---|---|
| `&name` | **якорь**: запомнить этот блок под именем |
| `*name` | **ссылка**: вставить блок целиком |
| `<<: *name` | **слияние** ключей блока в текущий словарь |
| `<<: [*a, *b]` | слить несколько блоков |
| `x-…` | расширение Compose: ключи с `x-` Compose игнорирует — место для якорей |

Ключи, записанные рядом с `<<:`, **дополняют или перекрывают** слитые (`POSTGRES_DB: hotels_db`).

> Якоря — возможность самого YAML, а не Compose: они работают в любом YAML, в том числе в `.gitlab-ci.yml`.

## Обязательные переменные

```yaml
x-jwt-env: &jwt-env
  JWT_PRIVATE_KEY: ${JWT_PRIVATE_KEY:?set JWT_PRIVATE_KEY in .env}
  JWT_PUBLIC_KEY: ${JWT_PUBLIC_KEY:?set JWT_PUBLIC_KEY in .env}
```

| Запись | Если переменной нет |
|---|---|
| `${VAR}` | пустая строка + предупреждение |
| `${VAR:-default}` | `default` |
| `${VAR:?message}` | **Compose не стартует** и пишет `message` |

Compose автоматически читает `.env` рядом с `docker-compose.yml`. Без него проект не запустится, а не стартует с пустыми ключами.

> В `healthcheck` написано `$${POSTGRES_USER}` — двойной `$` экранирует интерполяцию Compose: переменная раскроется **внутри контейнера**, а не при разборе файла (модуль 03).

## name и container_name

```yaml
name: docker-compose-microservices
```

`name:` — имя проекта: префикс сетей, томов и контейнеров (`docker-compose-microservices-database-1`). Без него — имя каталога.

**Убрано:** `container_name` у всех 9 сервисов. Имена контейнеров глобальны на хосте: второй экземпляр проекта (соседний клон, другая ветка) падал с `Conflict. The container name "/database" is already in use`. Сервисы находят друг друга по **имени сервиса**, имя контейнера для этого не нужно.

## version: устарело

`version: "3.8"` в начале файла Compose v2 игнорирует и пишет `the attribute version is obsolete`. Из `docker-compose.yml` поле убрано. В `docker-stack.yml` оставлено — `docker stack deploy` работает со старым форматом v3 (модуль 06).

## Порты

```yaml
session-service:
  ports:
    - "8081:8081"
gateway-service:
  ports:
    - "8087:8087"
```

Остальные сервисы, PostgreSQL и RabbitMQ доступны только внутри сети. `"8081:8081"` слушает **на всех интерфейсах** хоста; только для локального доступа — `"127.0.0.1:8081:8081"`.

## Команды

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f booking-service
docker compose config            # итоговый YAML: якоря раскрыты, переменные подставлены
docker compose down
```

> `docker compose config` выводит значения переменных, включая JWT-ключи из `.env`. Не вставляй этот вывод в issue или чат.

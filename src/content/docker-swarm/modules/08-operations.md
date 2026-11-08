## JVM в контейнере с лимитом памяти

7 Spring Boot сервисов на ВМ с 3–4 GB. Без настроек каждая JVM берёт себе кучу по умолчанию — **1/4 памяти**, которую она видит. Старые JVM видели память **хоста**, а не лимит контейнера, и контейнер убивался по OOM.

```yaml
environment:
  JAVA_TOOL_OPTIONS: "-Xmx192m -XX:+UseSerialGC"
deploy:
  resources:
    limits:
      memory: 512M
    reservations:
      memory: 384M
```

| Параметр | Зачем |
|---|---|
| `JAVA_TOOL_OPTIONS` | JVM читает эту переменную сама — не нужно менять `ENTRYPOINT` образа |
| `-Xmx192m` | потолок кучи |
| `-XX:+UseSerialGC` | однопоточный сборщик мусора: меньше накладных расходов памяти и потоков на маленьких сервисах |
| limit 512M | потолок всего процесса: куча + metaspace + стеки потоков + буферы |

> Память JVM ≠ куча. Metaspace, стеки потоков (~1 MB на поток), JIT, direct-буферы — сверху. Поэтому `-Xmx192m` при лимите 512M: запас ~2.5×. `-Xmx512m` при лимите 512M гарантирует OOM kill.

Современный способ — проценты от лимита контейнера: `-XX:MaxRAMPercentage=60`. Работает в Java 10+ и в Java 8 начиная с **8u191**; в проекте JRE 8u504 — поддерживается.

### Запас по нодам

| Нода | RAM | Резерв под сервисы |
|---|---|---|
| manager01 | 4 GB | база, nginx + Java-сервисы |
| worker01, worker02 | по 3 GB | Java-сервисы |

7 × 384M = **2.7 GB** гарантированных резервов на весь кластер из 10 GB. Без `reservations` планировщик мог бы поставить все сервисы на одну ноду.

## Тесты: Postman и newman

Коллекция `tests/application-tests.postman_collection.json` — 5 запросов, каждый с проверкой (assertion):

| Запрос | Сервис | Ожидание |
|---|---|---|
| `GET :8081/api/v1/auth/authorize` | session | 200, получен токен |
| `GET :8087/api/v1/gateway/hotels` | gateway → hotel | 200 |
| `GET :8087/api/v1/gateway/hotels/{id}` | gateway → hotel | 200 |
| `POST :8087/api/v1/gateway/booking` | gateway → booking → hotel, payment, loyalty, RabbitMQ | 201 |
| `GET :8087/api/v1/gateway/loyalty` | gateway → loyalty | 200 |

```bash
npx newman run tests/application-tests.postman_collection.json
```

**newman** — консольный запуск коллекций Postman: для CI и автоматической проверки стенда. Результат проекта: 5 запросов, 5 проверок, 0 ошибок.

Для Swarm — тот же набор с хостом `192.168.56.10`. Удобнее задать хост переменной коллекции и подставлять при запуске:

```bash
npx newman run tests/application-tests.postman_collection.json --env-var host=192.168.56.10
```

(если в коллекции адрес записан как `{{host}}`).

### Проверка всей цепочки, а не только HTTP 201

```bash
docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers
# booking_queue  0  1
docker compose exec database psql -U postgres -d statistics_db -tAc "select count(*) from booking_statistics"
# 61
```

- `booking_queue 0 1` — сообщений в очереди 0 (все обработаны), потребитель 1 (report-service подключён).
- 61 строка статистики — booking → RabbitMQ → report действительно отработали.

> Тест «ответ 201» доказывает, что API принял запрос. Проверка очереди и базы доказывает, что асинхронная часть системы тоже работает.

## Диагностика в Swarm

В `docker stack ps` проекта были задачи `Failed` (`non-zero exit (1)`) и `Rejected` (`failed to prepare extraction` у rabbitmq на worker01). Swarm их перезапустил, итог — `1/1` у всех сервисов. Причины тогда не разбирались. Как их искать:

```bash
docker stack ps myapp --no-trunc                    # полный текст ошибки
docker service ps myapp_rabbitmq --no-trunc         # история задач одного сервиса
docker service logs myapp_booking-service --tail 100
docker inspect <task-id> --format '{{json .Status}}'
docker node ls                                      # нода не Down?
docker system df                                    # место на диске ноды
```

| Состояние задачи | Где искать |
|---|---|
| `Failed … non-zero exit (1)` | логи сервиса: приложение упало (часто — нет базы при старте, модуль 03) |
| `Rejected` | ошибка на ноде **до** старта: не скачался или не распаковался образ, нет места, нет доступа к registry |
| `Pending` | планировщику некуда поставить задачу: не хватает `reservations` или нет ноды под `constraints` |
| `Shutdown` | задача остановлена штатно (обновление, масштабирование) |

`failed to prepare extraction` — ошибка распаковки слоёв образа на ноде: частые причины — нехватка места на диске ВМ или прерванная загрузка. Проверка: `df -h` и `docker system df` на worker01, затем `docker pull` образа вручную.

## Portainer

Веб-интерфейс для Docker и Swarm: сервисы, задачи, логи, тома, переменные. В проекте развёрнут сервисом на менеджере; **Cluster Visualizer** показывает, какие задачи на какой ноде.

> Portainer требует доступа к `docker.sock` менеджера — это полный контроль над кластером. Доступ к его веб-интерфейсу защищают паролем и не публикуют в интернет.

## Что ещё не проверено в проекте

README честно фиксирует: стек в Swarm после ревью заново не поднимался — новые образы, ключи JWT и версии PostgreSQL / RabbitMQ проверены только в Compose. Перед демонстрацией нужно пересобрать образы на Docker Hub и прогнать newman против `192.168.56.10`.

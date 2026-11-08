## Один Dockerfile на 7 сервисов

Было 7 одинаковых Dockerfile и 7 копий `wait-for-it.sh`. Стало — один файл, сервис выбирается аргументом сборки:

```dockerfile
# syntax=docker/dockerfile:1

FROM maven:3.9.16-eclipse-temurin-8 AS builder
ARG SERVICE
WORKDIR /app
COPY services/${SERVICE}/pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -B dependency:go-offline
COPY services/${SERVICE}/src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B clean package -DskipTests

FROM eclipse-temurin:8u504-b01-jre-noble
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
COPY --chmod=0755 docker/wait-for-it.sh wait-for-it.sh
USER app
ENTRYPOINT ["./wait-for-it.sh", "database:5432", "--", "java", "-jar", "app.jar"]
```

```bash
docker build -f docker/Dockerfile.java-service --build-arg SERVICE=session-service -t session-service .
```

| Элемент | Значение |
|---|---|
| `ARG SERVICE` | переменная **сборки**; в контейнере её нет (в отличие от `ENV`) |
| `${SERVICE}` в `COPY` | выбирает каталог сервиса |
| `ARG` **после** `FROM` | `ARG` действует только в стадии, где объявлен; объявленный до первого `FROM` доступен лишь в строках `FROM` |
| `-f` + контекст `.` | Dockerfile в `docker/`, а контекст — корень репозитория |

## Кеш зависимостей Maven

### Порядок COPY

```dockerfile
COPY services/${SERVICE}/pom.xml .
RUN mvn -B dependency:go-offline          # скачать зависимости
COPY services/${SERVICE}/src ./src         # код — отдельно и позже
RUN mvn -B clean package -DskipTests
```

Изменился только код → слой `dependency:go-offline` берётся из кеша, зависимости не скачиваются. Скопировать всё сразу — любая правка в коде заново качает сотни мегабайт.

### Cache mount

```dockerfile
RUN --mount=type=cache,target=/root/.m2 mvn -B …
```

Каталог `/root/.m2` хранится в кеше BuildKit **между сборками** и не попадает в слой образа. Даже если изменился `pom.xml`, Maven докачивает только новые зависимости, а не всё заново. Так же работают `/root/.cache/pip`, `/root/.npm`, `/var/cache/apt`.

| Флаг Maven | Значение |
|---|---|
| `-B` | batch mode: без цветного вывода и интерактивности — для CI и логов |
| `dependency:go-offline` | скачать все зависимости и плагины заранее |
| `-DskipTests` | не запускать тесты при сборке образа |

> `-DskipTests` в Dockerfile — нормальная практика: тесты гоняют отдельной стадией CI. Но если CI их не запускает, они не запускаются нигде.

## JDK и JRE

| Стадия | Образ | Внутри |
|---|---|---|
| builder | `maven:3.9.16-eclipse-temurin-8` | Maven + **JDK** (компилятор `javac`) |
| runtime | `eclipse-temurin:8u504-b01-jre-noble` | только **JRE** (запуск `java`) |

В финальном образе нет ни Maven, ни JDK, ни исходников — только `app.jar`.

Результат после всех улучшений (сжатый размер, `docker image inspect`):

| Сервис | До | После |
|---|---|---|
| booking-service | 153.8 MB | 138.2 MB (−10%) |
| gateway-service | 123.0 MB | 107.4 MB (−13%) |

> Docker Desktop 29 с containerd image store в `docker images` показывает **распакованный** размер (375–441 MB). Сравнивать «до» и «после» нужно одним способом.

## Пользователь и права

```dockerfile
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
COPY --chmod=0755 docker/wait-for-it.sh wait-for-it.sh
USER app
```

- Фиксированный **UID 10001** — понятный владелец файлов на томах и в политиках безопасности (Kubernetes `runAsUser`). Высокий UID не пересекается с пользователями хоста.
- `COPY --chmod` — права сразу при копировании, без отдельного `RUN chmod` (лишний слой). Нужен BuildKit (`# syntax=docker/dockerfile:1`).

Проверка: `docker compose exec session-service id` → `uid=10001(app) gid=999(app)`.

## Теги базовых образов

| Было | Стало |
|---|---|
| `eclipse-temurin:8-jre` | `eclipse-temurin:8u504-b01-jre-noble` |

Тег с точной сборкой JRE и версией Ubuntu (`noble` = 24.04): пересборка через месяц даст тот же образ.

## .dockerignore для монорепозитория

```
*
!docker/wait-for-it.sh
!services/*/pom.xml
!services/*/src/
services/*/target/
```

Белый список: в контекст попадают только файлы, которые читает Dockerfile. Исключены `.env` с ключами, `.vagrant/`, скриншоты, локальные `target/`.

## Найденная проблема: AUX и Windows

Java-пакет назывался `Communication/Aux`. В Windows `AUX` (как `CON`, `NUL`, `PRN`, `COM1`) — **зарезервированное имя устройства**: файлы с таким каталогом не создавались при `git clone`, проект не собирался. Пакет переименован в `Communication/Auxiliary`.

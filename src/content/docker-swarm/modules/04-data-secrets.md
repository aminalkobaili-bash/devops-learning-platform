## Инициализация баз: init.sql

```yaml
database:
  volumes:
    - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
```

```sql
\c postgres;
DROP DATABASE IF EXISTS users_db;
CREATE DATABASE users_db OWNER postgres;
… (hotels_db, reservations_db, payments_db, balances_db, statistics_db)
```

Официальный образ `postgres` при первом запуске выполняет файлы из `/docker-entrypoint-initdb.d/` (`*.sql`, `*.sql.gz`, `*.sh`) в алфавитном порядке.

> Скрипты выполняются **только если каталог данных пуст** — при самом первом запуске. Изменил `init.sql` — на существующих данных изменения не применятся. Нужно пересоздать данные или применить SQL вручную.

Шесть баз в одном сервере — по базе на сервис (паттерн **database per service**): сервисы не лезут в таблицы друг друга, схема каждого меняется независимо. В продакшене это часто ещё и разные серверы.

## Где живут данные

В проекте у `database` нет тома для данных — только `init.sql`. Образ `postgres` объявляет `VOLUME`, и Docker создаёт **анонимный** том:

| Действие | Что с данными |
|---|---|
| `docker compose restart` | сохраняются (тот же контейнер) |
| `docker compose up` после изменения конфигурации | Compose переносит анонимный том в новый контейнер |
| `docker compose down` → `up` | **новый пустой** том: данные потеряны, `init.sql` выполнится заново |
| в Swarm задача пересоздана | новый контейнер — новый пустой том |

Для учебного стенда это даже удобно (чистая база при каждом запуске), но для данных, которые нужно сохранить, нужен **именованный том**:

```yaml
services:
  database:
    volumes:
      - pgdata:/var/lib/postgresql
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro

volumes:
  pgdata:
```

> **PostgreSQL 18 сменил путь.** До 17-й версии монтировали `/var/lib/postgresql/data`. В образе 18+ `VOLUME` — `/var/lib/postgresql`, а `PGDATA` — `/var/lib/postgresql/18/docker`. Старый путь с образом 18 приводит к тому, что данные пишутся мимо тома.

В Swarm том локален для ноды. Поэтому база закреплена на менеджере (`placement: node.role == manager`) — иначе после переезда задачи на другую ноду том оказался бы пустым.

## JWT-ключи вместо хардкода

Было: RSA-ключи JWT открытым текстом в `application.properties` шести сервисов — в репозитории и внутри собранных jar.

Стало: `${JWT_PRIVATE_KEY}` / `${JWT_PUBLIC_KEY}` из окружения, новая пара ключей в `.env` (в `.gitignore`).

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt.pem
echo "JWT_PRIVATE_KEY=$(openssl pkcs8 -topk8 -nocrypt -in jwt.pem -outform DER | base64 -w0)" > .env
echo "JWT_PUBLIC_KEY=$(openssl pkey -in jwt.pem -pubout -outform DER | base64 -w0)" >> .env
rm jwt.pem
```

| Команда | Что получается |
|---|---|
| `genpkey -algorithm RSA … 2048` | закрытый ключ RSA-2048 в PEM |
| `pkcs8 -topk8 -nocrypt -outform DER` | закрытый ключ в формате **PKCS#8**, двоичный DER, без пароля |
| `pkey -pubout -outform DER` | открытый ключ (X.509 SubjectPublicKeyInfo) в DER |
| `base64 -w0` | в одну строку — чтобы поместился в переменную окружения |

Java читает эти форматы стандартными `PKCS8EncodedKeySpec` и `X509EncodedKeySpec`.

**Асимметрия:** session-service **подписывает** токены закрытым ключом, остальным сервисам для **проверки** хватило бы открытого. В проекте обе переменные передаются всем сервисам — закрытый ключ лишний там, где только проверяют.

## Найденное в репозитории при ревью

| Что | Риск |
|---|---|
| `.vagrant/…/private_key` трёх ВМ | вход по SSH на ВМ |
| `worker_token` | любой с доступом к порту 2377 мог присоединиться к кластеру |
| RSA-ключи JWT в 6 `application.properties` | подделка токенов любого пользователя |

Всё удалено, история сжата в один коммит, ключи JWT перевыпущены.

> **Образы на Docker Hub собраны до чистки:** в `aminblack/*:latest` внутри jar остался старый RSA-ключ (README). Образ — такой же артефакт, как репозиторий: секрет, попавший в слой, достаётся через `docker save` + распаковку. Образы нужно пересобрать и перезалить, а старые теги удалить.

## Переменные окружения и Docker secrets

Переменные окружения видны слишком многим:

```bash
docker inspect <контейнер>          # раздел Env
docker service inspect myapp_session-service   # в Swarm — тоже
cat /proc/1/environ                  # изнутри контейнера
```

**Docker secrets** (только Swarm): секрет хранится зашифрованным в Raft-журнале менеджеров и монтируется в контейнер **файлом** в tmpfs `/run/secrets/<имя>`:

```bash
docker secret create jwt_private_key ./jwt_private_key.b64
```

```yaml
services:
  session-service:
    secrets:
      - jwt_private_key
secrets:
  jwt_private_key:
    external: true
```

Приложение читает файл `/run/secrets/jwt_private_key`. Для Spring Boot — через `spring.config.import=configtree:/run/secrets/` (Spring Boot 2.4+): имя файла становится именем свойства.

Учебные пароли `postgres/postgres` и `guest/guest` видны прямо в compose — README честно помечает их как учебные; для реального окружения — в `.env` или secrets.

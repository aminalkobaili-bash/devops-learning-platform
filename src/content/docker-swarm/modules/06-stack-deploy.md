## Compose-файл для Swarm

`swarm/docker-stack.yml` похож на `docker-compose.yml`, но отличается в главном:

| | `docker-compose.yml` | `docker-stack.yml` |
|---|---|---|
| Образы | `build:` — собираются локально | только `image:` — Swarm не собирает, ноды **скачивают** из registry |
| Сеть | `bridge` (одна машина) | `overlay` (между нодами) |
| `depends_on` | работает | **игнорируется** |
| `deploy:` | игнорируется | реплики, размещение, ресурсы, обновления |
| `.env` | читается автоматически | **не читается** |
| `version:` | устарело | оставлено: `stack deploy` использует формат v3 |
| `container_name`, `restart` | работают | не поддерживаются (вместо `restart` — `deploy.restart_policy`) |

## Образы через registry

```bash
docker build -f docker/Dockerfile.java-service --build-arg SERVICE=session-service \
  -t aminblack/session-service:latest .
docker push aminblack/session-service:latest
```

Каждая нода скачивает образ сама — поэтому он должен быть в registry (Docker Hub, GitLab Registry, свой `registry:2`), доступном со всех нод.

### :latest в Swarm

`docker stack deploy` при развёртывании превращает тег в **digest** (`@sha256:…`) и фиксирует его в сервисе. Запушил новый `:latest` — уже работающие сервисы его не подхватят, пока не выполнить `docker stack deploy` повторно (или `docker service update --image`). А разные ноды в разное время могут получить разные «latest».

Для воспроизводимости — **версионные теги**: `session-service:1.4.2` или тег по коммиту `session-service:${CI_COMMIT_SHORT_SHA}`. Откат — деплой предыдущего тега.

## Переменные окружения

```bash
cd /vagrant
set -a; . ./.env; set +a
docker stack deploy -c swarm/docker-stack.yml myapp
```

`stack deploy` сам `.env` не читает, но подставляет `${JWT_PRIVATE_KEY:?…}` из окружения **shell**. `set -a` — все переменные, заданные дальше, автоматически экспортируются; `.` (`source`) читает файл; `set +a` выключает режим.

## deploy: размещение и ресурсы

```yaml
database:
  deploy:
    placement:
      constraints: [node.role == manager]

session-service:
  deploy:
    resources:
      limits:
        memory: 512M
      reservations:
        memory: 384M
```

| Ключ | Значение |
|---|---|
| `placement.constraints` | на каких нодах можно запускать: `node.role`, `node.hostname`, `node.labels.zone` |
| `resources.reservations` | сколько ресурсов **гарантировать**: планировщик не поставит задачу на ноду, где свободно меньше |
| `resources.limits` | **потолок**: при превышении памяти контейнер убивается (OOM) |
| `replicas` | число реплик (по умолчанию 1) |
| `restart_policy` | `condition: on-failure`, `delay`, `max_attempts` |
| `update_config` | как обновлять: `parallelism`, `order: start-first` (без простоя) |

Почему база и nginx на менеджере: им нужны файлы `/vagrant/db/init.sql` и `/vagrant/nginx/nginx.conf` по bind-монтированию (путь хоста ноды), и том базы — локальный (модуль 04). С `node.role == manager` задача всегда на `manager01`.

> На всех трёх ВМ есть `/vagrant` (общая папка Vagrant), так что bind-монтирование сработало бы на любой. В реальном кластере такой общей папки нет — конфиги передают через **`docker config`**, а данные — через тома с драйвером сетевого хранилища.

## Overlay-сеть и routing mesh

```yaml
networks:
  app-network:
    driver: overlay
```

- **Overlay** — виртуальная сеть поверх нод (VXLAN, порт 4789): контейнеры на разных ВМ общаются, как в одной сети.
- **DNS сервисов**: имя `hotel-service` резолвится в **виртуальный IP (VIP)** сервиса; запросы балансируются между репликами.
- **Routing mesh (ingress)**: опубликованный порт (`8087`) открыт **на каждой ноде** кластера. Запрос на `192.168.56.11:8087` придёт на worker01, а ingress-сеть доставит его к nginx на manager01.

В стеке порты публикует **только nginx** — Java-сервисы, база и RabbitMQ доступны лишь внутри overlay-сети.

## Команды

```bash
docker stack deploy -c swarm/docker-stack.yml myapp   # создать или обновить стек
docker stack ls
docker stack services myapp            # сервисы и реплики: 1/1
docker stack ps myapp                  # задачи: на какой ноде, состояние, ошибки
docker service logs -f myapp_booking-service
docker service scale myapp_hotel-service=2
docker service update --image aminblack/hotel-service:1.1 myapp_hotel-service
docker service rollback myapp_hotel-service
docker stack rm myapp
docker stack config -c swarm/docker-stack.yml   # итоговая конфигурация, проверка синтаксиса
```

Имена сервисов в стеке получают префикс: `myapp_booking-service`. Внутри сети работают и короткие имена (`booking-service`).

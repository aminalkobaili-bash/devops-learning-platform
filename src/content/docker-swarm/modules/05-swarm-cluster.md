## Docker Swarm

Встроенный в Docker оркестратор: несколько машин объединяются в кластер, а ты описываешь **желаемое состояние** («2 реплики сервиса»), и Swarm его поддерживает — распределяет контейнеры по нодам, перезапускает упавшие, переносит задачи с отказавшей ноды.

| Термин | Что это |
|---|---|
| **node** | машина в кластере |
| **manager** | управляет кластером: хранит состояние, планирует задачи; может и сам выполнять задачи |
| **worker** | только выполняет задачи |
| **service** | описание: образ, число реплик, сеть, ограничения |
| **task** | одна реплика сервиса = один контейнер на конкретной ноде |
| **stack** | набор сервисов из одного файла (аналог проекта Compose) |

## Raft и кворум менеджеров

Менеджеры хранят состояние кластера в журнале **Raft** и принимают решения **большинством**.

| Менеджеров | Переживёт отказ | Кворум |
|---|---|---|
| 1 | 0 | 1 |
| 3 | 1 | 2 |
| 5 | 2 | 3 |

- Число менеджеров — **нечётное**: 4 менеджера переживают тот же 1 отказ, что и 3.
- В проекте 1 manager + 2 worker. Упал `manager01` — работающие контейнеры продолжат работать, но управлять кластером (деплой, перезапуск, перенос задач) некому. Для отказоустойчивости — 3 менеджера.

## Кластер на Vagrant

```ruby
Vagrant.configure("2") do |config|
  config.vm.box = "ubuntu/jammy64"
  config.vm.synced_folder "..", "/vagrant"

  config.vm.define "manager01" do |manager|
    manager.vm.hostname = "manager01"
    manager.vm.network "private_network", ip: "192.168.56.10"
    manager.vm.provider "virtualbox" do |vb|
      vb.memory = "4096"
      vb.cpus = 2
    end
    manager.vm.provision "shell", path: "scripts/install-docker.sh"
    manager.vm.provision "shell", path: "scripts/init-manager.sh"
  end
  # worker01 — 192.168.56.11, worker02 — 192.168.56.12, по 3 GB
end
```

| Элемент | Значение |
|---|---|
| `box` | базовый образ ВМ (Ubuntu 22.04) |
| `synced_folder "..", "/vagrant"` | корень репозитория виден внутри ВМ как `/vagrant` |
| `private_network` | отдельная сеть хост ↔ ВМ ↔ ВМ, 192.168.56.0/24 |
| `provision "shell"` | скрипты, которые выполняются при первом `vagrant up` |

```bash
vagrant up                 # создать и запустить все ВМ
vagrant ssh manager01
vagrant provision worker01 # повторить провижининг
vagrant destroy -f
```

## Провижининг

### Docker на каждой ВМ

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker vagrant
```

`get.docker.com` — официальный скрипт установки, удобен для стендов. В продакшене ставят из репозитория Docker с фиксированной версией (через Ansible и т.п.).

> Группа `docker` = фактически root: через `docker run -v /:/host` можно читать и менять любой файл хоста.

### Инициализация менеджера

```bash
sudo docker swarm init --advertise-addr 192.168.56.10
sudo docker swarm join-token worker -q > /vagrant/worker_token
```

`join-token` — секрет: кто его знает и видит порт 2377 менеджера, может добавить в кластер свою машину и получать на неё задачи (вместе с их переменными окружения). Поэтому `worker_token` теперь в `.gitignore`. Скомпрометирован — `docker swarm join-token --rotate worker`.

### Подключение воркеров

```bash
while [ ! -f /vagrant/worker_token ]; do
  sleep 2
done
TOKEN=$(cat /vagrant/worker_token)

sudo docker swarm leave --force 2>/dev/null
sudo docker swarm join --token $TOKEN --advertise-addr $NODE_IP 192.168.56.10:2377
```

Обмен токеном — через общую папку `/vagrant`: менеджер пишет файл, воркер ждёт его появления.

> Если `worker_token` остался от прошлого запуска кластера, воркер прочитает **старый** токен и не подключится. Перед новым `vagrant up` файл нужно удалить.

## advertise-addr: главная ловушка

У каждой ВМ VirtualBox два интерфейса:

| Интерфейс | Адрес | Особенность |
|---|---|---|
| NAT (`enp0s3`) | `10.0.2.15` | **одинаковый на всех ВМ** |
| private network (`enp0s8`) | `192.168.56.x` | уникальный |

Без `--advertise-addr` Docker берёт адрес первого интерфейса — `10.0.2.15`. Все ноды объявляют один и тот же адрес, overlay-трафик уходит «сам в себя», сервисы на разных нодах друг друга не видят. Отсюда `--advertise-addr $NODE_IP` у каждой ноды.

## Порты Swarm

| Порт | Протокол | Зачем |
|---|---|---|
| 2377 | TCP | управление кластером (только к менеджерам) |
| 7946 | TCP + UDP | обмен информацией между нодами (gossip) |
| 4789 | UDP | трафик overlay-сетей (VXLAN) |

Закрыт фаерволом любой из них — кластер собирается частично или overlay-сеть не работает.

## Проверка кластера

```bash
docker node ls
```

```
ID          HOSTNAME    STATUS  AVAILABILITY  MANAGER STATUS
abc… *      manager01   Ready   Active        Leader
def…        worker01    Ready   Active
ghi…        worker02    Ready   Active
```

| Команда | Что делает |
|---|---|
| `docker node inspect worker01 --pretty` | адрес, ресурсы, метки |
| `docker node update --availability drain worker01` | увести все задачи с ноды (обслуживание) |
| `docker node update --label-add zone=a worker01` | метка для `placement` |
| `docker node promote worker01` | сделать менеджером |

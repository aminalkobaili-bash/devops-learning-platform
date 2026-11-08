## Исходное состояние

После установки интерфейс `enp0s3` получил адрес по DHCP от VirtualBox NAT: `10.0.2.15/24`, в `ip a` с пометкой `dynamic`. Для сервера адрес должен быть постоянным.

## Посмотреть сеть: iproute2

| Команда | Что показывает |
|---|---|
| `ip a` (`ip addr`) | интерфейсы и их адреса |
| `ip -4 addr show enp0s3` | только IPv4 одного интерфейса |
| `ip route` | таблица маршрутизации |
| `resolvectl status` | какие DNS-серверы используются |

```
default via 10.0.2.2 dev enp0s3 proto dhcp
10.0.2.0/24 dev enp0s3 proto kernel scope link src 10.0.2.15
```

- `default via 10.0.2.2` — шлюз: туда уходит всё, для чего нет более точного маршрута.
- `10.0.2.0/24` — своя подсеть, доступна напрямую.

> `ifconfig`, `route`, `netstat` — из устаревшего пакета `net-tools`. В современных системах — `ip` и `ss`.

### Имя интерфейса enp0s3

Предсказуемые имена systemd: `en` — Ethernet, `p0` — шина PCI 0, `s3` — слот 3. Имя не меняется при добавлении других сетевых карт, в отличие от старых `eth0`, `eth1`.

## Netplan

В Ubuntu сеть описывается YAML-файлами в `/etc/netplan/`. Netplan генерирует из них конфигурацию для бэкенда — `systemd-networkd` на сервере, NetworkManager на десктопе.

```yaml
# /etc/netplan/00-installer-config.yaml
network:
  ethernets:
    enp0s3:
      dhcp4: false
      addresses:
        - 10.0.2.50/24
      gateway4: 10.0.2.2
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
  version: 2
```

| Ключ | Значение |
|---|---|
| `dhcp4: false` | не получать адрес по DHCP |
| `addresses` | статический адрес с маской в нотации CIDR |
| `gateway4` | шлюз по умолчанию |
| `nameservers.addresses` | DNS-серверы |

> `gateway4` устарел в новых версиях Netplan (Ubuntu 22.04+ выдаёт предупреждение). Современная запись:
> ```yaml
> routes:
>   - to: default
>     via: 10.0.2.2
> ```

### Применение

| Команда | Что делает |
|---|---|
| `sudo netplan try` | применяет и **откатывает через 120 с**, если не подтвердить Enter |
| `sudo netplan apply` | применяет сразу |
| `sudo netplan generate` | только проверяет и генерирует конфиг бэкенда |

> На удалённом сервере всегда `netplan try`: ошибка в адресе или шлюзе отрежет SSH, и вернуть доступ можно будет только через консоль.

- YAML чувствителен к отступам: только пробелы, табуляция — ошибка.
- Адрес в `addresses` должен быть **вне** диапазона DHCP-сервера, иначе возможен конфликт адресов.

## Проверка

```bash
ip -4 addr show enp0s3   # inet 10.0.2.50/24, без пометки dynamic
ip route                 # default via 10.0.2.2
ping -c 4 1.1.1.1        # связь с интернетом по IP
ping -c 4 ya.ru          # работает DNS
```

Если `ping 1.1.1.1` проходит, а `ping ya.ru` — нет, проблема в DNS, а не в маршрутизации.

## Hostname и часовой пояс

```bash
sudo hostnamectl set-hostname user-1
sudo timedatectl set-timezone Europe/Moscow
```

`hostnamectl` записывает имя в `/etc/hostname`. Для корректного `sudo` без задержек имя стоит добавить и в `/etc/hosts` (`127.0.1.1 user-1`).

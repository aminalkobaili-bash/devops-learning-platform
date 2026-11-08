## DHCP

Dynamic Host Configuration Protocol раздаёт хостам сетевые настройки: IP и маску, шлюз, DNS. Работает по UDP: сервер — порт **67**, клиент — **68**.

## DORA — четыре шага

| Шаг | Кто → кому | Смысл |
|---|---|---|
| **D**ISCOVER | клиент → broadcast | «Есть DHCP-сервер?» — у клиента ещё нет адреса, источник `0.0.0.0` |
| **O**FFER | сервер → клиент | «Могу дать 10.20.0.3» |
| **R**EQUEST | клиент → broadcast | «Беру 10.20.0.3 у этого сервера» — broadcast, чтобы другие серверы узнали отказ |
| **A**CK | сервер → клиент | «Подтверждаю, аренда на N секунд» |

```bash
sudo dhclient -v enp0s3
# DHCPDISCOVER on enp0s3 to 255.255.255.255 port 67
# DHCPOFFER of 10.20.0.3 from 10.20.0.1
# DHCPREQUEST for 10.20.0.3 on enp0s3 to 255.255.255.255 port 67
# DHCPACK of 10.20.0.3 from 10.20.0.1
# bound to 10.20.0.3 -- renewal in … seconds.
```

> DHCP работает через broadcast, а broadcast **не проходит через роутер**. Поэтому DHCP-сервер стоит в каждом сегменте: r1 — для `10.10.0.0/18`, r2 — для `10.20.0.0/26`. Альтернатива — DHCP relay на роутере.

## Аренда

Адрес выдаётся на время (lease). На половине срока клиент продлевает его у того же сервера. Не продлил к концу — адрес освобождается.

| Команда клиента | Что делает |
|---|---|
| `sudo dhclient -v enp0s3` | получить адрес с подробным выводом |
| `sudo dhclient -r enp0s3` | освободить (RELEASE) |
| `ip a` | адрес с пометкой `dynamic` и временем `valid_lft` |

### Случай из проекта: два адреса

ws21 уже получила `10.20.0.2` через Netplan (systemd-networkd), затем ручной `dhclient -v` взял ещё `10.20.0.3`. В `ip a` второй стал `secondary`: на интерфейсе одновременно работали два DHCP-клиента. `dhclient -r` + `dhclient` оставили один адрес.

> На сервере с Netplan адрес обслуживает `systemd-networkd`. `dhclient` — для ручной отладки, после неё аренду лучше отпустить.

## Сервер: isc-dhcp-server

```bash
sudo apt install isc-dhcp-server
```

Два файла:

```bash
# /etc/default/isc-dhcp-server — на каких интерфейсах слушать
INTERFACESv4="enp0s8"
```

```
# /etc/dhcp/dhcpd.conf (r2)
subnet 10.100.0.0 netmask 255.255.0.0 {
}

subnet 10.20.0.0 netmask 255.255.255.192 {
    range 10.20.0.2 10.20.0.50;
    option routers 10.20.0.1;
    option domain-name-servers 10.20.0.1;
}
```

| Параметр | Значение |
|---|---|
| `subnet … netmask …` | сеть, которую обслуживает сервер; маска — в десятичной записи |
| `range` | пул выдаваемых адресов |
| `option routers` | шлюз для клиентов |
| `option domain-name-servers` | DNS для клиентов |
| пустой `subnet {}` | сеть, известная серверу, но без выдачи — иначе dhcpd ругается на интерфейс без объявления |

```bash
sudo systemctl restart isc-dhcp-server
systemctl status isc-dhcp-server
journalctl -u isc-dhcp-server        # DISCOVER / OFFER / REQUEST / ACK по каждому клиенту
```

> Статические адреса (сам роутер `10.20.0.1`, ws22 `10.20.0.20`) не должны пересекаться с выдаваемым пулом. В проекте `range 10.20.0.2–10.20.0.50` включает `10.20.0.20` ws22 — сервер выдаст его, если ws22 будет выключена, и получится конфликт. Сервер делает ping-проверку перед выдачей, но надёжнее сузить пул или поставить ws22 вне диапазона.

### Найденная ошибка: DNS, которого нет

`option domain-name-servers 10.20.0.1` — клиенты получают в качестве DNS адрес r2, но DNS-сервер на r2 не запущен. Для лабораторной это незаметно: проверки шли по IP. В рабочей сети здесь реальный резолвер (`8.8.8.8`) или локальный `dnsmasq` / `unbound`.

## Резервирование по MAC

Фиксированный адрес для конкретного устройства:

```
# /etc/dhcp/dhcpd.conf (r1)
subnet 10.10.0.0 netmask 255.255.192.0 {
    option routers 10.10.0.1;
    option domain-name-servers 8.8.8.8;
}

host ws11 {
    hardware ethernet 10:10:10:10:10:BA;
    fixed-address 10.10.0.50;
}
```

В подсети нет `range` — адрес получит только хост из резервирования.

Клиент ws11 в Netplan подменял свой MAC:

```yaml
    enp0s3:
      dhcp4: true
      macaddress: 10:10:10:10:10:BA
```

### Незавершённый цикл в проекте

| Сторона | Что видно |
|---|---|
| r1 | `DHCPDISCOVER from 10:10:10:10:10:ba` → `DHCPOFFER on 10.10.0.50` |
| r1 | `DHCPREQUEST` и `DHCPACK` нет, DISCOVER повторяется каждые 10–60 с |
| ws11 | на `enp0s3` нет IPv4 |

Сервер работает правильно, клиент OFFER не получил или не принял.

**Гипотеза (не проверена):** MAC в Netplan отличается от MAC адаптера в VirtualBox. При `Promiscuous Mode: Deny` VirtualBox не доставляет в VM кадры, адресованные «чужому» MAC, — и OFFER на `10:10:10:10:10:BA` не доходит.

Как проверить:

1. Задать `1010101010BA` в VirtualBox: *Settings → Network → Adapter → MAC Address* (и убрать `macaddress` из Netplan) — или включить *Promiscuous Mode: Allow VMs*.
2. На обеих сторонах: `sudo tcpdump -n -e port 67 or port 68` — видно MAC-адреса и доходит ли OFFER.
3. На ws11: `sudo dhclient -v enp0s3`.

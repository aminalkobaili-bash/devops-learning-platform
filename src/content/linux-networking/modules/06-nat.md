## r2 как пограничный роутер

r2 стоит между «внешней» сетью `10.100.0.0/16` (enp0s3, сторона r1) и «внутренней» `10.20.0.0/26` (enp0s8, ws21 и ws22). Задача: закрыть транзит по умолчанию, разрешить внутренним хостам выход наружу (SNAT) и опубликовать веб-сервер ws22 на порту 8080 (DNAT).

## Путь пакета через netfilter

| Пакет | Цепочки |
|---|---|
| приходит **на** r2 | `PREROUTING` → решение о маршруте → `INPUT` |
| идёт **через** r2 | `PREROUTING` → решение о маршруте → **`FORWARD`** → `POSTROUTING` |
| создан **на** r2 | `OUTPUT` → `POSTROUTING` |

- `PREROUTING` (таблица `nat`) — **до** выбора маршрута: здесь меняют адрес назначения — **DNAT**.
- `POSTROUTING` (таблица `nat`) — **после**: здесь меняют адрес источника — **SNAT / MASQUERADE**.
- `FORWARD` (таблица `filter`) — разрешить или запретить транзит.

## Шаг 1. Default deny

```bash
iptables -P FORWARD DROP
```

Политика цепочки — что делать с пакетом, если ни одно правило не совпало. Теперь весь транзит запрещён. Проверка из проекта: `ping 10.20.0.20` с r1 — 100% loss.

## Шаг 2. ICMP

```bash
iptables -A FORWARD -p icmp -j ACCEPT
```

ping r1 → ws22 снова 0% loss, `ttl=63`: пакет прошёл один роутер.

## Шаг 3. Stateful: ESTABLISHED, RELATED

```bash
iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT
```

Модуль conntrack (connection tracking) запоминает каждое соединение.

| Состояние | Что значит |
|---|---|
| `NEW` | первый пакет нового соединения |
| `ESTABLISHED` | пакет уже разрешённого соединения — в том числе **ответы** |
| `RELATED` | связанное соединение: ICMP-ошибка о существующем соединении, data-канал FTP |

Без этого правила пришлось бы вручную разрешать ответные пакеты для каждого сервиса. С ним достаточно разрешить только **начало** соединения — ответы пройдут автоматически.

> Современная запись того же — `-m conntrack --ctstate ESTABLISHED,RELATED`. `-m state` устарел, но работает.

## Шаг 4. SNAT: выход внутренней сети наружу

```bash
iptables -A FORWARD -s 10.20.0.0/26 -j ACCEPT
iptables -t nat -A POSTROUTING -s 10.20.0.0/26 -o enp0s3 -j MASQUERADE
```

| Правило | Зачем |
|---|---|
| `FORWARD -s 10.20.0.0/26` | внутренним хостам разрешено открывать соединения наружу |
| `MASQUERADE` | при выходе через enp0s3 адрес источника заменяется на адрес r2 (`10.100.0.12`) |

Что видит r1: соединение пришло от `10.100.0.12`, а не от ws22. Ответ r1 отправит на r2, а conntrack на r2 вернёт исходный адрес `10.20.0.20` и перешлёт пакет ws22.

| | MASQUERADE | SNAT |
|---|---|---|
| Адрес источника | берётся с исходящего интерфейса автоматически | задаётся явно: `-j SNAT --to-source 10.100.0.12` |
| Когда использовать | адрес интерфейса меняется (DHCP, PPPoE) | статический адрес — чуть быстрее |

Проверка из проекта: на r1 запущен Apache, с ws22 `telnet 10.100.0.11 80` → `Connected`.

## Шаг 5. DNAT: проброс порта внутрь

```bash
iptables -t nat -A PREROUTING -p tcp --dport 8080 -j DNAT --to-destination 10.20.0.20:80
iptables -A FORWARD -p tcp -d 10.20.0.20 --dport 80 -j ACCEPT
```

| Правило | Зачем |
|---|---|
| `PREROUTING … DNAT` | пакет на любой адрес r2, порт 8080, получает новое назначение `10.20.0.20:80` |
| `FORWARD -d 10.20.0.20 --dport 80` | пропустить этот транзит через default deny |

> Правило FORWARD пишется с **новым** адресом и портом (`10.20.0.20:80`), а не `8080`: DNAT в PREROUTING уже сработал до проверки FORWARD.

Проверка из проекта: с r1 `telnet 10.100.0.12 8080` → `Connected` — ответил Apache ws22.

## Итоговый скрипт r2

```bash
#!/bin/bash
iptables -F
iptables -t nat -F

iptables -P FORWARD DROP
iptables -A FORWARD -p icmp -j ACCEPT
iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -s 10.20.0.0/26 -j ACCEPT

iptables -t nat -A POSTROUTING -s 10.20.0.0/26 -o enp0s3 -j MASQUERADE

iptables -t nat -A PREROUTING -p tcp --dport 8080 -j DNAT --to-destination 10.20.0.20:80
iptables -A FORWARD -p tcp -d 10.20.0.20 --dport 80 -j ACCEPT
```

- `iptables -F` очищает только таблицу `filter`. Таблица `nat` чистится отдельно: `-t nat -F`.
- Правило DNAT без `-i enp0s3` перехватит порт 8080 на **всех** интерфейсах r2, включая внутренний. Точнее: `-i enp0s3 -p tcp --dport 8080`.

## Проверка

```bash
sudo iptables -L FORWARD -n -v       # policy DROP и счётчики правил
sudo iptables -t nat -L -n -v        # MASQUERADE и DNAT
sudo conntrack -L                    # таблица соединений (пакет conntrack)
```

## Архитектура

```
node_exporter :9100/metrics ──┐  job "node"
                              ├──► Prometheus :9090 ──► Grafana :3000
nginx :80/metrics ────────────┘  job "custom_node"
  ↑ metrics-exporter.sh
```

| Компонент | Роль |
|---|---|
| **экспортер** | отдаёт текущие значения метрик по HTTP в текстовом формате |
| **Prometheus** | периодически опрашивает экспортеры, хранит временные ряды, выполняет запросы PromQL |
| **Grafana** | строит графики и дашборды по запросам к Prometheus |

## Pull-модель

Prometheus **сам** ходит к экспортерам (scrape) раз в `scrape_interval` и забирает `/metrics`. Экспортер ничего никуда не отправляет — просто отвечает на HTTP-запрос.

| | Pull (Prometheus) | Push (Graphite, InfluxDB) |
|---|---|---|
| Кто инициирует | сервер мониторинга | наблюдаемый хост |
| «Хост умер» | сразу видно: scrape не удался, `up == 0` | непонятно — просто данных нет |
| Короткие задачи (cron, CI) | неудобно — могут не дожить до scrape | удобно; у Prometheus для этого Pushgateway |

## Конфигурация

```yaml
# /etc/prometheus/prometheus.yml — добавлено в scrape_configs:
- job_name: "custom_node"
  static_configs:
    - targets: ["localhost:80"]
      labels:
        group: "custom"
  metrics_path: /metrics
```

| Ключ | Значение |
|---|---|
| `job_name` | имя задачи, станет меткой `job` у всех метрик |
| `targets` | адреса `host:port` для опроса |
| `labels` | дополнительные метки ко всем метрикам этих целей |
| `metrics_path` | путь, по умолчанию `/metrics` |

Job `node` для `node_exporter` на `localhost:9100` уже есть в конфиге пакета `prometheus` в Ubuntu.

```bash
promtool check config /etc/prometheus/prometheus.yml   # проверка синтаксиса
sudo systemctl restart prometheus
```

Статус опроса — `http://host:9090/targets`: `UP` / `DOWN` и текст последней ошибки.

## node_exporter

Стандартный экспортер метрик Linux-хоста: CPU, память, диски, ФС, сеть, нагрузка. Порт `9100`. Почти все данные берёт из `/proc` и `/sys`.

| Метрика | Тип | Что это |
|---|---|---|
| `node_cpu_seconds_total{mode="idle"}` | counter | секунды CPU в каждом режиме, по ядрам |
| `node_memory_MemAvailable_bytes` | gauge | доступная память |
| `node_filesystem_avail_bytes` | gauge | свободное место на ФС |
| `node_disk_reads_completed_total` | counter | число завершённых чтений с диска |
| `node_network_receive_bytes_total` | counter | принято байт по интерфейсу |
| `node_load1` | gauge | load average за 1 минуту |

## Типы метрик

| Тип | Поведение | Пример |
|---|---|---|
| **counter** | только растёт (сбрасывается при рестарте) | число запросов, байты, секунды CPU |
| **gauge** | растёт и падает | свободная память, температура, число процессов |
| histogram | распределение по корзинам | время ответа |
| summary | квантили на стороне клиента | время ответа |

Имена счётчиков по конвенции оканчиваются на `_total`.

## PromQL: rate() для счётчиков

Сырое значение счётчика — «сколько с момента запуска». На графике это почти прямая растущая линия, по которой ничего не понять. Нужна **скорость изменения**:

```promql
rate(node_disk_writes_completed_total[1m])         # записей в секунду, среднее за 1 мин
rate(node_network_receive_bytes_total[5m]) * 8     # бит/с
```

| Функция | Что считает |
|---|---|
| `rate(c[5m])` | средняя скорость в секунду за окно; корректно обрабатывает сброс счётчика |
| `irate(c[5m])` | скорость по двум последним точкам — резче, шумнее |
| `increase(c[1h])` | прирост за окно |

> `rate()` применяется **только к counter**. К gauge — `avg_over_time`, `max_over_time` или само значение.

### Загрузка CPU в процентах

```promql
100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100
```

Доля времени простоя за минуту, усреднённая по ядрам, вычтенная из 100%.

### Фильтр по меткам

```promql
node_filesystem_avail_bytes{device="/dev/sda2"}
node_filesystem_avail_bytes{mountpoint="/", fstype!="tmpfs"}
```

`=`, `!=`, `=~` (регулярка), `!~`.

## Grafana: три дашборда проекта

| Дашборд | Что это |
|---|---|
| собственный, 4 панели | CPU (`rate(node_cpu_seconds_total…)` по `mode`), RAM (`MemAvailable_bytes`), Disk I/O, Disk space |
| Node Exporter Full, ID **1860** | готовый дашборд сообщества, импорт по ID: *Dashboards → New → Import* |
| на своём экспортере, 3 панели | `custom_cpu_usage`, `custom_memory_used`, `custom_disk_free` |

### Найденный недочёт: панель Disk I/O

Панель показывала **сырой** счётчик `node_disk_reads_completed_total`, без `rate()` и только чтения. Линия просто медленно росла, и заполнение диска на ней было не видно. Правильно:

```promql
rate(node_disk_writes_completed_total[1m])
rate(node_disk_reads_completed_total[1m])
```

У панелей CPU и RAM не были заданы единицы измерения (*Standard options → Unit*): Grafana показывала голые числа вместо `%` и `bytes`.

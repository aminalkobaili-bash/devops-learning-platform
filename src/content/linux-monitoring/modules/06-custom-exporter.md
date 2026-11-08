## Идея

Экспортер для Prometheus — это просто HTTP-ответ с текстом в определённом формате. Проще всего: скрипт раз в 3 секунды пишет метрики в файл, а nginx отдаёт этот файл как статику по `/metrics`.

```
metrics-exporter.sh ─(каждые 3 с)─► /var/www/html/metrics ─► nginx :80/metrics ─► Prometheus
```

## Формат exposition

```
# HELP custom_cpu_usage CPU usage
# TYPE custom_cpu_usage gauge
custom_cpu_usage 2.4

# HELP custom_memory_used Memory used
# TYPE custom_memory_used gauge
custom_memory_used 512
```

| Строка | Значение |
|---|---|
| `# HELP имя описание` | текст подсказки |
| `# TYPE имя gauge` | тип: `counter`, `gauge`, `histogram`, `summary`, `untyped` |
| `имя значение` | сама метрика |
| `имя{label="x"} значение` | метрика с метками |

Проверить без Prometheus: `curl localhost/metrics`.

## Метрики экспортера

| Метрика | Откуда | Единица |
|---|---|---|
| `custom_cpu_usage` | `/proc/stat` | % |
| `custom_memory_used`, `custom_memory_total` | `free -m` | MB |
| `custom_disk_free` | `df /` | KB |

## Найденный баг: 100% CPU в простое

Исходная версия брала загрузку из вывода `top`:

```bash
top -bn1 | grep "Cpu(s)" | awk '{print 100 - $8}'
```

awk делит строку по пробелам. При полном простое `top` печатает `100.0 id` **без пробела** после запятой:

```
%Cpu(s):  1.6 us,  0.8 sy,  0.0 ni, 97.6 id, …   →  $8 = "97.6"  →  CPU = 2.4   ✓
%Cpu(s):  0.0 us,  0.0 sy,  0.0 ni,100.0 id, …   →  $8 = "id,"   →  CPU = 100   ✗
```

Строка `id,` в арифметике awk — 0, и `100 − 0 = 100`. На графике в простое появлялись одиночные пики ровно 100% — а под реальной нагрузкой `stress` пик тоже 100%, то есть отличить нагрузку от бага было невозможно.

> Вывод для собеседования: **не парси вывод, предназначенный для человека** (`top`, `ls`, `ifconfig`) — его форматирование меняется от значений и версий. Бери данные из первоисточника: `/proc`, `/sys`, машинно-читаемые флаги (`--output`, `-o json`).

## Исправление: дельта /proc/stat

```
cpu  user nice system idle iowait irq softirq steal guest guest_nice
cpu  18794 0 13516 435204 120 0 85 0 0 0
```

Числа — **накопленное** время CPU в каждом режиме (в тиках, обычно 1/100 с) с момента загрузки. Загрузку за интервал считают по **разнице** двух снимков:

```bash
read_cpu() {
    awk '/^cpu / {total = $2+$3+$4+$5+$6+$7+$8+$9; idle = $5+$6; print total, idle}' /proc/stat
}

read -r PREV_TOTAL PREV_IDLE < <(read_cpu)
while true; do
    sleep 3
    read -r TOTAL IDLE < <(read_cpu)
    CPU_USAGE=$(awk -v dt=$((TOTAL - PREV_TOTAL)) -v di=$((IDLE - PREV_IDLE)) \
        'BEGIN { if (dt > 0) printf "%.1f", (dt - di) * 100 / dt; else print 0 }')
    PREV_TOTAL=$TOTAL
    PREV_IDLE=$IDLE
    …
done
```

| Часть | Зачем |
|---|---|
| `$2…$9` | user, nice, system, idle, iowait, irq, softirq, steal. `guest` уже входит в `user` — не прибавляется |
| `idle = $5 + $6` | простой = idle + iowait |
| `(Δtotal − Δidle) / Δtotal` | доля «занятого» времени за 3 секунды |
| `if (dt > 0)` | защита от деления на ноль |
| `read -r A B < <(cmd)` | прочитать два числа из вывода команды в две переменные |
| `awk 'BEGIN {…}'` | bash не умеет дробную арифметику — считаем в awk |

Проверка исправленной версии (Ubuntu в WSL, 22 ядра): в простое `custom_cpu_usage 0.1`, под нагрузкой `yes` на все ядра — `100.0`.

> Это тот же расчёт, что делает Prometheus для `node_cpu_seconds_total` через `rate()`: счётчик + производная, а не мгновенное значение.

## Недочёты экспортера

### Неатомарная запись

```bash
cat << EOF > $OUTPUT
…
EOF
```

`>` сначала **обнуляет** файл, потом пишет. Если nginx отдаст файл в этот момент, Prometheus получит пустой или обрезанный ответ. Атомарно — писать во временный файл и переименовать:

```bash
cat << EOF > "$OUTPUT.tmp"
…
EOF
mv "$OUTPUT.tmp" "$OUTPUT"
```

`mv` в пределах одной ФС — атомарная операция: читатель видит либо старый файл, либо новый целиком.

### Единицы в именах

Конвенция Prometheus: базовые единицы и суффикс в имени.

| Было | По конвенции |
|---|---|
| `custom_memory_used` (MB) | `custom_memory_used_bytes` |
| `custom_disk_free` (KB) | `custom_disk_free_bytes` |
| `custom_cpu_usage` (%) | `custom_cpu_usage_ratio` (0–1) или `_percent` |

### Запуск как служба

Скрипт — бесконечный цикл в терминале: закрыл SSH — экспортер остановился, после reboot не стартует. Нужен systemd-юнит:

```ini
# /etc/systemd/system/metrics-exporter.service
[Unit]
Description=Custom Bash metrics exporter
After=network.target

[Service]
ExecStart=/usr/local/bin/metrics-exporter.sh
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now metrics-exporter
```

### Готовое решение

У node_exporter есть **textfile collector**: скрипт пишет `.prom`-файл в каталог, node_exporter подхватывает его вместе со своими метриками. Отдельный nginx и отдельный job не нужны:

```bash
node_exporter --collector.textfile.directory=/var/lib/node_exporter/textfile_collector
```

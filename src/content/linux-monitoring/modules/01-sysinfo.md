## Что делает sysinfo

Скрипт печатает сводку о сервере — hostname, часовой пояс, ОС, uptime, IP, маску, шлюз, RAM, диск — в две цветные колонки. Цвета задаются в `config.conf`, при его отсутствии берутся значения по умолчанию.

## Модули через source

```bash
# main.sh
source ./config_loader.sh
source ./validator.sh
source ./colors.sh
source ./system_info.sh

check_no_args "$@"
load_config
validate_config
init_colors
collect_system_info
print_system_info
```

| | `source file.sh` (`. file.sh`) | `./file.sh` |
|---|---|---|
| Где выполняется | в **текущей** оболочке | в новом процессе bash |
| Функции и переменные | остаются доступны | пропадают после завершения |

Поэтому `main.sh` после `source` может вызывать функции из других файлов.

> `source ./config_loader.sh` ищет файл относительно **текущего каталога**, а не каталога скрипта. Запуск из другой папки сломается. Надёжно: `source "$(dirname "$0")/config_loader.sh"`.

## Откуда берутся данные

| Что | Команда / файл |
|---|---|
| hostname | `hostname` |
| часовой пояс | `/etc/timezone` + `date +%:z` |
| ОС | `. /etc/os-release` → переменные `$NAME`, `$VERSION` |
| uptime | `uptime -p`, точно в секундах — `/proc/uptime` |
| IP | `hostname -I` |
| шлюз | `ip route \| awk '/default/ {print $3}'` |
| RAM | `/proc/meminfo` |
| диск | `df -m /` |

### /proc/meminfo

```
MemTotal:        8030244 kB
MemFree:          512000 kB
MemAvailable:    6100000 kB
```

(значения для примера)

- **Использовано** считается как `MemTotal − MemAvailable` — так в скрипте и сделано. `MemTotal − MemFree` завысил бы цифру: свободная память занята под кеш (модуль 06 проекта Linux Admin).
- Значения в **КиБ**: `/1024/1024` даёт GiB.

```bash
awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {printf "%.3f GB", (t-a)/1024/1024}' /proc/meminfo
```

### /etc/os-release

Файл из строк `KEY="value"` — валидный shell. Подключение через `.` создаёт переменные:

```bash
. /etc/os-release
echo "$NAME, $VERSION"     # Ubuntu, 20.04.6 LTS (Focal Fossa)
```

## Конфиг со значениями по умолчанию

```bash
DEFAULT_COLUMN1_BG=6

load_config() {
    if [ -f "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"
    fi
    column1_background=${column1_background:-$DEFAULT_COLUMN1_BG}
}
```

| Подстановка | Результат |
|---|---|
| `${var:-default}` | `var`, если задана и не пустая, иначе `default` (сама `var` не меняется) |
| `${var:=default}` | то же, но ещё и присваивает `default` в `var` |
| `${var:?message}` | ошибка с сообщением, если `var` пуста |

> `source` конфига выполняет его как код. Файл, который может править кто-то другой, через `source` подключать опасно — любая строка станет командой.

## Валидация

```bash
if ! [[ "$param" =~ ^[1-6]$ ]]; then
    echo "Error: Config values must be numbers from 1 to 6"
    exit 1
fi
```

- `[[ … =~ regex ]]` — проверка регулярным выражением в bash.
- `^[1-6]$` — ровно одна цифра от 1 до 6.
- Отдельная проверка: цвет шрифта и фона в одной колонке не должны совпадать — иначе текст невидим.

## ANSI-цвета

```bash
echo -e "\033[41;37mRED BG, WHITE TEXT\033[0m"
```

| Код | Значение |
|---|---|
| `\033[` | начало escape-последовательности |
| `30–37` | цвет текста: 30 чёрный, 31 красный, 32 зелёный, 34 синий, 35 фиолетовый, 37 белый |
| `40–47` | цвет фона, те же цвета |
| `0m` | сброс оформления |

`echo -e` нужен, чтобы bash интерпретировал `\033`. Переносимее — `printf '\033[41;37m%s\033[0m\n' "$text"`.

## Сохранение в файл с датой

```bash
FILENAME=$(date +"%d_%m_%y_%H_%M_%S").status
{ echo "HOSTNAME = $HOSTNAME"; … } > "$FILENAME"
```

Группа `{ …; }` перенаправляется в файл один раз — вместо `>>` после каждой строки.

## Известный недочёт

Маска берётся из `ifconfig` (пакет `net-tools`, в новых системах не установлен) и с **первого** интерфейса в выводе — часто это не тот интерфейс, где IP. Без `ifconfig`:

```bash
ip -o -f inet addr show | awk '/scope global/ {print $4}'   # 10.0.2.15/24
```

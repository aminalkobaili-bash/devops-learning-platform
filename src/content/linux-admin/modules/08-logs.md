## Где лежат логи

| Файл | Что пишется |
|---|---|
| `/var/log/syslog` | общий системный лог: службы, cron, сеть |
| `/var/log/auth.log` | аутентификация: входы, SSH, **sudo** |
| `/var/log/dmesg` | сообщения ядра при загрузке (железо, драйверы) |
| `/var/log/kern.log` | сообщения ядра во время работы |
| `/var/log/apt/history.log` | что устанавливалось и обновлялось через apt |
| `/var/log/journal/` | бинарный журнал systemd |

> На RHEL/CentOS вместо `syslog` и `auth.log` — `/var/log/messages` и `/var/log/secure`.

Читать логи без sudo могут члены группы `adm` — поэтому в модуле 02 пользователя создавали с этой группой.

## Два механизма: rsyslog и journald

| | `rsyslog` | `systemd-journald` |
|---|---|---|
| Формат | текстовые файлы в `/var/log` | бинарный журнал |
| Чем читать | `less`, `grep`, `tail` | `journalctl` |
| Метаданные | строка текста | unit, PID, приоритет, boot-id |

В Ubuntu работают оба: journald собирает сообщения и передаёт их rsyslog, который пишет текстовые файлы.

## Чтение текстовых логов

| Команда | Зачем |
|---|---|
| `less /var/log/dmesg` | листать: `/текст` — поиск, `n` — следующее совпадение, `G` — в конец, `q` — выход |
| `tail -n 50 /var/log/syslog` | последние 50 строк |
| `tail -f /var/log/syslog` | следить за новыми строками в реальном времени |
| `grep sshd /var/log/auth.log` | строки с шаблоном |
| `grep -i error /var/log/syslog` | без учёта регистра |
| `zgrep sudo /var/log/auth.log.2.gz` | поиск в сжатом архиве лога |

Пример поиска события после `systemctl restart ssh` (из проекта):

```bash
grep ssh /var/log/syslog | tail
# … systemd[1]: ssh.service: Succeeded.
```

## Формат строки syslog

Пример записи о вызове sudo (дата условная):

```
Oct 21 12:40:05 user-2 sudo:  amuser2 : TTY=pts/0 ; PWD=/home/amuser2 ; USER=root ; COMMAND=/usr/bin/hostnamectl set-hostname user-2
```

| Часть | Значение |
|---|---|
| `Oct 21 12:40:05` | время |
| `user-2` | hostname |
| `sudo` | программа-источник |
| остальное | сообщение: кто, откуда, от чьего имени, какую команду |

Точное время в логах — причина, по которой в модуле 04 включали NTP.

## journalctl

```bash
journalctl -u ssh                 # логи одной службы
journalctl -u ssh --since "1 hour ago"
journalctl -f                     # follow, как tail -f
journalctl -b                     # с текущей загрузки
journalctl -b -1                  # с предыдущей загрузки — разбор падений
journalctl -p err                 # только ошибки и серьёзнее
journalctl --disk-usage
```

## Ротация: logrotate

Логи не растут бесконечно: `logrotate` (запускается ежедневно) переименовывает текущий файл, сжимает старые и удаляет самые давние.

```
auth.log        ← текущий
auth.log.1      ← вчерашний
auth.log.2.gz   ← сжатые
auth.log.3.gz
```

Правила — `/etc/logrotate.conf` и `/etc/logrotate.d/`.

## Что искать при разборе инцидента

| Вопрос | Где смотреть |
|---|---|
| Кто заходил на сервер? | `grep "Accepted" /var/log/auth.log` |
| Попытки подбора пароля? | `grep "Failed password" /var/log/auth.log` |
| Кто что делал через sudo? | `grep sudo /var/log/auth.log` |
| Почему служба упала? | `journalctl -u имя -n 100` |
| Проблемы с железом/диском? | `dmesg`, `/var/log/kern.log` |

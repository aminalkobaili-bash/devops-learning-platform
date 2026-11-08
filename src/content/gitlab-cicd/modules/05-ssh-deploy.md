## Схема

```
VM1 (runner, пользователь gitlab-runner)          VM2 (production)
  ~/.ssh/id_ed25519  ──── scp app/DO ───────────►  /tmp/DO.<pid>
                     ──── ssh "sudo install …" ──►  /usr/local/bin/DO  (root:root 755)
```

## SSH-ключи для автоматизации

```bash
# на VM1, от gitlab-runner
sudo -u gitlab-runner ssh-keygen -t ed25519 -N "" -f /home/gitlab-runner/.ssh/id_ed25519
sudo -u gitlab-runner ssh-copy-id deploy@<VM2>
sudo -u gitlab-runner ssh-keyscan <VM2> >> /home/gitlab-runner/.ssh/known_hosts
```

| Шаг | Зачем |
|---|---|
| ключ **без пароля** (`-N ""`) | job не может ввести пароль интерактивно |
| `ed25519` | современный алгоритм: короткий ключ, быстрее и надёжнее RSA-2048 |
| ключ **пользователя `gitlab-runner`** | jobs shell executor выполняются от него |
| `ssh-copy-id` | публичный ключ → `~/.ssh/authorized_keys` на VM2 |
| `known_hosts` | отпечаток VM2 заранее — без него SSH спросит «доверять ли хосту?», и job зависнет |

> `ssh-keyscan` доверяет ответу сети в момент запуска. Строже — сверить отпечаток с выводом `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` на самой VM2.

## deploy.sh

```bash
#!/bin/bash
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST is not set}"
: "${DEPLOY_USER:?DEPLOY_USER is not set}"

SOURCE_FILE="app/DO"
DEST="/usr/local/bin/DO"
REMOTE_TMP="/tmp/DO.$$"

scp -o BatchMode=yes "${SOURCE_FILE}" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_TMP}"

ssh -o BatchMode=yes "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "sudo /usr/bin/install -o root -g root -m 755 ${REMOTE_TMP} ${DEST} && rm -f ${REMOTE_TMP} && ls -l ${DEST}"
```

| Элемент | Зачем |
|---|---|
| `: "${VAR:?msg}"` | упасть с понятной ошибкой, если переменная не задана. `:` — пустая команда, выражение нужно ради проверки |
| `/tmp/DO.$$` | `$$` — PID скрипта: уникальное имя, параллельные деплои не перезапишут файл друг друга |
| `-o BatchMode=yes` | никаких интерактивных вопросов: нет ключа или хост неизвестен — сразу ошибка, а не зависание job |
| `scp` во временный файл | бинарник в `/usr/local/bin` не перезаписывается частично |
| `install -o root -g root -m 755` | копирование + владелец + права **одной** командой |

Проверка без переменных (из README):

```
$ bash scripts/deploy.sh
scripts/deploy.sh: line 8: DEPLOY_HOST: DEPLOY_HOST is not set
```

## Найденная ошибка: права 777

Было:

```bash
ssh … "sudo mv /tmp/DO /usr/local/bin/DO && sudo chmod +x /usr/local/bin/DO"
```

`mv` сохраняет права файла. Артефакт пришёл с `rwxrwxrwx` — бинарник в `/usr/local/bin` стал **записываемым для всех**. Любой пользователь VM2 мог подменить программу, которую запускают другие (включая root), — классическое повышение привилегий через `PATH`.

`install -m 755` выставляет `rwxr-xr-x` независимо от исходных прав.

## sudo для деплоя: минимальные права

В проекте группе `sudo` на VM2 выдано `NOPASSWD: ALL` — пользователь деплоя без пароля может **всё**. Утёк ключ runner — полный root на prod.

Минимально:

```
# /etc/sudoers.d/deploy  (редактировать: visudo -f /etc/sudoers.d/deploy)
deploy ALL=(root) NOPASSWD: /usr/bin/install -o root -g root -m 755 /tmp/DO.* /usr/local/bin/DO
```

- отдельный пользователь `deploy`, а не личная учётка администратора;
- разрешена ровно одна команда с фиксированными аргументами.

> Звёздочка в sudoers совпадает и с пробелами — через `/tmp/DO.x /etc/…` можно подсунуть лишние аргументы. И сам `install` от root мощный. Поэтому в продакшене выбирают другие модели — ниже.

## Модели доставки

| Модель | Как | Плюсы |
|---|---|---|
| **push по SSH** (проект) | CI сам заходит на сервер | просто |
| **пакет** | CI собирает `.deb`, сервер ставит из репозитория `apt` | версии, откат, без root-доступа CI |
| **pull** | сервер сам забирает новую версию (cron, агент, GitOps) | у CI нет доступа к prod вообще |
| **контейнер** | CI пушит образ в registry, оркестратор обновляет | откат = предыдущий тег |

## Проверка после деплоя

Деплой без проверки — надежда. Smoke-тест в конце `deploy.sh`:

```bash
ssh -o BatchMode=yes "${DEPLOY_USER}@${DEPLOY_HOST}" '/usr/local/bin/DO 6' | grep -q "Learning to CI/CD"
```

В учебном прогоне проекта это проверялось вручную: `/usr/local/bin/DO 6` → «Learning to CI/CD».

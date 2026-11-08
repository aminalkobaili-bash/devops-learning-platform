## Ручной деплой

```yaml
deploy_job:
  stage: deploy
  tags:
    - deploy
  script:
    - bash scripts/deploy.sh
  when: manual
```

Job ждёт нажатия ▶ в интерфейсе пайплайна. Это **continuous delivery**: каждая сборка готова к выкатке, решение — за человеком. **Continuous deployment** — выкатка автоматически, без кнопки.

## allow_failure у manual job

| Job | `allow_failure` по умолчанию |
|---|---|
| обычный | `false` |
| **`when: manual`** на уровне job | **`true`** |
| `when: manual` внутри `rules` | `false` |

Ручной job с `allow_failure: true`:

- пайплайн не «застревает» на ненажатой кнопке — следующие стадии идут дальше;
- его **провал считается успехом** для зависимостей: пайплайн зелёный с оранжевым предупреждением.

## Найденная ошибка: уведомление о провале деплоя не отправлялось

Было:

```yaml
notify_cd_failure:
  needs: [deploy_job]
  when: on_failure
```

`deploy_job` упал → но у него `allow_failure: true` → для GitLab это не провал → `on_failure` не срабатывает. Уведомление «CD failed» **никогда** не приходило.

Стало — результат отправляется из самого deploy-job:

```yaml
deploy_job:
  script:
    - bash scripts/deploy.sh
  after_script:
    - |
      if [ "$CI_JOB_STATUS" = "success" ]; then
        bash scripts/notify.sh "🚀 <b>CD passed</b> for ${CI_COMMIT_SHORT_SHA}."
      else
        bash scripts/notify.sh "🔥 <b>CD failed</b> for ${CI_COMMIT_SHORT_SHA}. Check: ${CI_PIPELINE_URL}"
      fi
  when: manual
```

## after_script

| Свойство | Значение |
|---|---|
| когда | после `script` — **и при успехе, и при провале** |
| при отмене job | тоже выполняется (GitLab 17.3+), `CI_JOB_STATUS = canceled` |
| при таймауте job | по умолчанию **не** выполняется |
| shell | **новый**: переменные и `cd` из `script` не сохраняются |
| таймаут | отдельный, 5 минут (`RUNNER_AFTER_SCRIPT_TIMEOUT`) |
| ошибки | **по умолчанию игнорируются** — не меняют статус job |

### Два нюанса для проекта

**1. Отменённый деплой → «CD failed».** `CI_JOB_STATUS` при отмене — `canceled`, а не `success`, и уходит в ветку `else`. Точнее различать три состояния:

```bash
case "$CI_JOB_STATUS" in
  success)  bash scripts/notify.sh "🚀 CD passed …" ;;
  canceled) bash scripts/notify.sh "⏹ CD canceled …" ;;
  *)        bash scripts/notify.sh "🔥 CD failed …" ;;
esac
```

**2. Сбой уведомления снова тихий.** В `notify.sh` специально добавлен `exit 1` при отказе Telegram (модуль 06). Но в `after_script` ошибки игнорируются: токен протух → `notify.sh` упал → `deploy_job` всё равно зелёный, сообщения нет. Чтобы ошибка в `after_script` роняла job:

```yaml
deploy_job:
  variables:
    AFTER_SCRIPT_IGNORE_ERRORS: "false"
```

## Найденная проблема безопасности: доступ к prod из любой ветки

Сложим факты проекта:

| Факт | Модуль |
|---|---|
| shell executor: jobs выполняются в ОС VM1 от `gitlab-runner` | 04 |
| SSH-ключ к prod лежит в `~gitlab-runner/.ssh/` на этой VM | 05 |
| на VM2 у пользователя деплоя `sudo NOPASSWD: ALL` | 05 |
| `.gitlab-ci.yml` берётся из той ветки, в которую запушили | — |
| у jobs нет ограничений `rules` по ветке, runner не защищён | 04 |

Значит, любой, кто может запушить **любую ветку**, может заменить `script` у `build_job`:

```yaml
build_job:
  script:
    - ssh deploy@prod 'sudo <любая команда>'
```

и получить root на production. Кнопка manual, masked-переменные и protected-переменные это не останавливают: ключ — не переменная, а файл на runner.

Как закрывают:

1. **Protected runner** для деплоя: отдельный runner (*Settings → CI/CD → Runners → Protected*) выполняет jobs только из защищённых веток. SSH-ключ — только на нём.
2. **Ключ не на диске runner**, а в переменной типа *File*, **Protected** — недоступен в незащищённых ветках.
3. **rules** на deploy-job:

   ```yaml
   deploy_job:
     rules:
       - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
         when: manual
   ```

4. **Protected branches**: пушить в `main` может только ограниченный круг; изменения — через merge request с ревью.
5. **Environments** с подтверждением: `environment: production` + *Protected environments* — кто имеет право нажать деплой.
6. **docker executor** для CI-jobs: каждый job в чистом контейнере, без доступа к файлам хоста.

> `rules` в `.gitlab-ci.yml` сами по себе не защищают — злоумышленник правит этот же файл в своей ветке. Защищают настройки **проекта** (protected runner, protected variables, protected branches), которые нельзя изменить коммитом.

## Окружения GitLab

```yaml
deploy_job:
  environment:
    name: production
    url: http://vm2.example
```

*Operate → Environments*: история деплоев, какой коммит сейчас на prod, кнопка **Rollback** — повторный запуск деплоя предыдущего успешного коммита.

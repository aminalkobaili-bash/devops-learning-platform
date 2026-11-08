## Термины

| Термин | Что это |
|---|---|
| **pipeline** | один прогон всех стадий для коммита |
| **stage** | этап; стадии идут **последовательно** |
| **job** | задача внутри стадии; jobs одной стадии идут **параллельно** |
| **runner** | агент, который выполняет jobs |
| **executor** | как runner выполняет job: `shell`, `docker`, `kubernetes`… |
| **artifact** | файлы результата job, передаются следующим стадиям |

## Пайплайн проекта

```yaml
stages:
  - build
  - style
  - test
  - deploy
  - notify

build_job:
  stage: build
  tags:
    - build
  script:
    - cd app && make
  artifacts:
    paths:
      - app/DO
    expire_in: 30 days

style_job:
  stage: style
  tags:
    - style
  script:
    - bash scripts/style.sh

test_job:
  stage: test
  tags:
    - test
  script:
    - python3 tests/test_integration.py
```

```
build ──► style ──► test ──► deploy (▶ manual) ──► notify
```

Если job падает, следующие стадии не запускаются (кроме jobs с `when: on_failure` / `always`).

### Порядок: стиль до тестов?

В проекте `style` идёт **после** `build`, хотя от сборки не зависит. Обычно быстрые проверки (lint, style) ставят **первыми** или параллельно сборке — чтобы упасть за секунды, не дожидаясь компиляции. Тот же эффект без перестановки стадий даёт `needs` (DAG):

```yaml
style_job:
  stage: style
  needs: []          # не ждать предыдущих стадий
```

## script

Каждая строка `script` — shell-команда. Job падает на **первой** команде с ненулевым кодом.

```yaml
script:
  - cd app && make
```

Каждый job начинается **в корне репозитория** заново — `cd` из одного job не влияет на другой.

## Артефакты

```yaml
artifacts:
  paths:
    - app/DO
  expire_in: 30 days
```

- Файлы загружаются в GitLab после job.
- Jobs **следующих стадий** скачивают артефакты всех предыдущих стадий автоматически (`test_job` получает `app/DO`).
- `expire_in` — через сколько удалить; по умолчанию зависит от настроек инстанса.
- Тестируется и деплоится **тот же бинарник**, что собрала стадия build.

## Runner и теги

```yaml
tags:
  - build
```

Job выполнится только на runner, у которого есть **все** указанные теги. В проекте один runner на VM1 с тегами `build, style, test, deploy, bot`.

```bash
sudo gitlab-runner register      # URL GitLab, токен, executor, теги
sudo gitlab-runner list
sudo gitlab-runner verify
systemctl status gitlab-runner
```

### Executor: shell

| Executor | Где выполняется job | Плюсы | Минусы |
|---|---|---|---|
| `shell` (проект) | прямо в ОС runner от пользователя `gitlab-runner` | просто, быстро, есть всё, что установлено на VM | окружение «загрязняется» между jobs; любой job имеет доступ ко всему, что есть у `gitlab-runner` (SSH-ключи, файлы) |
| `docker` | в свежем контейнере из `image:` | чистое воспроизводимое окружение, изоляция | нужен Docker, образы |
| `kubernetes` | в pod кластера | масштабирование | сложность |

> Для shell executor на VM1 должны быть установлены `gcc`, `make`, `clang-format`, `python3`, `curl`, `ssh`. С docker executor это описывается в `.gitlab-ci.yml`: `image: gcc:13`.

## when

| Значение | Когда запускается job |
|---|---|
| `on_success` (по умолчанию) | все jobs предыдущих стадий успешны |
| `on_failure` | хотя бы один job предыдущих стадий упал |
| `always` | всегда |
| `manual` | по кнопке ▶ в интерфейсе |
| `never` | никогда (в `rules`) |

На этом построены уведомления: `notify_ci_success` с `on_success`, `notify_ci_failure` с `on_failure` — выполнится ровно один из них.

## Предопределённые переменные

| Переменная | Значение |
|---|---|
| `CI_COMMIT_SHORT_SHA` | первые 8 символов хеша коммита |
| `CI_COMMIT_BRANCH` | ветка (пусто для пайплайнов тегов и merge request) |
| `CI_PIPELINE_URL` | ссылка на пайплайн |
| `CI_JOB_STATUS` | `success` / `failed` / `canceled` — в `after_script` |
| `CI_DEFAULT_BRANCH` | основная ветка проекта |

## Проверка конфигурации

- *Build → Pipeline editor* — подсветка ошибок и визуализация стадий.
- `gitlab-ci-local` — запуск пайплайна локально без GitLab.
- Ошибка YAML = пайплайн не создаётся вовсе.

## rules вместо only/except

Пайплайн проекта запускается на любой push в любую ветку. Ограничить job основной веткой:

```yaml
deploy_job:
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
```

`only` / `except` — устаревший синтаксис, новый — `rules`.

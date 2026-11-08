## Зачем зеркало

Учебный GitLab и VM недоступны, а результат хочется показывать. GitHub Actions выполняет **build → style → test** на каждый push в публичном репозитории — бейдж CI в README подтверждает, что код собирается и тесты проходят. Deploy и notify остались только в GitLab: им нужны self-hosted runner, prod-VM и секреты бота.

## Термины: GitLab ↔ GitHub

| GitLab CI | GitHub Actions |
|---|---|
| `.gitlab-ci.yml` | `.github/workflows/*.yml` (можно несколько) |
| pipeline | workflow run |
| stage + job | job (порядок — через `needs`) |
| `script:` | `steps:` с `run:` или готовыми `uses:` |
| runner + `tags` | `runs-on: ubuntu-24.04` или self-hosted |
| artifacts передаются автоматически | `upload-artifact` / `download-artifact` явно |
| CI/CD Variables | Secrets / Variables |

## Workflow проекта

```yaml
name: CI

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - name: Build
        run: cd app && make
      - uses: actions/upload-artifact@v7
        with:
          name: DO
          path: app/DO
          if-no-files-found: error
          retention-days: 30

  style:
    runs-on: ubuntu-24.04
    needs: build
    env:
      CLANG_FORMAT: clang-format-18
    steps:
      - uses: actions/checkout@v7
      - name: Install clang-format 18
        run: command -v clang-format-18 || (sudo apt-get update && sudo apt-get install -y clang-format-18)
      - name: Check code style
        run: bash scripts/style.sh

  test:
    runs-on: ubuntu-24.04
    needs: [build, style]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/download-artifact@v8
        with:
          name: DO
          path: app
      - name: Restore executable bit
        run: chmod +x app/DO
      - name: Integration tests
        run: python3 tests/test_integration.py
```

## Разбор

| Элемент | Значение |
|---|---|
| `on: push, pull_request` | запуск на любой push и PR |
| `permissions: contents: read` | токен `GITHUB_TOKEN` только читает репозиторий — минимальные права |
| `runs-on: ubuntu-24.04` | та же ОС, что у runner в GitLab; `ubuntu-latest` со временем сменит версию |
| `actions/checkout` | клонирует репозиторий — без него в job **пусто** (в GitLab клонирование автоматическое) |
| `needs` | порядок и зависимости jobs; без `needs` все jobs идут **параллельно** |
| `if-no-files-found: error` | job упадёт, если бинарник не собрался — а не загрузит пустоту |

Каждый job — **отдельная чистая VM**. Файлы между jobs передаются только артефактами.

### Права файла теряются

```yaml
- name: Restore executable bit
  run: chmod +x app/DO
```

`upload-artifact` упаковывает файлы в zip **без прав доступа**: бинарник возвращается как `644`, запуск — `Permission denied`. Отсюда `chmod +x` после скачивания. Альтернатива — упаковать в `tar` перед загрузкой, tar права сохраняет.

### Фиксированная версия clang-format

`CLANG_FORMAT: clang-format-18` + установка именно 18-й версии — та же, что в GitLab-прогоне (`18.1.3`). Иначе образ runner может принести другую версию, и проверка станет нестабильной (модуль 02).

## Версии actions

```yaml
uses: actions/checkout@v7
```

| Запись | Что получишь |
|---|---|
| `@v7` | последний релиз мажорной версии 7 — обновления без ломающих изменений |
| `@v7.0.1` | ровно этот тег (теги можно перезаписать) |
| `@<sha коммита>` | неизменяемая ссылка — так рекомендует GitHub для сторонних actions (supply chain) |

Для официальных `actions/*` мажорная версия — нормальный компромисс; для сторонних — SHA.

## Проверка workflow

```bash
actionlint .github/workflows/ci.yml
```

Линтер: синтаксис, опечатки в ключах, ошибки в выражениях `${{ }}`, shellcheck внутри `run:`. В проекте: 0 ошибок.

## Бейдж

```markdown
[![CI](https://github.com/<user>/<repo>/actions/workflows/ci.yml/badge.svg)](https://github.com/<user>/<repo>/actions/workflows/ci.yml)
```

Зелёный бейдж в README — проверяемое доказательство для работодателя: последний прогон на `main` прошёл.

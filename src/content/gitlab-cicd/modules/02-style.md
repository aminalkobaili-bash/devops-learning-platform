## Зачем проверять стиль в CI

Единый стиль — меньше шума в ревью: диффы показывают изменения логики, а не перестановку пробелов. Автоматическая проверка в пайплайне не даёт смержить неотформатированный код.

## clang-format

Форматтер для C, C++, Java, JavaScript. Правила — в файле `.clang-format`:

```yaml
---
BasedOnStyle: Google
```

Готовые стили: `LLVM` (по умолчанию), `Google`, `Chromium`, `Mozilla`, `WebKit`, `GNU`. Поверх можно переопределить отдельные параметры (`IndentWidth: 4`, `ColumnLimit: 100`…).

### Где clang-format ищет конфиг

В каталоге **файла** и выше по родительским каталогам, до корня. Первый найденный `.clang-format` применяется.

> **Найденная ошибка.** Конфиг лежал в `materials/linters/` — это не родитель `app/main.c`. clang-format его не находил и проверял по стилю по умолчанию LLVM. Проверка «проходила», но не по тому стилю. Исправлено: `.clang-format` в корне репозитория.

Разница стилей на коде проекта — отступ `case`:

```c
// Google: case с отступом от switch
switch (num) {
  case 1:
    printf("…");
```

```c
// LLVM: case на уровне switch
switch (num) {
case 1:
  printf("…");
```

## Режим проверки

```bash
clang-format --dry-run --Werror app/main.c
```

| Флаг | Значение |
|---|---|
| `--dry-run` (`-n`) | ничего не менять, только сообщить о нарушениях |
| `--Werror` | нарушение → код возврата ≠ 0 → job падает |
| `-i` | исправить файл на месте |

Вывод на неотформатированном файле:

```
main.c:11:17: error: code should be clang-formatted [-Wclang-format-violations]
```

Исправить локально и закоммитить:

```bash
clang-format -i app/main.c
```

## Скрипт style.sh

```bash
#!/bin/bash
set -euo pipefail

CLANG_FORMAT="${CLANG_FORMAT:-clang-format}"
"$CLANG_FORMAT" --version
"$CLANG_FORMAT" --dry-run --Werror app/main.c
echo "Code style OK"
```

| Часть | Зачем |
|---|---|
| `set -euo pipefail` | любая ошибка останавливает скрипт с ненулевым кодом |
| `${CLANG_FORMAT:-clang-format}` | версию можно задать переменной: `CLANG_FORMAT=clang-format-18` |
| `--version` | в логе job видно, какой версией проверяли |

### Почему версия важна

Вывод форматирования **отличается между версиями** clang-format: новая версия может форматировать какую-то конструкцию иначе. Если разработчик форматирует версией 20, а CI проверяет версией 18 — job может падать на «правильно» отформатированном коде. Поэтому версию фиксируют в CI (`clang-format-18` в GitHub Actions) и сообщают команде.

> На коде проекта проверка проходит и с clang-format 20.1.8 (проверено при подготовке модуля), и с 18.1.3 (прогон из README).

## Pre-commit: проверка до пуша

Не ждать CI — проверять при каждом коммите:

```bash
# .git/hooks/pre-commit
#!/bin/sh
clang-format --dry-run --Werror app/*.c
```

Или фреймворк `pre-commit` с готовым хуком `clang-format`. CI остаётся гарантией — хуки локальные, их можно пропустить (`git commit --no-verify`).

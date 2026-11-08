## Интеграционный тест

**Юнит-тест** проверяет функцию изнутри кода. **Интеграционный** — программу целиком снаружи, как её использует человек или другой скрипт: запустили бинарник, проверили вывод и код возврата.

```python
import subprocess
import sys

BINARY = "./app/DO"

def run_test(args, expected_output, expected_code):
    result = subprocess.run([BINARY] + args, capture_output=True, text=True)

    if result.returncode != expected_code:
        print(f"FAIL: args={args}")
        print(f"  Expected code: {expected_code}, Got: {result.returncode}")
        sys.exit(1)

    if expected_output not in result.stdout:
        print(f"FAIL: args={args}")
        sys.exit(1)

    print(f"PASS: args={args} -> '{expected_output}' (code {expected_code})")
```

## subprocess.run

| Аргумент | Зачем |
|---|---|
| `[BINARY] + args` | команда **списком**: каждый аргумент отдельно, без shell — нет проблем с пробелами и спецсимволами |
| `capture_output=True` | перехватить stdout и stderr в `result.stdout` / `result.stderr` |
| `text=True` | строки вместо байтов |
| `timeout=5` | не висеть вечно, если программа зависла (в проекте нет) |
| `check=True` | бросить исключение при ненулевом коде (здесь не нужно — ненулевой код ожидается) |

> `subprocess.run("./DO " + arg, shell=True)` — антипаттерн: аргумент с `;` или `$(…)` выполнится как команда.

## Сценарии проекта

| Аргументы | Ожидаемый вывод | Код |
|---|---|---|
| нет | `Bad number of arguments!` | 255 |
| `1` | `Learning to Linux` | 0 |
| `6` | `Learning to CI/CD` | 0 |
| `7` | `Bad number!` | 254 |

Проверено в Ubuntu 24.04 (WSL): все 4 сценария PASS.

## Как тест сообщает CI о результате

```python
sys.exit(1)   # провал — job красный
sys.exit(0)   # успех
```

Пайплайн ничего не знает о Python — он смотрит только на **код возврата** команды из `script`. Любой тестовый инструмент работает с CI так же.

## Чего не хватает в тестах

Хороший набор тестов покрывает **граничные** и **некорректные** входы, а не только «счастливый путь»:

| Случай | Сейчас | Что вскроет |
|---|---|---|
| `1`, `6` | есть | — |
| `2`–`5` | нет | опечатку в одной из строк |
| `0`, `-1` | нет | границы диапазона |
| `abc` | нет | нечисловой ввод → `Bad number!` |
| **`1abc`** | нет | **баг `atoi`**: сейчас программа отвечает «Learning to Linux» с кодом 0 |
| два аргумента | нет | проверку `argc` |

Тест на `1abc` — пример того, как тест находит реальную ошибку (модуль 01).

## Фреймворк вместо sys.exit

Самописный `run_test` останавливается на **первом** провале — остальные сценарии не выполняются. `pytest` прогоняет все и показывает сводку:

```python
import subprocess
import pytest

CASES = [
    ([], "Bad number of arguments!", 255),
    (["1"], "Learning to Linux", 0),
    (["6"], "Learning to CI/CD", 0),
    (["7"], "Bad number!", 254),
]

@pytest.mark.parametrize("args,output,code", CASES)
def test_do(args, output, code):
    r = subprocess.run(["./app/DO", *args], capture_output=True, text=True, timeout=5)
    assert r.returncode == code
    assert output in r.stdout
```

`pytest --junitxml=report.xml` — отчёт, который GitLab показывает во вкладке Tests пайплайна (`artifacts: reports: junit`).

## Пирамида тестов

| Уровень | Скорость | Сколько |
|---|---|---|
| юнит | миллисекунды | много |
| интеграционные | секунды | меньше |
| end-to-end (на развёрнутом сервисе) | минуты | единицы |

В проекте нет проверки **после деплоя** — что на VM2 `/usr/local/bin/DO 6` действительно отвечает. Её добавляют в deploy-job как smoke-тест.

## Конфигурация из окружения

```python
# config.py
from datetime import timedelta
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
JWT_SECRET_KEY = os.environ["JWT_SECRET_KEY"]
JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)
JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=7)
```

Принцип 12-factor app: конфигурация, которая отличается между окружениями (dev, test, prod), — в **переменных окружения**, а не в коде.

| Запись | Если переменной нет |
|---|---|
| `os.environ["X"]` | `KeyError` — приложение не стартует |
| `os.environ.get("X")` | `None` |
| `os.getenv("X", "default")` | значение по умолчанию |

> В проекте секреты читаются через `os.environ[…]` **без значений по умолчанию** — намеренно. Раньше в `config.py` был пароль БД и JWT-секрет как значения по умолчанию: забыл задать переменную — приложение тихо работает с секретом из открытого репозитория. Лучше упасть при старте.

## .env и python-dotenv

```bash
# .env.example — в git, шаблон
DATABASE_URL=postgresql+psycopg://postgres:CHANGE_ME@localhost:5432/tictactoe
JWT_SECRET_KEY=CHANGE_ME
FLASK_DEBUG=0
```

```bash
cp .env.example .env    # .env — в .gitignore, с реальными значениями
```

`load_dotenv()` читает `.env` и кладёт значения в `os.environ`. Уже заданные в окружении переменные **не перезаписывает** — так на сервере переменные из systemd или Docker важнее файла.

### Строка подключения

```
postgresql+psycopg://user:password@host:5432/dbname
```

`postgresql+psycopg` — диалект SQLAlchemy и драйвер (psycopg 3). Для psycopg2 было бы `postgresql+psycopg2`.

### Секрет для JWT

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

32 случайных байта = 64 hex-символа. Модуль `secrets` — криптографически стойкий генератор, `random` для этого не подходит.

> Кто знает `JWT_SECRET_KEY`, может выпустить токен от имени любого пользователя. Утёк — меняют секрет, и все выданные токены становятся невалидными.

## Debug-режим

```python
app.run(debug=os.getenv("FLASK_DEBUG") == "1")
```

Debug включает автоперезагрузку при изменении кода и **интерактивный отладчик** в браузере при исключении. Отладчик позволяет выполнить произвольный Python-код на сервере — в продакшене это удалённое выполнение кода. Раньше в проекте было `app.run(debug=True)` без условия.

## Зависимости

```
Flask==3.1.3
flask-jwt-extended==4.7.4
SQLAlchemy==2.0.51
psycopg[binary]==3.3.4
python-dotenv==1.0.1
```

- `==` — точные версии: воспроизводимая установка, та же версия, на которой проверяли.
- `psycopg[binary]` — extra: ставит пакет с уже собранной C-библиотекой, не нужен компилятор и `libpq-dev`.
- Транзитивные зависимости (Werkzeug, Jinja2…) не закреплены. Полный снимок — `pip freeze > requirements.txt` или lock-файл (`pip-tools`, `uv`, `poetry`).

## Запуск

```bash
python -m venv venv && source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
cd src && python main.py                            # http://127.0.0.1:5000
```

`venv` — изолированное окружение: пакеты проекта не смешиваются с системными и с другими проектами.

### Dev-сервер и продакшен

`app.run()` — встроенный сервер Werkzeug для разработки: один процесс, не рассчитан на нагрузку и безопасность. В продакшене — WSGI-сервер:

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:8000 "main:create_app()"
```

| Флаг | Значение |
|---|---|
| `-w 4` | 4 процесса-воркера (обычно 2 × ядра + 1) |
| `-b 0.0.0.0:8000` | адрес и порт |
| `"main:create_app()"` | модуль и фабрика приложения |

Перед gunicorn ставят nginx как reverse proxy: TLS, статика, буферизация медленных клиентов.

## Задача

Топ-N игроков по `win_ratio = победы / (поражения + ничьи)` — **одним SQL-запросом**, без загрузки всех игр в Python.

Сложность: в таблице `games` игрок может быть и в `player1_uuid`, и в `player2_uuid`. Нужно собрать все участия каждого игрока в одну колонку.

## Шаг 1. UNION ALL: участия в одну колонку

```sql
SELECT player1_uuid AS user_uuid, status, winner_uuid
FROM games WHERE status IN ('WON', 'DRAW')
UNION ALL
SELECT player2_uuid, status, winner_uuid
FROM games WHERE status IN ('WON', 'DRAW')
```

Одна партия двух людей даёт **две** строки — по одной на каждого участника. `UNION ALL`, а не `UNION`: дубликаты здесь — разные партии с одинаковым исходом, их нельзя схлопывать (модуль 02 SQL).

В игре против компьютера `player2_uuid = NULL` — во второй части появится строка с `user_uuid = NULL`. Она отсеется на JOIN с `users` в конце.

## Шаг 2. Условная агрегация

```sql
SELECT user_uuid,
  SUM(CASE WHEN status = 'WON' AND winner_uuid = user_uuid THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN status = 'WON' AND (winner_uuid IS NULL OR winner_uuid != user_uuid)
           THEN 1 ELSE 0 END) AS losses,
  SUM(CASE WHEN status = 'DRAW' THEN 1 ELSE 0 END) AS draws
FROM user_games
GROUP BY user_uuid
```

`SUM(CASE WHEN условие THEN 1 ELSE 0 END)` — посчитать строки, удовлетворяющие условию, внутри каждой группы. Три счётчика за один проход.

## Найденный баг: поражение компьютеру не считалось

Когда побеждает компьютер, `winner_uuid = NULL`. Исходное условие поражения:

```sql
winner_uuid != user_uuid
```

`NULL != 'abc…'` даёт **`NULL`**, а не `true` — `CASE` уходит в `ELSE 0`. Поражения компьютеру пропадали, и `win_ratio` был завышен.

| Сценарий | Было | Стало |
|---|---|---|
| 1 победа, 2 поражения компьютеру | `1` (поражений 0 → «делим» на 0 → wins) | `0.5` |

Исправление — явная проверка `NULL`:

```sql
winner_uuid IS NULL OR winner_uuid != user_uuid
```

> Любое сравнение с `NULL` через `=`, `!=`, `<`, `>` даёт `NULL`. Тот же эффект, что `NOT IN` с `NULL` в модуле 02 SQL. Есть и сравнение, безопасное к NULL: `winner_uuid IS DISTINCT FROM user_uuid`.

## Шаг 3. win_ratio без деления на ноль

```sql
CASE WHEN losses + draws = 0 THEN wins
     ELSE wins / (losses + draws)
END
```

Только победы — ratio = числу побед (условность проекта, чтобы не делить на 0).

## Тип результата: Decimal, строка и целочисленное деление

После первой версии API отдавал `"win_ratio": "1.5000000000000000"` — **строкой**. Деление вернуло `NUMERIC`, psycopg превратил его в Python `Decimal`, а Flask сериализует `Decimal` в JSON как строку. Исправление — `CAST(… AS FLOAT)`:

```python
win_ratio = cast(case(…), Float).label("win_ratio")
```

> **Осторожно с типами.** `SUM` по целым в PostgreSQL возвращает `bigint`, а `bigint / bigint` — **целочисленное** деление: `3 / 2 = 1`. Проверено на PostgreSQL 16:
>
> | Выражение | Результат |
> |---|---|
> | `SUM(int) / SUM(int)` | `1` |
> | то же, но суммы `numeric` | `1.5000000000000000` |
> | `CAST(SUM(w) AS float) / SUM(l)` | `1.5` |
>
> В проекте результат `1.5`, потому что значения `1` и `0` из `case()` SQLAlchemy передаёт драйверу параметрами, и до деления они оказываются `numeric` (это и видно по старому `Decimal`). Это зависит от драйвера. Надёжнее приводить **до деления**: `cast(wins, Float) / (losses + draws)` — тогда результат не зависит от того, как переданы литералы.

## Шаг 4. JOIN с users и топ-N

```python
session.query(ORMUser.uuid, ORMUser.login, win_ratio)
    .select_from(ORMUser)
    .join(stats, ORMUser.uuid == stats.c.user_uuid)
    .order_by(win_ratio.desc())
    .limit(limit)
```

- `JOIN users` добавляет логин и заодно отбрасывает строку `user_uuid = NULL` (компьютер).
- `ORDER BY … DESC LIMIT N` — топ-N (модуль 09 SQL).

## Как это выглядит в SQLAlchemy

| SQL | SQLAlchemy |
|---|---|
| подзапрос | `select(…).subquery()`, колонки — `sub.c.name` |
| `UNION ALL` | `select(…).union_all(select(…))` |
| `CASE` | `case((условие, 1), else_=0)` |
| `IS NULL` | `col.is_(None)` |
| `OR` | `or_(a, b)` |
| `CAST` | `cast(expr, Float)` |
| одна таблица дважды | `aliased(ORMGame)` |

`.having(func.count() > 0)` в коде проекта лишний: после `GROUP BY` в каждой группе есть хотя бы одна строка.

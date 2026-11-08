## Агрегатные функции

Превращают много строк в одно значение.

| Функция | Что считает | NULL |
|---|---|---|
| `COUNT(*)` | число строк | считает |
| `COUNT(col)` | число строк, где `col` не `NULL` | пропускает |
| `COUNT(DISTINCT col)` | число разных значений | пропускает |
| `SUM(col)` | сумму | пропускает |
| `AVG(col)` | среднее | пропускает (делит на число не-`NULL`) |
| `MIN(col)`, `MAX(col)` | минимум, максимум | пропускает |

> Значения `1, NULL, 3`: `COUNT(*) = 3`, `COUNT(v) = 2`, `AVG(v) = 2` — не `4 / 3`.

## GROUP BY

Разбивает строки на группы и считает агрегат для каждой.

```sql
SELECT person_id, COUNT(*) AS count_of_visits
FROM person_visits
GROUP BY person_id
ORDER BY count_of_visits DESC, person_id;
```

- В `SELECT` можно указать только колонки из `GROUP BY` и агрегаты. Иначе — `column must appear in the GROUP BY clause or be used in an aggregate function`.
- Группировать можно по нескольким колонкам: `GROUP BY p.address, pz.name` — группа на каждую пару значений.

> Группировка по `pz.name` работает, пока названия пиццерий уникальны. Две пиццерии с одинаковым именем сольются в одну группу. Надёжнее `GROUP BY pz.id, pz.name`.

## WHERE и HAVING

| | `WHERE` | `HAVING` |
|---|---|---|
| Когда | **до** группировки | **после** группировки |
| Фильтрует | строки | группы |
| Агрегаты в условии | нельзя | можно |

```sql
SELECT p.name, COUNT(*) AS count_of_visits
FROM person p
JOIN person_visits pv ON p.id = pv.person_id
GROUP BY p.name
HAVING COUNT(*) > 3;
```

`WHERE COUNT(*) > 3` — ошибка `aggregate functions are not allowed in WHERE`.

Полный порядок выполнения: `FROM` → `WHERE` → `GROUP BY` → `HAVING` → `SELECT` → `DISTINCT` → `ORDER BY` → `LIMIT`.

## DISTINCT vs GROUP BY

Без агрегатов это одно и то же:

```sql
SELECT DISTINCT p.name FROM person p JOIN person_order po ON p.id = po.person_id;
SELECT p.name          FROM person p JOIN person_order po ON p.id = po.person_id GROUP BY p.name;
```

`DISTINCT` — когда нужны просто уникальные строки, `GROUP BY` — когда к ним нужны агрегаты.

## Топ-N: ORDER BY + LIMIT

```sql
SELECT p.name, COUNT(*) AS count_of_visits
FROM person_visits pv
JOIN person p ON pv.person_id = p.id
GROUP BY p.name
ORDER BY count_of_visits DESC, p.name
LIMIT 4;
```

- Вторая колонка в `ORDER BY` (`p.name`) делает результат **детерминированным**: при равном количестве визитов порядок не случаен.
- Если на 4-м месте ничья, `LIMIT 4` отрежет часть «равных». Взять всех равных: `FETCH FIRST 4 ROWS WITH TIES`.

### Топ-N в каждой из двух выборок

`ORDER BY` и `LIMIT` относятся ко **всему** `UNION`. Чтобы взять топ-3 из каждой части, каждую оборачивают в подзапрос:

```sql
SELECT * FROM (
  SELECT pz.name, COUNT(*) AS count, 'visit' AS action_type
  FROM pizzeria pz JOIN person_visits pv ON pz.id = pv.pizzeria_id
  GROUP BY pz.name ORDER BY count DESC LIMIT 3
) v
UNION ALL
SELECT * FROM (
  SELECT pz.name, COUNT(*), 'order'
  FROM pizzeria pz JOIN menu m ON pz.id = m.pizzeria_id
  JOIN person_order po ON m.id = po.menu_id
  GROUP BY pz.name ORDER BY count DESC LIMIT 3
) o
ORDER BY action_type, count DESC;
```

Колонка-метка `'visit'` / `'order'` показывает, из какой части строка.

## Сложить метрики из двух источников

Визиты и заказы по каждой пиццерии считаются отдельно, потом складываются. Два способа:

| Способ | Как | Ловушка |
|---|---|---|
| `FULL JOIN` двух агрегатов | `COALESCE(v.cnt, 0) + COALESCE(o.cnt, 0)` | без `COALESCE`: `5 + NULL = NULL` |
| `UNION ALL` + `SUM` | склеить счётчики, затем `GROUP BY name` + `SUM` | — |

> Почему не `JOIN` визитов и заказов в одном запросе: каждая строка визита соединится с каждой строкой заказа той же пиццерии, и `COUNT` посчитает произведение, а не сумму.

## Числа: деление, округление

| Выражение | Результат | Почему |
|---|---|---|
| `13 / 33` | `0` | оба `integer` → целочисленное деление |
| `13::numeric / 33` | `0.3939…` | один операнд `numeric` → обычное деление |
| `ROUND(AVG(price), 2)` | `1000.00` | округление до 2 знаков |
| `ROUND(AVG(rating), 4)` | `3.7333` | |

> Целочисленное деление — частая тихая ошибка: запрос работает, но формула всегда даёт 0. Приводи хотя бы один операнд к `numeric`.

Сравнение двух вычисленных значений прямо в `SELECT` возвращает `boolean`:

```sql
ROUND(MAX(age) - (MIN(age)::NUMERIC / MAX(age)), 2) > ROUND(AVG(age), 2) AS comparison
```

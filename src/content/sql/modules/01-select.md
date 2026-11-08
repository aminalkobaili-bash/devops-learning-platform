## Учебная БД

Все задачи модуля — на одной схеме (сеть пиццерий). Все `id` — `bigint primary key`.

| Таблица | Поля | Связи |
|---|---|---|
| `person` | `id`, `name`, `age`, `gender`, `address` | `gender IN ('female','male')` |
| `pizzeria` | `id`, `name`, `rating` | `rating BETWEEN 0 AND 5` |
| `menu` | `id`, `pizzeria_id`, `pizza_name`, `price` | `pizzeria_id` → `pizzeria` |
| `person_visits` | `id`, `person_id`, `pizzeria_id`, `visit_date` | → `person`, `pizzeria` |
| `person_order` | `id`, `person_id`, `menu_id`, `order_date` | → `person`, `menu` |

> В этом модуле JOIN не используется: данные из связанных таблиц достаём подзапросами.

## Порядок выполнения запроса

Пишем `SELECT … FROM … WHERE … ORDER BY`, но PostgreSQL выполняет в другом порядке:

| Шаг | Клаузула | Что происходит |
|---|---|---|
| 1 | `FROM` | берёт таблицу или подзапрос |
| 2 | `WHERE` | отбрасывает строки, не прошедшие условие |
| 3 | `SELECT` | вычисляет колонки, назначает алиасы |
| 4 | `DISTINCT` | убирает дубликаты |
| 5 | `ORDER BY` | сортирует результат |

> Поэтому алиас из `SELECT` нельзя использовать в `WHERE` — на шаге 2 его ещё нет. А в `ORDER BY` — можно.

## Фильтрация: WHERE

- Сравнение: `=`, `<>`, `<`, `>`, `<=`, `>=`.
- Логика: `AND` сильнее `OR` — ставь скобки: `(a OR b) AND c`.
- Диапазон: `BETWEEN a AND b` — **включает обе границы**, то же самое, что `>= a AND <= b`.
- Регистр: `lower(address) = 'kazan'` — сравнение строк в PostgreSQL чувствительно к регистру.
- Остаток от деления: `id % 2 = 0` — чётные `id`.

```sql
SELECT name, rating
FROM pizzeria
WHERE rating BETWEEN 3.5 AND 5
ORDER BY rating;
```

## Вычисляемые поля

- Конкатенация строк: `||`. Число приводится к тексту автоматически.
- Условная логика: `CASE WHEN … THEN … ELSE … END` — возвращает значение, его можно назвать алиасом.

```sql
SELECT name,
       CASE
         WHEN age BETWEEN 10 AND 20 THEN 'interval #1'
         WHEN age > 20 AND age < 24 THEN 'interval #2'
         ELSE 'interval #3'
       END AS interval_info
FROM person
ORDER BY interval_info;
```

## Подзапросы

| Где | Что возвращает | Пример |
|---|---|---|
| в `SELECT` | одно значение на строку (скалярный) | `(SELECT name FROM person WHERE id = po.person_id)` |
| в `FROM` | временную таблицу; алиас обязателен до PostgreSQL 16, с 16-й — по желанию, но через него обращаются к колонкам | `FROM (SELECT …) AS pv` |
| в `WHERE` | значение или список для сравнения | `WHERE id IN (SELECT …)` |

**Коррелированный подзапрос** ссылается на колонку внешнего запроса и выполняется для каждой его строки:

```sql
SELECT (SELECT name FROM person WHERE person.id = po.person_id) AS person_name
FROM person_order AS po
WHERE order_date = '2022-01-07';
```

> Скалярный подзапрос, вернувший больше одной строки, — ошибка `more than one row returned by a subquery`. Это задачи, которые в модуле 02 решаются через `JOIN`.

## DISTINCT и ORDER BY

- `DISTINCT` применяется ко **всей строке** результата, а не к одной колонке.
- `ORDER BY a, b DESC` — направление задаётся для каждой колонки отдельно; по умолчанию `ASC`.

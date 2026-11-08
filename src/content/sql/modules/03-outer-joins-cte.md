## Внешние соединения

`INNER JOIN` выбрасывает строки без пары. Внешние JOIN их сохраняют, а недостающие колонки заполняют `NULL`.

| Тип | Сохраняет все строки из | Колонки без пары |
|---|---|---|
| `LEFT JOIN` | левой таблицы | правые = `NULL` |
| `RIGHT JOIN` | правой таблицы | левые = `NULL` |
| `FULL JOIN` | обеих | `NULL` с той стороны, где пары нет |

> `A RIGHT JOIN B` = `B LEFT JOIN A`. На практике пишут `LEFT JOIN` и ставят «главную» таблицу слева.

## Поиск пропусков: LEFT JOIN + IS NULL

Строки левой таблицы, у которых **нет** пары справа, — те, где правая колонка стала `NULL`:

```sql
SELECT p.name AS pizzeria_name, p.rating
FROM pizzeria p
LEFT JOIN person_visits pv ON p.id = pv.pizzeria_id
WHERE pv.pizzeria_id IS NULL;
```

Это третий способ антисоединения после `NOT IN` и `NOT EXISTS` из модуля 02.

## ON или WHERE — критично для внешних JOIN

| Условие | Когда применяется | Эффект |
|---|---|---|
| в `ON` | **во время** соединения | строки слева сохраняются, просто не находят пару |
| в `WHERE` | **после** соединения | строки с `NULL` справа отбрасываются → `LEFT JOIN` превращается в `INNER JOIN` |

```sql
-- правильно: фильтр по клиенту в ON
LEFT JOIN person_visits pv1
  ON d.visit_date = pv1.visit_date AND pv1.person_id = 1

-- ошибка: WHERE pv1.person_id = 1 выкинет даты без визитов — а их мы и ищем
```

Одну таблицу можно присоединить **дважды** с разными алиасами — по одному на каждое условие (`pv1` для клиента 1, `pv2` для клиента 2).

## generate_series — генерация календаря

Чтобы найти «дни без визитов», нужен список всех дней — его нет ни в одной таблице:

```sql
SELECT d.day::date
FROM generate_series('2022-01-01'::date, '2022-01-10'::date, '1 day') AS d(day);
```

- `AS d(day)` — алиас таблицы и имя колонки.
- `generate_series` с датами возвращает `timestamp`, поэтому `::date` приводит к дате.

## COALESCE — замена NULL

`COALESCE(a, b, c)` возвращает **первый не-`NULL`** аргумент.

```sql
SELECT COALESCE(p.name, '-') AS person_name,
       pv.visit_date,
       COALESCE(pi.name, '-') AS pizzeria_name
FROM person p
FULL JOIN (
  SELECT * FROM person_visits
  WHERE visit_date BETWEEN '2022-01-01' AND '2022-01-03'
) pv ON p.id = pv.person_id
FULL JOIN pizzeria pi ON pi.id = pv.pizzeria_id;
```

> Фильтр по датам стоит **в подзапросе**, а не в `WHERE`: иначе `WHERE` выкинул бы строки с `visit_date = NULL` — клиентов и пиццерии без визитов, ради которых и нужен `FULL JOIN`.

## CTE: WITH

Common Table Expression — именованный подзапрос, объявленный перед основным запросом.

```sql
WITH missing AS (
  SELECT …
)
SELECT * FROM missing ORDER BY missing_date;
```

- Читается сверху вниз, а не «изнутри наружу», как вложенные подзапросы.
- Можно объявить несколько CTE через запятую и ссылаться на предыдущие.
- На CTE можно сослаться несколько раз в основном запросе.

## Self-join

Соединение таблицы с самой собой — для сравнения строк одной таблицы между собой (например, клиенты с одинаковым адресом):

```sql
SELECT p1.name AS person_name1, p2.name AS person_name2, p1.address AS common_address
FROM person p1
JOIN person p2 ON p1.address = p2.address
WHERE p1.id > p2.id;
```

| Условие | Результат |
|---|---|
| без условия на `id` | каждый в паре сам с собой + каждая пара дважды |
| `p1.id <> p2.id` | без пар «сам с собой», но (A, B) и (B, A) — обе |
| `p1.id > p2.id` | каждая пара ровно один раз |

## LIKE — поиск по шаблону

- `%` — любое количество любых символов, `_` — ровно один символ.
- `pizza_name LIKE '%pepperoni%'` — содержит `pepperoni`.
- `LIKE` чувствителен к регистру; без учёта регистра — `ILIKE` (расширение PostgreSQL).

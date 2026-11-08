## Операции над множествами

Склеивают результаты двух `SELECT` **по вертикали** (строки под строками).

| Оператор | Результат | Дубликаты |
|---|---|---|
| `UNION` | строки из A **или** B | удаляет |
| `UNION ALL` | строки из A и B подряд | оставляет, работает быстрее |
| `INTERSECT` | строки, которые есть **и** в A, **и** в B | удаляет |
| `INTERSECT ALL` | то же, сохраняя кратность | оставляет |
| `EXCEPT` | строки из A, которых **нет** в B | удаляет |
| `EXCEPT ALL` | то же, вычитая по количеству | оставляет |

Правила:

- В обоих запросах — **одинаковое число колонок** с совместимыми типами.
- **Имена колонок** берутся из первого запроса — алиасы задаём там.
- `ORDER BY` пишется **один раз в конце** и сортирует весь результат.

```sql
SELECT id AS object_id, pizza_name AS object_name FROM menu
UNION
SELECT id, name FROM person
ORDER BY object_id, object_name;
```

> `A UNION A` или `A INTERSECT A` возвращает уникальные строки A — способ убрать дубликаты без `DISTINCT` (ex02).

### Свой порядок блоков

`ORDER BY` сортирует всё вместе. Чтобы сначала шли строки из одной таблицы, добавь служебную колонку и сортируй по ней:

```sql
SELECT object_name
FROM (
  SELECT name AS object_name, 1 AS sort_order FROM person
  UNION ALL
  SELECT pizza_name, 2 FROM menu
) AS t
ORDER BY sort_order, object_name;
```

## JOIN — склейка по горизонтали

JOIN добавляет к строке колонки из другой таблицы.

| Тип | Что делает | Строк в результате |
|---|---|---|
| `CROSS JOIN` | каждая строка A с каждой строкой B (декартово произведение) | `count(A) × count(B)` |
| `INNER JOIN … ON` | только пары, где выполнено условие | ≤ `count(A) × count(B)` |
| `NATURAL JOIN` | `INNER JOIN` по **всем** колонкам с одинаковыми именами | зависит от данных |

```sql
SELECT po.order_date,
       p.name || ' (age:' || p.age || ')' AS person_information
FROM person_order AS po
INNER JOIN person AS p ON po.person_id = p.id
ORDER BY po.order_date, person_information;
```

- `INNER JOIN` и просто `JOIN` — одно и то же.
- Алиасы таблиц (`po`, `p`) обязательны на практике: без них в `ON` и `SELECT` будет путаница одноимённых колонок `id`, `name`.
- JOIN можно цеплять: `person_order → person`, `person_order → menu → pizzeria` (ex10).

> **NATURAL JOIN опасен:** условие соединения неявное. Добавили в таблицу колонку с совпадающим именем (например, `name`) — запрос молча начнёт соединять и по ней. В рабочем коде — `JOIN … ON`.

## Антисоединение: «чего нет в другой таблице»

Две записи одной задачи — пиццерии без визитов:

```sql
-- NOT IN
SELECT name FROM pizzeria
WHERE id NOT IN (SELECT pizzeria_id FROM person_visits);

-- NOT EXISTS
SELECT name FROM pizzeria AS p
WHERE NOT EXISTS (
  SELECT 1 FROM person_visits WHERE pizzeria_id = p.id
);
```

| | `NOT IN` | `NOT EXISTS` |
|---|---|---|
| Подзапрос | выполняется один раз, возвращает список | коррелированный, проверяет наличие строки |
| `NULL` в подзапросе | результат **пустой** | работает корректно |
| Что выбирать в подзапросе | нужную колонку | неважно — принято `SELECT 1` |

> Ловушка `NOT IN`: `id NOT IN (1, 2, NULL)` = `id <> 1 AND id <> 2 AND id <> NULL`. Последнее сравнение даёт `NULL`, поэтому строка не проходит никогда. Для антисоединения по умолчанию бери `NOT EXISTS`.

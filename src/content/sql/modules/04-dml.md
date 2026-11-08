## DML — изменение данных

| Команда | Что делает |
|---|---|
| `INSERT` | добавляет строки |
| `UPDATE` | меняет значения в существующих строках |
| `DELETE` | удаляет строки |

> DDL (`CREATE`, `ALTER`, `DROP`) меняет **структуру**, DML — **данные**. `SELECT` иногда тоже относят к DML.

## INSERT

Три формы:

```sql
-- одна строка
INSERT INTO menu (id, pizzeria_id, pizza_name, price)
VALUES (19, 2, 'greek pizza', 800);

-- несколько строк одним запросом
INSERT INTO person_visits (id, person_id, pizzeria_id, visit_date)
VALUES (…), (…);

-- результат SELECT
INSERT INTO person_order (id, person_id, menu_id, order_date)
SELECT …;
```

- Всегда перечисляй колонки: без списка вставка зависит от порядка колонок в таблице и сломается при `ALTER TABLE`.
- `INSERT … SELECT` вставляет сразу много строк — без `VALUES`.

### Значения из подзапросов вместо хардкода

`id` в разных базах разный. Надёжнее вычислять ключи и ссылки:

```sql
INSERT INTO menu (id, pizzeria_id, pizza_name, price)
VALUES (
  (SELECT MAX(id) + 1 FROM menu),
  (SELECT id FROM pizzeria WHERE name = 'Dominos'),
  'sicilian pizza',
  900
);
```

> Подзапрос в `VALUES` должен вернуть **одно** значение. Две пиццерии с именем `Dominos` — ошибка `more than one row returned by a subquery`.

> `MAX(id) + 1` годится для учебной БД. В продакшене две параллельные транзакции получат одинаковый `id`. Правильно — `SEQUENCE` или `GENERATED AS IDENTITY` (модуль 08).

## UPDATE

```sql
UPDATE menu
SET price = price * 0.9
WHERE pizza_name = 'greek pizza';
```

- В `SET` можно ссылаться на текущее значение колонки.
- **`UPDATE` без `WHERE` меняет все строки таблицы.** Перед запуском проверь условие тем же `SELECT … WHERE`.
- Если тип колонки целый, результат `price * 0.9` при записи округлится.

## DELETE

```sql
DELETE FROM person_order WHERE order_date = '2022-02-25';
DELETE FROM menu WHERE pizza_name = 'greek pizza';
```

- Без `WHERE` удаляются все строки.
- **Порядок важен из-за внешних ключей.** `person_order.menu_id` ссылается на `menu`. Пока есть заказы на пиццу, удалить её из меню нельзя: `violates foreign key constraint`. Сначала дочерние строки, потом родительские.
- `TRUNCATE table` очищает таблицу целиком быстрее `DELETE`, но без `WHERE`.

## Безопасный эксперимент

Изменения можно проверить и отменить в транзакции:

```sql
BEGIN;
UPDATE menu SET price = price * 0.9 WHERE pizza_name = 'greek pizza';
SELECT * FROM menu WHERE pizza_name = 'greek pizza';  -- смотрим результат
ROLLBACK;  -- отменяем; COMMIT — сохранить
```

Подробно про транзакции — модуль 10.

## Аналитика на множествах: «больше» и «только»

Модуль начинается с выборок, где важна разница `EXCEPT` и `EXCEPT ALL`:

| Задача | Оператор | Почему |
|---|---|---|
| «Женщины посещали **чаще**, чем мужчины» | `EXCEPT ALL` | вычитает по количеству: 3 женских визита − 1 мужской = пиццерия остаётся |
| «Заказывали **только** женщины» | `EXCEPT` | сравнивает наличие: хотя бы один мужской заказ — пиццерия исчезает |

Пиццерия в результате `EXCEPT ALL` может повториться, поэтому в ex03 снаружи стоит `DISTINCT`.

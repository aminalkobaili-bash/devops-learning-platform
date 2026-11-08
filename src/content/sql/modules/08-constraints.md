## Задача модуля

Добавить в схему таблицу персональных скидок `person_discounts`: скидка клиента в конкретной пиццерии зависит от числа его заказов там. Затем защитить таблицу ограничениями, задокументировать и автоматизировать генерацию `id`.

| Заказов в пиццерии | Скидка |
|---|---|
| 1 | 10.5% |
| 2 | 22% |
| 3 и больше | 30% |

## Ограничения целостности

| Ограничение | Что гарантирует |
|---|---|
| `PRIMARY KEY` | уникальность + `NOT NULL`, создаёт индекс |
| `FOREIGN KEY … REFERENCES` | значение есть в родительской таблице |
| `UNIQUE` | нет повторов (но `NULL` допускается несколько раз) |
| `NOT NULL` | значение обязательно |
| `CHECK (условие)` | произвольное правило для строки |
| `DEFAULT` | не ограничение, а значение, если колонку не указали в `INSERT` |

### Имена ограничений

```sql
CONSTRAINT fk_person_discounts_person_id
  FOREIGN KEY (person_id) REFERENCES person(id)
```

Без `CONSTRAINT имя` PostgreSQL придумает имя сам (`person_discounts_person_id_fkey`). Явное имя:

- понятно из текста ошибки, какое правило нарушено;
- позволяет удалить ограничение: `ALTER TABLE … DROP CONSTRAINT имя`.

Соглашение из модуля: `fk_` — внешний ключ, `ch_nn_` — проверка на `NOT NULL`, `ch_range_` — диапазон.

### Добавление к существующей таблице

```sql
ALTER TABLE person_discounts
  ADD CONSTRAINT ch_range_discount CHECK (discount BETWEEN 0 AND 100);

ALTER TABLE person_discounts
  ALTER COLUMN discount SET DEFAULT 0;
```

> Если в таблице уже есть строки, нарушающие правило, `ADD CONSTRAINT` упадёт с ошибкой `check constraint … is violated by some row`, и ограничение не добавится. Сначала чинят данные.

### CHECK пропускает NULL

`CHECK` отклоняет строку, только если условие **`false`**. Для `NULL` условие `NULL BETWEEN 0 AND 100` даёт `NULL` — и строка проходит.

```sql
-- обе проверки нужны
CHECK (discount IS NOT NULL)
CHECK (discount BETWEEN 0 AND 100)
```

> `CHECK (x IS NOT NULL)` и `ALTER COLUMN x SET NOT NULL` дают одинаковый эффект. `SET NOT NULL` — штатный способ: виден в `\d`, проверяется быстрее. `CHECK` удобен, когда нужно своё имя ограничения.

### Поведение FK при удалении родителя

| Опция | Что будет с дочерними строками |
|---|---|
| по умолчанию (`NO ACTION`) | удаление родителя запрещено |
| `ON DELETE CASCADE` | удаляются вместе с родителем |
| `ON DELETE SET NULL` | ссылка становится `NULL` |

## Расчёт: GROUP BY + CASE + ROW_NUMBER

```sql
INSERT INTO person_discounts (id, person_id, pizzeria_id, discount)
SELECT ROW_NUMBER() OVER () AS id,
       po.person_id,
       m.pizzeria_id,
       CASE
         WHEN COUNT(*) = 1 THEN 10.5
         WHEN COUNT(*) = 2 THEN 22
         ELSE 30
       END
FROM person_order po
JOIN menu m ON po.menu_id = m.id
GROUP BY po.person_id, m.pizzeria_id;
```

- `GROUP BY` по паре (клиент, пиццерия) — одна строка на пару, `COUNT(*)` — число заказов в ней.
- `CASE` над агрегатом превращает количество в процент.
- `ROW_NUMBER() OVER ()` — оконная функция: нумерует строки результата 1, 2, 3…. Пустой `OVER ()` — порядок не задан; для стабильной нумерации — `OVER (ORDER BY po.person_id, m.pizzeria_id)`.

## COMMENT ON — документация в самой БД

```sql
COMMENT ON TABLE person_discounts IS 'Personal discount rates per person and pizzeria';
COMMENT ON COLUMN person_discounts.discount IS 'Discount percentage';
```

- Комментарий видно в `\d+ person_discounts` и в любом GUI-клиенте.
- Прочитать запросом: `obj_description('person_discounts'::regclass)` для таблицы, `col_description('person_discounts'::regclass, номер_колонки)` для колонки.
- `COMMENT ON … IS NULL` удаляет комментарий.

## SEQUENCE — генератор номеров

```sql
CREATE SEQUENCE seq_person_discounts START 1;

ALTER TABLE person_discounts
  ALTER COLUMN id SET DEFAULT nextval('seq_person_discounts');
```

| Функция | Что делает |
|---|---|
| `nextval('s')` | увеличивает и возвращает следующее значение |
| `currval('s')` | последнее значение, выданное `nextval` в **этой сессии** |
| `setval('s', n)` | следующий `nextval` вернёт **`n + 1`** |
| `setval('s', n, false)` | следующий `nextval` вернёт **`n`** |

### Синхронизация с существующими данными

Если таблица уже заполнена, последовательность нужно сдвинуть за максимальный `id`:

```sql
SELECT setval('seq_person_discounts', (SELECT MAX(id) FROM person_discounts));
```

> Берут именно `MAX(id)`, а не `COUNT(*)`: при пропусках в нумерации (удалённые строки) `COUNT` меньше максимума, и `nextval` выдаст уже занятый `id`.

### Последовательность не откатывается

`nextval` в транзакции, которая потом сделала `ROLLBACK`, номер не возвращает. Поэтому в `id` бывают «дыры» — это нормально: последовательность гарантирует уникальность, а не непрерывность.

### SERIAL и IDENTITY

| Запись | Что под капотом |
|---|---|
| `id serial` | `integer` + своя последовательность + `DEFAULT nextval(…)` |
| `id bigint GENERATED ALWAYS AS IDENTITY` | стандарт SQL, PostgreSQL 10+; явный `id` в `INSERT` запрещён без `OVERRIDING SYSTEM VALUE` |

Для новых таблиц рекомендуют `IDENTITY`. Ручной `SEQUENCE` + `DEFAULT` из модуля — то же самое, собранное руками: полезно понимать, как это устроено.

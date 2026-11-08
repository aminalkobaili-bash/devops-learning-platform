## Представление (VIEW)

`VIEW` — сохранённый под именем `SELECT`. Данных не хранит: при каждом обращении запрос выполняется заново.

```sql
CREATE VIEW v_persons_female AS
SELECT *
FROM person
WHERE gender = 'female';

SELECT name FROM v_persons_female;  -- работает как таблица
```

Зачем:

- **Переиспользование** — сложный JOIN пишется один раз, дальше `SELECT * FROM v_…`.
- **Упрощение** — потребитель видит готовые колонки, а не пять соединённых таблиц.
- **Ограничение доступа** — права выдают на view, а не на исходные таблицы: пользователь видит только нужные строки и колонки.

| Команда | Что делает |
|---|---|
| `CREATE VIEW v AS …` | создать |
| `CREATE OR REPLACE VIEW v AS …` | пересоздать; можно добавить колонки в конец, но не удалить и не поменять тип |
| `DROP VIEW v1, v2` | удалить одно или несколько |
| `DROP VIEW IF EXISTS v` | без ошибки, если view нет — скрипт можно перезапускать |

> Таблицу, на которой построено представление, нельзя удалить: `cannot drop table … because other objects depend on it`. Сначала `DROP VIEW` или `DROP TABLE … CASCADE` (удалит и view).

### ORDER BY внутри VIEW

`ORDER BY` в определении view допустим, но порядок гарантирован только при простом `SELECT * FROM v`. Как только снаружи появляется `JOIN`, `UNION`, `GROUP BY`, планировщик может его перестроить. Сортировку пишут **во внешнем запросе**.

## Вычисляемые колонки и приведение типов

```sql
CREATE VIEW v_price_with_discount AS
SELECT p.name,
       m.pizza_name,
       m.price,
       (m.price - m.price * 0.1)::integer AS discount_price
FROM person p
JOIN person_order po ON p.id = po.person_id
JOIN menu m ON po.menu_id = m.id;
```

- `price * 0.1` даёт `numeric` с дробной частью.
- `::integer` **округляет** до ближайшего целого (0.5 — от нуля), а не отбрасывает дробь: `787.5::integer = 788`.
- Отбросить дробь — `trunc()`, округлить вниз — `floor()`.

## Симметрическая разность

Элементы, которые есть **ровно в одном** из двух множеств: `(R − S) ∪ (S − R)`.

```sql
(
  SELECT person_id FROM person_visits WHERE visit_date = '2022-01-02'
  EXCEPT
  SELECT person_id FROM person_visits WHERE visit_date = '2022-01-06'
)
UNION
(
  SELECT person_id FROM person_visits WHERE visit_date = '2022-01-06'
  EXCEPT
  SELECT person_id FROM person_visits WHERE visit_date = '2022-01-02'
);
```

Скобки обязательны: без них `EXCEPT` и `UNION` выполнятся цепочкой слева направо.

## Материализованное представление

`MATERIALIZED VIEW` выполняет запрос **один раз** и сохраняет результат на диск, как таблицу.

| | `VIEW` | `MATERIALIZED VIEW` |
|---|---|---|
| Хранит данные | нет | да |
| Свежесть | всегда актуально | снимок на момент создания или `REFRESH` |
| Скорость чтения | как исходный запрос | как чтение таблицы |
| Индексы | нельзя | можно |
| Обновление | не нужно | `REFRESH MATERIALIZED VIEW mv` |

```sql
CREATE MATERIALIZED VIEW mv_dmitriy_visits_and_eats AS
SELECT pz.name AS pizzeria_name
FROM person_visits pv
JOIN person p ON pv.person_id = p.id
JOIN pizzeria pz ON pv.pizzeria_id = pz.id
WHERE p.name = 'Dmitriy'
  AND pv.visit_date = '2022-01-08'
  AND EXISTS (
    SELECT 1 FROM menu m
    WHERE m.pizzeria_id = pz.id AND m.price < 800
  );

-- после изменения исходных таблиц
REFRESH MATERIALIZED VIEW mv_dmitriy_visits_and_eats;
```

- `REFRESH` блокирует чтение MV на время пересчёта.
- `REFRESH MATERIALIZED VIEW CONCURRENTLY mv` не блокирует читателей, но требует **уникальный индекс** на MV.
- Когда использовать: тяжёлые отчёты и агрегаты, которым допустимо отставать (обновление по расписанию, например cron).

> `EXISTS` вместо `JOIN menu` — проверка «есть хотя бы одна пицца дешевле 800» без размножения строк. Тот же запрос через `JOIN` в модуле 03 (ex07) мог вернуть пиццерию несколько раз.

## Порядок удаления объектов

Зависимые объекты удаляются раньше тех, от которых они зависят: сначала тестовые данные и view, потом — если нужно — таблицы.

```sql
DROP VIEW v_persons_female;
DROP MATERIALIZED VIEW mv_dmitriy_visits_and_eats;
```

`DROP VIEW` не удаляет материализованное представление — для него отдельная команда.

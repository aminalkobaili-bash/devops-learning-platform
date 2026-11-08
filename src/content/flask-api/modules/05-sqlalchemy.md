## Движок, сессии, базовый класс

```python
# database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

class Base(DeclarativeBase):
    pass
```

| Объект | Что это |
|---|---|
| `engine` | пул соединений с БД, один на приложение |
| `sessionmaker` | фабрика сессий с заданными настройками |
| `Session` | единица работы: набор изменений, который фиксируется одним `commit()` |
| `Base` | базовый класс ORM-моделей, хранит метаданные всех таблиц |

`echo=True` печатает каждый SQL-запрос — удобно для отладки.

> `class Base(DeclarativeBase)` — стиль SQLAlchemy 2.0. Старый `Base = declarative_base()` в 2.0 помечен как legacy — в проекте заменён после ревью.

## ORM-модель

```python
class Game(Base):
    __tablename__ = "games"

    uuid = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    field_matrix = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    player1_uuid = Column(PG_UUID(as_uuid=True), ForeignKey("users.uuid"), nullable=True)
    winner_uuid = Column(PG_UUID(as_uuid=True), ForeignKey("users.uuid"), nullable=True)
    status = Column(Enum(GameStatus), nullable=False, default=GameStatus.WAITING)
```

| Колонка | Тип в PostgreSQL | Заметка |
|---|---|---|
| `PG_UUID(as_uuid=True)` | `uuid` | в Python — объект `uuid.UUID`, не строка |
| `JSON` | `json` | поле 3×3 целиком; `JSONB` — бинарный, индексируемый вариант |
| `DateTime(timezone=True)` | `timestamp with time zone` | хранит момент времени в UTC |
| `Enum(GameStatus)` | создаёт тип `ENUM` в PostgreSQL | |
| `ForeignKey("users.uuid")` | внешний ключ | `player2_uuid`, `winner_uuid` — `NULL` для компьютера |

> Новый стиль 2.0 — `Mapped[...]` и `mapped_column()`: `uuid: Mapped[UUID] = mapped_column(primary_key=True)`. Типы Python тогда видны IDE и mypy.

## Время с часовым поясом

```python
created_at = datetime.now(timezone.utc)   # было: datetime.utcnow()
```

- `datetime.utcnow()` возвращает **naive** datetime — без информации о поясе. В Python 3.12 помечен deprecated.
- `datetime.now(timezone.utc)` — **aware** datetime с `tzinfo=UTC`.
- Колонка поменяна на `timestamp with time zone`. Без этого aware-время записывалось бы в колонку без пояса и при чтении теряло `tzinfo`.

## Паттерн работы с сессией

```python
def save(self, game: Game) -> None:
    session = self.session_factory()
    try:
        orm_game = session.query(ORMGame).filter(ORMGame.uuid == game.uuid).first()
        if orm_game:
            orm_game.field_matrix = game.field.matrix
            …
        else:
            session.add(game_to_orm(game))
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
```

| Шаг | Зачем |
|---|---|
| `commit()` | зафиксировать транзакцию |
| `rollback()` при ошибке | откатить, чтобы сессия не осталась в сломанном состоянии |
| `raise` | не проглатывать исключение — пусть дойдёт до обработчика |
| `close()` в `finally` | вернуть соединение в пул в любом случае |

Короче то же самое в стиле 2.0:

```python
with SessionLocal() as session, session.begin():
    session.add(obj)       # commit при выходе, rollback при исключении
```

## Query API: legacy и 2.0

| Legacy (в проекте) | Стиль 2.0 |
|---|---|
| `session.query(Game).filter(Game.uuid == u).first()` | `session.scalars(select(Game).where(Game.uuid == u)).first()` |
| `session.query(Game).get(u)` | `session.get(Game, u)` |
| `query.filter(a).filter(b).all()` | `session.scalars(select(Game).where(a, b)).all()` |

`session.query()` в 2.0 работает, но считается legacy — отмечено в README как future work.

## Условия в запросах

```python
query = session.query(ORMGame).filter(
    (ORMGame.player1_uuid == user_uuid) | (ORMGame.player2_uuid == user_uuid)
)
query = query.filter(ORMGame.status.in_([GameStatus.WON, GameStatus.DRAW]))
```

- `|` и `&` — SQL `OR` и `AND` (или `or_()`, `and_()`). Python-операторы `or` и `and` здесь **не работают**: они не перегружаются.
- `.in_([...])` — SQL `IN`.
- `== None` / `.is_(None)` — SQL `IS NULL`.

## create_all и миграции

```python
Base.metadata.create_all(engine)
```

Создаёт **отсутствующие** таблицы при старте. Существующие **не изменяет**: добавил колонку в модель — в БД её не будет. Поэтому README требует пересоздать базу после изменения `created_at`.

Для рабочих проектов — миграции **Alembic**:

```bash
alembic revision --autogenerate -m "created_at with time zone"
alembic upgrade head
```

Каждое изменение схемы — версионируемый скрипт `upgrade` / `downgrade` в git, применяется одинаково на всех окружениях.

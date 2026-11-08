## Три слоя

```
web/          маршруты, обработчики, DTO запросов и ответов, JWT
   │  зависит от
   ▼
domain/       модели Game, GameField, User; сервисы; исключения
   ▲  реализует интерфейсы репозиториев
   │
datasource/   ORM-модели SQLAlchemy, мапперы ORM ↔ domain, репозитории PostgreSQL
```

| Слой | Знает про | Не знает про |
|---|---|---|
| **web** | HTTP, JSON, Flask, `request`, коды ответов | как хранятся данные |
| **domain** | правила игры, пользователей, ошибки предметной области | HTTP и SQL |
| **datasource** | SQLAlchemy, таблицы, PostgreSQL | HTTP |

Зачем: правила игры можно тестировать без БД и Flask; заменить PostgreSQL на другое хранилище — переписать только `datasource`; поменять REST на gRPC — только `web`. В v1 проекта хранилище было в памяти, в v2 стало PostgreSQL — domain при этом почти не менялся.

## Поток запроса «сделать ход»

```
POST /game/<uuid>  {"field": [[…]]}
  → route.update_game
  → handlers.update_game_handler      UUID и JSON → domain GameField
  → GameServiceImpl.make_move         проверка хода, победа/ничья, ход компьютера
  → PostgresGameRepository.get/save   domain Game ↔ ORM Game ↔ строка в таблице
  ← game_to_response(game)            domain Game → JSON-ответ
```

## Три модели одной игры

| Модель | Где | Для чего |
|---|---|---|
| `datasource/orm/game.py` | ORM | соответствует таблице `games`, колонки SQLAlchemy |
| `domain/model/game.py` | domain | dataclass с бизнес-полями, без зависимости от SQLAlchemy |
| `web/model/response.py` | web (DTO) | что отдаётся клиенту в JSON |

**Мапперы** переводят одну модель в другую:

```python
def game_to_domain(orm_game: ORMGame) -> Game:
    return Game(
        uuid=orm_game.uuid,
        field=GameField(matrix=orm_game.field_matrix),
        created_at=orm_game.created_at,
        …
    )
```

Кажется дублированием, но так изменения схемы БД или формата API не протекают в бизнес-логику. Например, хеш пароля есть в ORM и domain, но не попадает в ответ `/users/me` — DTO его просто не содержит.

## Интерфейсы и реализации

```python
class GameRepository(ABC):          # интерфейс
    @abstractmethod
    def get(self, uuid: UUID) -> Game: ...

class PostgresGameRepository(GameRepository):   # реализация
    def get(self, uuid: UUID) -> Game: …
```

Сервис зависит от **интерфейса**, а конкретную реализацию ему передают снаружи (dependency injection):

```python
class GameServiceImpl(GameService):
    def __init__(self, repository: GameRepository):
        self.repository = repository
```

В тесте можно передать `InMemoryGameRepository` — сервис не заметит разницы.

## DI-контейнер

```python
class Container:
    def get_repository(self) -> GameRepository:
        if self._game_repository is None:
            self._game_repository = PostgresGameRepository(SessionLocal)
        return self._game_repository

    def get_service(self) -> GameService:
        if self._game_service is None:
            self._game_service = GameServiceImpl(self.get_repository())
        return self._game_service
```

- Единственное место, где собирается граф объектов и выбираются конкретные классы.
- Ленивое создание: объект создаётся при первом запросе и переиспользуется (один экземпляр на приложение).

## Ошибки домена → HTTP-коды

```python
class DomainError(Exception): ...
class InvalidMoveError(DomainError): ...
class GameNotFoundError(DomainError): ...
class WrongPlayerTurnError(DomainError): ...
```

Domain бросает свои исключения, `web` переводит их в коды:

```python
try:
    game = service.get_game(game_uuid)
except GameNotFoundError:
    return ErrorResponse("Game not found").to_json(), 404
except DomainError as e:
    return ErrorResponse(str(e)).to_json(), 400
```

> **Порядок `except` важен.** `GameNotFoundError` — наследник `DomainError`. Если ловить сначала `DomainError`, до `GameNotFoundError` дело не дойдёт.

### Найденная неточность

В `update_game_handler` и `join_game_handler` нет отдельного `except GameNotFoundError` — только общий `DomainError`. Поэтому ход или `join` в несуществующую игру возвращают **400**, а `GET /games/<uuid>` для той же игры — **404**. Исправление — добавить `except GameNotFoundError: … 404` первым, как в `get_game_handler`. Ещё лучше — один `@app.errorhandler(DomainError)` с таблицей «класс исключения → код», вместо повторов в каждом обработчике.

## Нарушение направления зависимостей

По схеме domain не должен ничего знать о datasource. В проекте:

```python
# domain/service/impl.py
from datasource.repository.interface import GameRepository, UserRepository
from datasource.repository.exceptions import DuplicateRepositoryError
```

Интерфейсы репозиториев лежат в `datasource`, и domain импортирует их оттуда — 7 связей `domain → datasource` по графу зависимостей (README). По чистой архитектуре интерфейс принадлежит тому, кто его **использует**: `GameRepository` должен жить в `domain`, а `datasource` — реализовывать его (dependency inversion, буква D в SOLID).

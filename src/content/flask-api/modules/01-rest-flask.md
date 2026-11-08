## REST за 5 минут

REST API — набор **ресурсов** (пользователи, игры) по URL, с которыми работают HTTP-методами. Данные — в JSON.

| Метод | Смысл | Идемпотентен? |
|---|---|---|
| `GET` | прочитать | да |
| `POST` | создать / выполнить действие | нет |
| `PUT` | заменить целиком | да |
| `PATCH` | изменить часть | не обязательно |
| `DELETE` | удалить | да |

Идемпотентность — повтор запроса не меняет результат. Два одинаковых `POST /games` создадут **две** игры.

### Эндпоинты проекта

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/signup`, `/login` | регистрация, вход |
| POST | `/refresh/access`, `/refresh/refresh` | обновление токенов |
| GET | `/users/me`, `/users/<uuid>` | пользователь |
| POST / GET | `/games` | создать игру / список ожидающих |
| POST | `/games/<uuid>/join` | присоединиться |
| GET | `/games/<uuid>` | состояние игры |
| POST | `/game/<uuid>` | ход |
| GET | `/games/history`, `/leaderboard?limit=N` | история, рейтинг |

> Ход — `POST /game/<uuid>` (единственное число), а остальное — `/games/…`. Так сложилось из v1. По REST-конвенции ресурс называют во множественном числе, а ход — подресурс: `POST /games/<uuid>/moves`.

## HTTP-коды ответов

| Код | Когда в проекте |
|---|---|
| `200 OK` | успешное чтение, ход, вход |
| `201 Created` | регистрация, создание игры |
| `400 Bad Request` | неверный JSON, не-UUID в пути, поле не 3×3, ход не в свою очередь |
| `401 Unauthorized` | нет токена, неверный токен, неверный пароль |
| `404 Not Found` | игра или пользователь не найдены — в `GET`; при ходе и `join` несуществующая игра даёт `400` (модуль 03) |

Остальные важные: `403 Forbidden` — аутентифицирован, но нет прав; `409 Conflict` — конфликт состояния (например, логин уже занят); `422 Unprocessable Entity` — JSON корректен, но данные не проходят валидацию; `500` — необработанное исключение на сервере.

> В проекте повторная регистрация занятого логина и ход не в свою очередь возвращают `400`. Точнее было бы `409 Conflict` — но `400` тоже не ошибка, многие API так делают.

## Маршрут во Flask

```python
@app.route("/games/<uuid_str>", methods=["GET"])
def get_game(uuid_str):
    data, status = get_game_handler(service, uuid_str)
    return jsonify(data), status
```

- `<uuid_str>` — часть пути попадает в аргумент функции. Конвертер `<uuid:game_id>` сам проверил бы формат и вернул 404 на не-UUID.
- `methods=["GET"]` — какие методы принимает маршрут. На другой метод Flask ответит `405 Method Not Allowed`.
- Возврат `(тело, код)` — Flask соберёт ответ. `jsonify` превращает dict в JSON с `Content-Type: application/json`; просто вернуть dict тоже можно.

Чтение тела запроса:

```python
json_data = request.get_json()
if not json_data:
    return ErrorResponse("Invalid JSON").to_json(), 400
```

`request.args.get("limit")` — параметры query-строки (`?limit=10`).

> `GET /games/history` и `GET /games/<uuid_str>`: Flask проверяет статические части пути раньше переменных, поэтому `history` не будет принят за UUID.

## App factory

```python
def create_app():
    app = Flask(__name__)
    app.config.from_object(config)
    jwt = JWTManager(app)
    Base.metadata.create_all(engine)
    container = Container()
    …
    register_routes(app, …)
    return app

if __name__ == "__main__":
    app = create_app()
    app.run(debug=os.getenv("FLASK_DEBUG") == "1")
```

Приложение создаётся функцией, а не глобальной переменной:

- в тестах можно создать приложение с другой конфигурацией (тестовая БД);
- WSGI-сервер вызывает фабрику: `gunicorn "main:create_app()"`.

## before_request: общая проверка для всех маршрутов

```python
@app.before_request
def authenticate():
    if request.endpoint in ["signup", "login", "refresh_access", "refresh_refresh"]:
        return
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return {"error": "Unauthorized", "message": "Bearer token required"}, 401
    token = auth_header.split(" ")[1]
    user_uuid = jwt_provider.validate_access_token(token)
    g.user_uuid = user_uuid
```

- Функция выполняется **перед каждым** запросом. Если она что-то вернула — обработчик маршрута не вызывается, клиент получает этот ответ.
- `request.endpoint` — имя функции маршрута (`signup`, `login`…), по нему пропускаются публичные маршруты.
- `g` — объект на время одного запроса. Сюда кладётся `user_uuid`, обработчики читают `g.user_uuid`.

> Подход «всё закрыто, кроме белого списка» безопаснее, чем ставить проверку на каждый маршрут: новый маршрут, про который забыли, автоматически требует токен.

## Формат ошибок

Все ошибки — единый JSON:

```json
{"error": "Move failed", "details": "It's not your turn"}
```

Клиенту не нужно гадать, где искать текст ошибки.

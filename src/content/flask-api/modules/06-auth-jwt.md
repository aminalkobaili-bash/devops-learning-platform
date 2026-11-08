## Пароли: только хеш

```python
from werkzeug.security import generate_password_hash, check_password_hash

user = User(uuid=uuid4(), login=login, password=generate_password_hash(password))
…
if user is None or not check_password_hash(user.password, password):
    raise DomainError("Invalid login or password")
```

В БД после исправления:

```
scrypt:32768:8:1$<соль>$<хеш>
```

| Часть | Значение |
|---|---|
| `scrypt` | алгоритм (по умолчанию в Werkzeug 3) |
| `32768:8:1` | параметры стоимости: N, r, p — сколько памяти и вычислений нужно на одну проверку |
| соль | случайная строка, своя для каждого пароля |
| хеш | результат |

Почему не `sha256(password)`:

| Свойство | Зачем |
|---|---|
| **соль** | одинаковые пароли дают разные хеши; готовые таблицы хешей (rainbow tables) бесполезны |
| **медленный алгоритм** | вход пользователя — доли секунды, перебор миллиардов паролей — годы |
| **требует память** (scrypt) | перебор на видеокартах дорогой |

Подходящие алгоритмы: `scrypt`, `argon2`, `bcrypt`. Быстрые хеши (`md5`, `sha*`) для паролей не годятся.

> До ревью пароли хранились **открытым текстом** и сравнивались через `!=`. Утечка базы = утечка паролей, которые люди повторяют на других сайтах.

> Сообщение `Invalid login or password` одинаковое для «нет пользователя» и «неверный пароль» — так нельзя по ответу проверить, существует ли логин.

## JWT

JSON Web Token — строка из трёх частей через точку:

```
eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOiI…IiwidHlwZSI6ImFjY2VzcyJ9 . SflKxwRJSMeKKF2QT4fwpM…
       header                       payload                         signature
```

| Часть | Что внутри |
|---|---|
| header | алгоритм подписи: `HS256` |
| payload | claims: `sub` (uuid пользователя), `type` (`access` / `refresh`), `exp` (истекает), `iat`, `jti` |
| signature | HMAC от header + payload с секретом `JWT_SECRET_KEY` |

- Header и payload — **base64url, а не шифрование**. Любой может их прочитать (jwt.io). Пароли и секреты в токен не кладут.
- Подпись защищает от **подделки**: изменить payload без секрета нельзя — подпись не сойдётся.
- Сервер ничего не хранит: проверил подпись и `exp` — знает, кто пользователь (stateless).

## Access и refresh

| | access | refresh |
|---|---|---|
| Срок | 15 минут | 7 дней |
| Для чего | заголовок `Authorization: Bearer …` в каждом запросе | только получить новый access на `/refresh/*` |
| Если украден | ущерб ограничен 15 минутами | можно выпускать access-токены неделю |

```bash
POST /login               → {type, accessToken, refreshToken}
POST /refresh/access      {refreshToken} → новый access, refresh тот же
POST /refresh/refresh     {refreshToken} → новая пара
```

## Найденная уязвимость: тип токена не проверялся

flask-jwt-extended кладёт в каждый токен claim `type`. Раньше проект его не проверял: refresh-токен (7 дней) принимался как access, а access — на `/refresh/*`. Смысл короткого access-токена терялся.

Исправление:

```python
def _extract_uuid_from_token(self, token: str, expected_type: str) -> UUID:
    try:
        data = decode_token(token)                 # проверяет подпись и exp
    except Exception as e:
        raise JwtError(f"Invalid token: {e}")
    if data.get("type") != expected_type:
        raise JwtError(f"Invalid token type: expected {expected_type} token")
    identity = data.get("sub")
    …
    return UUID(identity)
```

| Проверка | Результат |
|---|---|
| refresh-токен на `/users/me` | 401 |
| access-токен на `/refresh/access` | 401 `Invalid token type: expected refresh token` |

## Ограничение: отзыв токенов

JWT нельзя «удалить» — он валиден до `exp`. После `/refresh/refresh` старый refresh-токен продолжает работать ещё до 7 дней, и logout технически невозможен.

Решение — **blocklist**: хранить `jti` отозванных токенов (Redis или таблица) и проверять при каждом запросе:

```python
@jwt.token_in_blocklist_loader
def check_if_revoked(jwt_header, jwt_payload) -> bool:
    return redis.exists(f"revoked:{jwt_payload['jti']}")
```

Это возвращает часть состояния на сервер — компромисс между stateless и контролем. Отмечено в README как future work.

> Проект проверяет токены в своём `before_request` через `decode_token`, а не декоратором `@jwt_required()`. Поэтому `token_in_blocklist_loader` нужно будет вызывать и там — сам он сработает только с механизмами flask-jwt-extended.

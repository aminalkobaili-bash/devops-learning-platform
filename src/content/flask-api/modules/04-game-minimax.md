## Поле

```python
@dataclass
class GameField:
    matrix: list[list[int]]

    def __post_init__(self):
        if len(self.matrix) != 3 or any(len(row) != 3 for row in self.matrix):
            raise ValueError("Field must be 3x3")
        for row in self.matrix:
            for cell in row:
                if cell not in (0, 1, 2):
                    raise ValueError("Cell values must be 0, 1 or 2")
```

`0` — пусто, `1` — игрок 1 (X), `2` — игрок 2 или компьютер (O). `__post_init__` вызывается после автоматического `__init__` dataclass — объект с неверным полем просто не создастся.

## Ход: клиент присылает всё поле

```json
{"field": [[0,0,0],[0,1,0],[0,0,0]]}
```

Сервер сравнивает новое поле со старым:

```python
changes = 0
for r in range(3):
    for c in range(3):
        if old[r][c] != new[r][c]:
            if old[r][c] != 0 or new[r][c] != expected_symbol:
                raise InvalidMoveError(f"Invalid change at ({r},{c})")
            changes += 1
if changes != 1:
    raise InvalidMoveError("Exactly one move required")
```

| Проверка | Ловит |
|---|---|
| изменилась клетка, которая не была пустой | стёрли или заменили чужой ход |
| в клетку поставлен не тот символ | ход за соперника |
| изменений не ровно одно | ноль ходов или несколько сразу |

> **Никогда не доверяй состоянию от клиента.** Клиент мог прислать любое поле. Сервер хранит своё и принимает только допустимую разницу.

Перед этим — проверки игры:

| Условие | Исключение | Код |
|---|---|---|
| статус не `IN_PROGRESS` | `GameOverError` | 400 |
| `current_turn_uuid` ≠ игрок из токена | `WrongPlayerTurnError` | 400 |

## Победа и ничья

```python
lines = []
lines.extend(field)                                            # 3 строки
for col in range(3):
    lines.append([field[0][col], field[1][col], field[2][col]])  # 3 столбца
lines.append([field[0][0], field[1][1], field[2][2]])          # диагональ
lines.append([field[0][2], field[1][1], field[2][0]])          # антидиагональ

for line in lines:
    if line[0] != 0 and len(set(line)) == 1:
        return GameStatus.WON, …
if game.field.is_full():
    return GameStatus.DRAW, None
```

8 линий. `len(set(line)) == 1` — все три клетки одинаковые, `line[0] != 0` — и не пустые.

## Состояния игры

```
         create(human)            join
WAITING ──────────────► IN_PROGRESS ──────► WON / DRAW
            create(computer) ─┘
```

| Тип | Создание | Очерёдность |
|---|---|---|
| `computer` | сразу `IN_PROGRESS`, ход игрока | компьютер отвечает в том же запросе |
| `human` | `WAITING`, второй игрок `null` | после `join` — по очереди, `current_turn_uuid` |

## Minimax

Алгоритм для игр двух соперников с полной информацией. Компьютер перебирает **все** возможные продолжения до конца игры и выбирает ход, лучший при **оптимальной игре соперника**.

```python
def _minimax(self, field, depth, is_maximizing):
    finished, winner = …
    if finished:
        if winner == 2:   return 10 - depth    # компьютер выиграл
        elif winner == 1: return -10 + depth   # человек выиграл
        else:             return 0             # ничья
    if is_maximizing:                          # ход компьютера: максимум
        return max(self._minimax(after(field, cell, 2), depth + 1, False) for cell in empty)
    else:                                      # ход человека: минимум
        return min(self._minimax(after(field, cell, 1), depth + 1, True) for cell in empty)
```

(псевдокод, сокращённая запись кода проекта)

| Элемент | Зачем |
|---|---|
| максимизирующий игрок | компьютер выбирает ход с наибольшей оценкой |
| минимизирующий игрок | считается, что человек выберет худший для компьютера ход |
| `10 − depth` | быстрая победа лучше медленной |
| `−10 + depth` | если проигрыш неизбежен — оттянуть его |

`get_next_move` для каждой пустой клетки ставит туда `2`, вызывает `_minimax(…, is_maximizing=False)` (дальше ходит человек) и берёт клетку с максимальной оценкой.

### Проверка: компьютер не проигрывает

Крестики-нолики — решённая игра: при идеальной игре обеих сторон — ничья. Полный перебор всех стратегий человека против minimax проекта (при подготовке модуля):

| Исход | Партий |
|---|---|
| победа человека | **0** |
| победа компьютера | 386 |
| ничья | 183 |

### Стоимость перебора

На пустом поле после первого хода человека осталось 8 клеток — до 8! = 40 320 вариантов продолжений. Для 3×3 мгновенно, для 4×4 уже 15! ≈ 1.3 трлн — нужны отсечения (**alpha-beta pruning**), ограничение глубины и эвристическая оценка позиции.

> В коде `for row, col in empty:` внутри содержит `new_matrix = [list(row) for row in field.matrix]` — то же имя `row` в list comprehension. Работает, потому что у comprehension в Python 3 своя область видимости, но читать тяжело: лучше `[list(r) for r in field.matrix]`.

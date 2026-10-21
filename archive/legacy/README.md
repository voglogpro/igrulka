# Исторический прототип

`engine.js` и `world.js` относятся к прежней пошаговой игре. Их используют только `tests/legacy/engine.test.mjs` и `tests/legacy/surfaces.test.mjs` для прежних регрессий. Основная игра начинается в `src/main.js` и не импортирует эту папку.

Текущие правила изменяйте в `src/game/`, графику — в `src/rendering/`. Старые планы находятся в `docs/history/`.

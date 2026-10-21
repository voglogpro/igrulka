# Небесный рубеж

3D-стратегия в реальном времени: строительство города, дорожное снабжение, экономика, налёты, ПВО, пехота и техника. Текущая игровая версия — **8.0.1**.

## Как играть

Скачайте репозиторий через **Code → Download ZIP**, распакуйте и откройте `Играть.cmd` или [play/Skyfront.html](play/Skyfront.html) в Chrome/Edge. Готовый HTML уже включён: интернет, Node.js и установка пакетов для игры не нужны.

Управление: WASD — движение камеры, перетаскивание ПКМ — ракурс, колесо — масштаб, пробел — пауза. Рамка ЛКМ выделяет армию, Ctrl+1…9 сохраняет группы. Подробные правила и клавиши — в [руководстве игрока](docs/GAMEPLAY.md).

## Как разрабатывать

Нужен Node.js 24 или новее:

```sh
npm ci
npm start
```

Сервер напечатает адрес `http://127.0.0.1:8787` и на Windows откроет игру. После изменения исходников обновите вкладку. Остановка сервера — Ctrl+C.

```sh
npm run check        # форматирование, анализ кода, тесты, сборка
npm run build        # обновить готовую игру play/Skyfront.html
npm run format       # привести исходники к общему оформлению
```

## Где менять код

| Что изменить                                | Файл или папка                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| Цена, здоровье, урон и роли солдат          | [src/game/units/infantry/types.js](src/game/units/infantry/types.js)                   |
| Характеристики Leopard, БТР, Шилки и Gepard | [src/game/units/vehicles/types.js](src/game/units/vehicles/types.js)                   |
| Вид солдат и их анимация                    | [src/rendering/models/infantry/soldiers.js](src/rendering/models/infantry/soldiers.js) |
| Вид танка Leopard                           | [src/rendering/models/vehicles/leopard.js](src/rendering/models/vehicles/leopard.js)   |
| Вид БТР                                     | [src/rendering/models/vehicles/apc.js](src/rendering/models/vehicles/apc.js)           |
| Вид Шилки и Gepard                          | [src/rendering/models/vehicles/anti-air.js](src/rendering/models/vehicles/anti-air.js) |
| Посадка и высадка                           | [src/game/units/vehicles/transport.js](src/game/units/vehicles/transport.js)           |
| Приказы и группы армии                      | [src/game/units/ground/orders.js](src/game/units/ground/orders.js)                     |
| Укрытия и маскировка                        | [src/game/units/infantry/cover.js](src/game/units/infantry/cover.js)                   |
| Окопы, лечение и сапёры                     | [src/game/units/infantry/support.js](src/game/units/infantry/support.js)               |
| Запуск FPV оператором                       | [src/game/units/infantry/fpv.js](src/game/units/infantry/fpv.js)                       |
| Дроны, ракеты, производство и полёт         | [src/game/units/aviation/](src/game/units/aviation/)                                   |
| ПВО, перезарядка, снаряды и урон            | [src/game/combat/](src/game/combat/)                                                   |
| Экономика, дороги и строительство           | [src/game/city/](src/game/city/)                                                       |
| Исследования                                | [src/game/research/](src/game/research/)                                               |
| Поведение бота                              | [src/game/ai/](src/game/ai/)                                                           |
| Камера и WASD                               | [src/rendering/camera.js](src/rendering/camera.js), [world.js](src/rendering/world.js) |
| Солнце, освещение и смена суток             | [src/rendering/lighting.js](src/rendering/lighting.js), [clock.js](src/game/clock.js)  |
| Взрывы, трассеры, дым                       | [src/rendering/effects/combat-effects.js](src/rendering/effects/combat-effects.js)     |
| Звук                                        | [src/audio/game-audio.js](src/audio/game-audio.js)                                     |
| Меню, инспектор и оформление                | [src/ui/](src/ui/)                                                                     |
| Сохранения и обновление старых кампаний     | [src/game/persistence/saves.js](src/game/persistence/saves.js)                         |

Полная навигация с пояснениями — [карта кода](docs/CODE_MAP.md). Перед изменениями читайте [AGENTS.md](AGENTS.md) и [инструкцию разработчика](docs/DEVELOPMENT.md).

## Структура

```text
src/game/        правила и состояние игры без браузера и Three.js
src/rendering/   сцена, камера, освещение, модели и эффекты
src/ui/          интерфейс и команды игрока
src/audio/       процедурный звук
assets/fonts/    локальные шрифты и лицензии
vendor/three/    Three.js и его лицензия
scripts/         запуск сервера и сборка автономного HTML
tests/           логика, браузерные проверки и длинные кампании
play/            готовая игра; генерируется из src/
docs/            правила, архитектура, разработка и история версий
archive/legacy/  старый прототип для отдельных регрессионных тестов
```

GitHub Actions проверяет исходники, тесты и соответствие готового HTML сборке при push и pull request. Снимки браузера, отчёты, временные файлы и `node_modules` сохраняются локально и не попадают в Git.

Модели, эффекты, текстуры и звук процедурные; характеристики вооружений вымышлены. Сторонние компоненты и их лицензии перечислены в [NOTICE.md](NOTICE.md).

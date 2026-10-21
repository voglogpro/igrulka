# Карта кода

Пути ниже считаются от корня репозитория. Характеристики, правила и внешний вид разделены: изменение модели не меняет урон, а изменение урона не требует править геометрию.

## Пехота

| Задача                                                             | Где менять                                  |
| ------------------------------------------------------------------ | ------------------------------------------- |
| Стрелок, пулемётчик, снайпер, штурмовики, сапёр, оператор FPV, МОГ | `src/game/units/infantry/types.js`          |
| Общие приказы, группы, построения, маскировка и команда окопаться  | `src/game/units/ground/orders.js`           |
| Набор, создание бойца, очередь казарм, точка сбора                 | `src/game/units/ground/recruitment.js`      |
| Укрытия, обнаружение, линия огня, примерные контакты               | `src/game/units/infantry/cover.js`          |
| Строительство окопа, восстановление у базы, ремонт сапёром         | `src/game/units/infantry/support.js`        |
| Запуск FPV оператором                                              | `src/game/units/infantry/fpv.js`            |
| Сворачивание стационарной МОГ в мобильную                          | `src/game/units/infantry/mog.js`            |
| Движение и наземная стрельба всех единиц                           | `src/game/units/ground/update.js`           |
| Наземные попадания, подавление и последствия гибели транспорта     | `src/game/units/ground/combat.js`           |
| Тело, ноги, экипировка и пакетная анимация солдат                  | `src/rendering/models/infantry/soldiers.js` |
| Мешки, станок, пулемёт и расчёт МОГ                                | `src/rendering/models/infantry/mog.js`      |
| Отрисовка окопов                                                   | `src/rendering/terrain/trenches.js`         |

`tickUnit` в `ground/update.js` обрабатывает общую механику пехоты и машин. Не копируйте весь цикл ради новой роли: параметры роли остаются в `types.js`, особое поведение можно вынести рядом с `infantry/support.js` или `infantry/fpv.js`.

## Техника

| Задача                                                  | Где менять                                         |
| ------------------------------------------------------- | -------------------------------------------------- |
| Цена, здоровье, скорость, вместимость, вооружение машин | `src/game/units/vehicles/types.js`                 |
| Посадка, места, выбор доступной точки высадки           | `src/game/units/vehicles/transport.js`             |
| Поиск пути и мосты                                      | `src/game/units/ground/navigation.js`              |
| Внешний вид Leopard                                     | `src/rendering/models/vehicles/leopard.js`         |
| Внешний вид БТР                                         | `src/rendering/models/vehicles/apc.js`             |
| Пушки и радары Шилки/Gepard                             | `src/rendering/models/vehicles/anti-air.js`        |
| Гусеницы и общий корпус                                 | `src/rendering/models/vehicles/tracked-chassis.js` |
| Выбор шаблона, клонирование и анимация машин            | `src/rendering/models/ground.js`                   |

Снаряд танка проходит через общую систему наземного боя. Изменение танкового урона — `vehicles/types.js`; изменение поведения попадания — `ground/combat.js`.

## Авиация и ПВО

| Задача                                                  | Где менять                                  |
| ------------------------------------------------------- | ------------------------------------------- |
| Параметры лёгкого/тяжёлого дрона и ракет                | `src/game/units/aviation/weapons.config.js` |
| Очередь сборочного завода                               | `src/game/units/aviation/production.js`     |
| Выбор пусковой, резерв склада, очередь запусков         | `src/game/units/aviation/launch.js`         |
| Маршрут с точками                                       | `src/game/units/aviation/routes.js`         |
| Полёт, сбитие, падение и удар по цели                   | `src/game/units/aviation/flight.js`         |
| Упреждение, нагрев, перезарядка и выбор воздушной цели  | `src/game/combat/air-defense.js`            |
| Движение и столкновение пуль/перехватчиков              | `src/game/combat/projectiles.js`            |
| Взрывной урон зданиям, дорогам и армии                  | `src/game/combat/damage.js`                 |
| Модернизация конкретной установки                       | `src/game/combat/upgrades.js`               |
| Параметры ЗРК, радара и стационарной МОГ                | `src/game/city/buildings.config.js`         |
| Общие коэффициенты улучшений и допуск к воздушным целям | `src/game/config.js`                        |
| Модели аппаратов, включая FPV                           | `src/rendering/models/aircraft.js`          |
| ЗРК и радар                                             | `src/rendering/models/defenses.js`          |

## Город, бот и сохранения

| Задача                                               | Где менять                              |
| ---------------------------------------------------- | --------------------------------------- |
| Постройки и их исходные характеристики               | `src/game/city/buildings.config.js`     |
| Размещение, подъезд, снос и ремонт                   | `src/game/city/construction.js`         |
| Постройка дорог и стартовые улицы                    | `src/game/city/roads.js`                |
| Связность, пересечения, снабжение и запрет наложений | `src/game/city/road-network.js`         |
| Доход, затраты, энергия и бонус бота                 | `src/game/city/economy.js`              |
| Строительство и выпуск завода за тик                 | `src/game/city/update.js`               |
| Дерево технологий                                    | `src/game/research/tech-tree.config.js` |
| Применение исследований                              | `src/game/research/research.js`         |
| Строительство города и налёты бота                   | `src/game/ai/city-ai.js`                |
| Пехота, укрытия и транспорт бота                     | `src/game/ai/army-ai.js`                |
| Новая кампания                                       | `src/game/state.js`                     |
| Главный шаг симуляции                                | `src/game/simulation.js`                |
| Сериализация, миграции и проверка входящих данных    | `src/game/persistence/saves.js`         |

## Отрисовка, интерфейс, звук

- `src/rendering/world.js` — создание сцены, связь модулей, ввод клавиатуры, цикл кадра.
- `src/rendering/sync.js` — обновление видимых моделей по состоянию.
- `src/rendering/camera.js` — движение относительно ракурса, поворот, зум, возврат фокуса карте.
- `src/rendering/input/build-tools.js` — клики, рамка, призрак постройки и дорога на курсоре.
- `src/rendering/lighting.js` — единственный контроллер солнца, окружения, экспозиции и области теней.
- `src/rendering/terrain/` — земля, река, лес, мосты, улицы и окопы.
- `src/rendering/tactical-overlays.js`, `minimap.js` — маршрут, кольца и миникарта.
- `src/rendering/effects/combat-effects.js` — пулы дыма, вспышек, осколков и трассеров.
- `src/rendering/effects/post-processing.js` — свечение, тональная обработка и зерно.
- `src/ui/app.js` — текущая сессия, обработчики действий и связь интерфейса с правилами.
- `src/ui/layout.js`, `panels.js`, `inspector.js` — оболочка, меню и карточка выбранного объекта.
- `src/ui/icons.js`, `format.js`, `style.css`, `fonts.css` — оформление и форматирование.
- `src/audio/game-audio.js` — процедурный звук и пространственная громкость.

## Общие модули

`src/game/index.js` — стабильный вход для интерфейса и тестов. `api.js` собирает экспорт правил из тематических файлов. `config.js` собирает справочники и общие функции характеристик. `shared/random.js`, `shared/events.js`, `shared/math.js` обслуживают системы без зависимости от браузера.

`archive/legacy/` нужен только тестам прежнего прототипа. `docs/history/` хранит планы прошлых версий. Готовый `play/Skyfront.html` объединяет текущие исходники и не служит местом ручных изменений.

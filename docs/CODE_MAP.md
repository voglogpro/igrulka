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
| Укрытие под огнём, отход техники, возврат к наступлению            | `src/game/units/ground/tactics.js`          |
| Тело, ноги, экипировка и пакетная анимация солдат                  | `src/rendering/models/infantry/soldiers.js` |
| Мешки, станок, пулемёт и расчёт МОГ                                | `src/rendering/models/infantry/mog.js`      |
| Отрисовка окопов                                                   | `src/rendering/terrain/trenches.js`         |

`tickUnit` в `ground/update.js` обрабатывает общую механику пехоты и машин. Не копируйте весь цикл ради новой роли: параметры роли остаются в `types.js`, особое поведение можно вынести рядом с `infantry/support.js` или `infantry/fpv.js`.

## Техника

| Задача                                                    | Где менять                                         |
| --------------------------------------------------------- | -------------------------------------------------- |
| Цена, здоровье, скорость, вместимость, вооружение машин   | `src/game/units/vehicles/types.js`                 |
| Посадка, места, выбор доступной точки высадки             | `src/game/units/vehicles/transport.js`             |
| Доставка, ожидание безопасной высадки и отмена рейса      | `src/game/units/vehicles/transport-orders.js`      |
| Очередь точек, построение, ожидание заблокированного пути | `src/game/units/ground/route-queue.js`             |
| Поиск пути и мосты                                        | `src/game/units/ground/navigation.js`              |
| Внешний вид Leopard                                       | `src/rendering/models/vehicles/leopard.js`         |
| Внешний вид БТР                                           | `src/rendering/models/vehicles/apc.js`             |
| Башня и ствол самоходной гаубицы                          | `src/rendering/models/vehicles/howitzer.js`        |
| Бронеавтомобиль, лёгкая башня, тяжёлый танк, РСЗО         | `src/rendering/models/vehicles/light-vehicles.js`  |
| Сложность бота: бонус дохода и темп                       | `src/game/ai/difficulty.config.js`                 |
| Пушки и радары Шилки/Gepard                               | `src/rendering/models/vehicles/anti-air.js`        |
| Гусеницы и общий корпус                                   | `src/rendering/models/vehicles/tracked-chassis.js` |
| Выбор шаблона, клонирование и анимация машин              | `src/rendering/models/ground.js`                   |

Снаряд танка проходит через общую систему наземного боя. Изменение танкового урона — `vehicles/types.js`; изменение поведения попадания — `ground/combat.js`.

## Авиация и ПВО

| Задача                                                  | Где менять                                  |
| ------------------------------------------------------- | ------------------------------------------- |
| Параметры лёгкого/тяжёлого дрона и ракет                | `src/game/units/aviation/weapons.config.js` |
| Очередь сборочного завода                               | `src/game/units/aviation/production.js`     |
| Целевой запас, резерв ресурсов, автоматический заказ    | `src/game/units/aviation/factory-plans.js`  |
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

Стратегические районы находятся отдельно в `src/game/territory/`: `districts.config.js` задаёт места и баланс, `state.js` — только изменяемые поля, `districts.js` — захват, доход, взрывы и ремонт, `persistence.js` — миграцию и проверку сохранений. `ai/district-ai.js` распределяет ограниченный гарнизон бота, оставляя резерв наступлению. Конфигурационные цены и координаты не принимаются из импортированного состояния.

Модели районов — `src/rendering/terrain/districts.js`; компактные карточки — `src/ui/districts.js` / `districts.css`. Панель планов заводов — `src/ui/factory-plans.js`; правила находятся в игровом модуле, а не в UI.

- `src/rendering/world.js` — создание сцены, связь модулей, ввод клавиатуры, цикл кадра.
- `src/rendering/sync.js` — обновление видимых моделей по состоянию.
- `src/rendering/camera.js` — движение относительно ракурса, поворот, зум, возврат фокуса карте.
- `src/rendering/input/build-tools.js` — клики, рамка, призрак постройки и дорога на курсоре.
- `src/rendering/lighting.js` — единственный контроллер солнца, окружения, экспозиции и области теней.
- `src/rendering/terrain/` — земля, река, лес, мосты, улицы и окопы.
- `src/rendering/tactical-overlays.js`, `minimap.js` — маршрут, кольца и миникарта.
- `src/rendering/effects/combat-effects.js` — пулы дыма, вспышек, осколков и трассеров; дульные эффекты, разрывы в воздухе, след ЗУР, горящие обломки.
- `src/rendering/effects/weapon-profiles.js` — внешний вид выстрела каждого класса оружия; `streaks.js` — росчерки трассеров и искр; `casings.js` — гильзы; `particles.js` — пакет дыма и свечения; `tracer-path.js` — точка и направление снаряда на траектории с опережением шага симуляции (зафиксировано, см. `docs/SHOTS.md`).
- `src/rendering/effects/post-processing.js` — свечение, тональная обработка и зерно.
- `src/ui/tech-tree.js` — дерево исследований: колонки веток, уровни, линии зависимостей.
- `src/ui/app.js` — текущая сессия, обработчики действий и связь интерфейса с правилами.
- `src/ui/layout.js`, `panels.js`, `inspector.js` — оболочка, меню и карточка выбранного объекта.
- `src/ui/icons.js`, `format.js`, `style.css`, `fonts.css` — оформление и форматирование.
- `src/audio/game-audio.js` — маршрутизация звука: расстояние от камеры, задержка, реверберация, эхо, моторы и сирена. `src/audio/synth.js` — синтез выстрелов, взрывов, свиста, моторов и импульсного отклика.

## Режимы, тыл, туман, погода, торговля

| Задача                                                 | Где менять                                           |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Режимы «Атака» / «Оборона моста»                       | `src/game/units/ground/stance.js`                    |
| Раненые, санитары, грузовики снабжения, автонабор тыла | `src/game/units/ground/rear.js`                      |
| Торговые караваны между рынками                        | `src/game/units/ground/trade.js`                     |
| Доход от поездок на работу                             | `src/game/city/economy.js` (`commute`)               |
| Туман разведки, радар, сетка обзора                    | `src/game/vision-grid.js`, `visibility.js`           |
| Погода: цикл, влияние на обзор и точность              | `src/game/weather.js`                                |
| Сложность бота                                         | `src/game/ai/difficulty.config.js`                   |
| Вуаль тумана, дождь, молнии                            | `src/rendering/fog-veil.js`, `effects/weather-fx.js` |
| Машины на улицах                                       | `src/rendering/traffic.js`                           |
| Дерево исследований                                    | `src/ui/tech-tree.js`                                |

## Новые механики армии

| Задача                                          | Где менять                                  |
| ----------------------------------------------- | ------------------------------------------- |
| Опыт, пороги рангов и бонус точности            | `src/game/units/ground/veterancy.js`        |
| Охрана поста, линия обороны, помощь соседям     | `src/game/units/ground/guard.js`            |
| Автоматический повтор набора и причины ожидания | `src/game/units/ground/repeat.js`           |
| Режимы новых бойцов и точка сбора               | `src/game/units/ground/recruitment.js`      |
| Компактные приказы выбранной армии              | `src/ui/army-controls.js`, `army.css`       |
| Категории набора, лимит, повторный набор        | `src/ui/army-recruitment.js`                |
| Состояние ПВО и модернизация                    | `src/ui/defense-inspector.js`               |
| Процедурные бронепанели, люки и стволы          | `src/rendering/models/vehicles/geometry.js` |

## Сетевая дуэль

`server/index.mjs` запускает сервер. `server/rooms.mjs` хранит комнаты, места и симуляцию; `src/network/commands.js` проверяет команды; `perspective.js` подготавливает разрешённые данные игроку; `client.js` связывает WebSocket и сглаживание. `src/ui/multiplayer.js` / `multiplayer.css` — меню комнаты. Подробности и тесты — [MULTIPLAYER.md](MULTIPLAYER.md).

## Общие модули

Пополнение с индивидуальным назначением: `units/ground/deployment.js`; состав и ожидающие бойцы отряда: `squads.js`; выбор целей, классы брони и упреждение: `engagement.js`. Все пути здесь от `src/game/`. Интерфейс наведения и карточек — `src/ui/deployment.js`; линия пути — `src/rendering/deployment-preview.js`. Формат метаданных проверяется в `game/persistence/squads.js`.

Расход пикселей — `src/rendering/performance/render-budget.js`; общий снимок видимости для отрисовки — `ground-visibility.js` рядом. Разбиение леса — `rendering/terrain/instance-tiles.js`; цветное объединение геометрии — `rendering/mesh-utils.js`; разворот самолётов — `rendering/models/aircraft-motion.js`. Сравнение тяжёлых сцен — `tests/browser/performance.py`, проверка нового набора — `tests/browser/deployment.py`.

`src/game/index.js` — стабильный вход для интерфейса и тестов. `api.js` собирает экспорт правил из тематических файлов. `config.js` собирает справочники и общие функции характеристик. `shared/random.js`, `shared/events.js`, `shared/math.js` обслуживают системы без зависимости от браузера.

`archive/legacy/` нужен только тестам прежнего прототипа. `docs/history/` хранит планы прошлых версий. Готовый `play/Skyfront.html` объединяет текущие исходники и не служит местом ручных изменений.

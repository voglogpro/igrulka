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

Ранние противотанковые стрелки — `atrifle` в `infantry/types.js`; эффективность по броне — `ground/engagement.js`. Автоматический FPV — `infantry/fpv.js`, сопровождение цели — `aviation/guided-fpv.js`. В 8.9 постоянный состав, интервал и резерв ресурсов — `ground/composition.js`; поля выбора — `ui/army-recruitment.js`. `repeat.js` оставлен только для отказа устаревшим командам.

Оборона разделена на `game/defense/geometry.js` (берег и территориальная линия), `formation.js` (уникальные посты, закрытие потерь, захват), `reserves.js` (дозированное усиление и возврат), `coordinator.js` (планирование). Сетевое представление чужих планов отсекает `network/perspective.js`. Обе линии рисуются независимо; `breakBefore` запрещает соединение через море.

Цены только зданий и история покупок — `game/city/pricing.js`. Исследования и лаборатории в 8.9 убраны; платное оснащение остаётся в combat/upgrades.js и combat/upgrade-tiers.js; совместимость и компенсация исследований — `game/persistence/retired-research.js`. Общие миграции — `game/persistence/economy.js` и `map-layout.js`. Казармы производят пехоту, `vehiclebase` — машины, `factory` — авиацию. Подробные правила — [PRODUCTION-89.md](PRODUCTION-89.md).

Живые записи двигателей, дистанция и ограничение голосов — `audio/engines.js`, встроенные петли — `audio/samples/`; оригинальные обработанные WAV, лицензии CC0 и воспроизводимый кодировщик — `assets/audio/`. Глубинное затемнение разведки — `rendering/fog-veil.js` и `effects/post-processing.js`; отдельной плоскости над землёй больше нет.

## Техника

| Задача                                                       | Где менять                                             |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| Цена, здоровье, скорость, вместимость, вооружение машин      | `src/game/units/vehicles/types.js`                     |
| Посадка, места, выбор доступной точки высадки                | `src/game/units/vehicles/transport.js`                 |
| Доставка, ожидание безопасной высадки и отмена рейса         | `src/game/units/vehicles/transport-orders.js`          |
| Очередь точек, построение, ожидание заблокированного пути    | `src/game/units/ground/route-queue.js`                 |
| Сухой путь, обход зданий и два коридора вокруг моря          | `src/game/units/ground/navigation.js`                  |
| Основные модели Leopard и РСЗО, раздельные body/turret/pitch | `src/rendering/models/vehicles/blender-vehicles.js`    |
| Запечённые общие буферы Blender (генерируемый файл)          | `src/rendering/models/generated/vehicle-meshes.js`     |
| Воспроизводимый Blender-экспорт моделей                      | `assets/models/vehicles.py`, `assets/models/README.md` |
| Legacy/fallback башня Leopard и производные тяжёлого танка   | `src/rendering/models/vehicles/leopard.js`             |
| Внешний вид БТР                                              | `src/rendering/models/vehicles/apc.js`                 |
| Башня и ствол самоходной гаубицы                             | `src/rendering/models/vehicles/howitzer.js`            |
| Бронеавтомобиль, лёгкая башня, тяжёлый танк; fallback РСЗО   | `src/rendering/models/vehicles/light-vehicles.js`      |
| Сложность бота: бонус дохода и темп                          | `src/game/ai/difficulty.config.js`                     |
| Пушки и радары Шилки/Gepard                                  | `src/rendering/models/vehicles/anti-air.js`            |
| Гусеницы и общий корпус                                      | `src/rendering/models/vehicles/tracked-chassis.js`     |
| Выбор шаблона, клонирование и анимация машин                 | `src/rendering/models/ground.js`                       |

Снаряд танка проходит через общую систему наземного боя. Изменение танкового урона — `vehicles/types.js`; изменение поведения попадания — `ground/combat.js`.

## Авиация и ПВО

| Задача                                                             | Где менять                                  |
| ------------------------------------------------------------------ | ------------------------------------------- |
| Параметры лёгкого/тяжёлого дрона и ракет                           | `src/game/units/aviation/weapons.config.js` |
| Очередь сборочного завода                                          | `src/game/units/aviation/production.js`     |
| Целевой запас, резерв ресурсов, автоматический заказ               | `src/game/units/aviation/factory-plans.js`  |
| Совместимая пусковая/шахта, местный запас, темп и очередь запусков | `src/game/units/aviation/launch.js`         |
| Ёмкости пусковых, общий учёт запаса и запросы физической доставки  | `src/game/units/aviation/launch-supply.js`  |
| Маршрут с точками                                                  | `src/game/units/aviation/routes.js`         |
| Полёт, сбитие, падение и удар по цели                              | `src/game/units/aviation/flight.js`         |
| Упреждение, нагрев, перезарядка и выбор воздушной цели             | `src/game/combat/air-defense.js`            |
| Движение и столкновение пуль/перехватчиков                         | `src/game/combat/projectiles.js`            |
| Взрывной урон зданиям, дорогам и армии                             | `src/game/combat/damage.js`                 |
| Проверка и оплата индивидуального оснащения за деньги              | `src/game/combat/upgrades.js`               |
| Множители дальности, разброса, темпа, выпуска и размера автопарка  | `src/game/combat/upgrade-tiers.js`          |
| Параметры ЗРК, радара и стационарной МОГ                           | `src/game/city/buildings.config.js`         |
| Сборка характеристик оснащения и допуск к воздушным целям          | `src/game/config.js`                        |
| Модели аппаратов, включая FPV                                      | `src/rendering/models/aircraft.js`          |
| ЗРК и радар                                                        | `src/rendering/models/defenses.js`          |

## Город, бот и сохранения

| Задача                                                                          | Где менять                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------ |
| Постройки и их исходные характеристики                                          | `src/game/city/buildings.config.js`        |
| Размещение, подъезд, снос и ремонт                                              | `src/game/city/construction.js`            |
| Постройка дорог и стартовые улицы                                               | `src/game/city/roads.js`                   |
| Связность, пересечения, снабжение и запрет наложений                            | `src/game/city/road-network.js`            |
| Доход, затраты, энергия и бонус бота                                            | `src/game/city/economy.js`                 |
| Строительство и выпуск завода за тик                                            | `src/game/city/update.js`                  |
| Конечные магазины, местный резерв, типы боеприпасов и груз                      | `src/game/units/ground/ammunition.js`      |
| Оплаченный выпуск боеприпасов и статус завода                                   | `src/game/city/ammo-production.js`         |
| Физический подвоз боеприпасов, вооружения и FPV, платная замена машин           | `src/game/city/ammo-logistics.js`          |
| Урон машине снабжения, потеря груза и событие уничтожения                       | `src/game/city/ammo-vehicle-damage.js`     |
| Городские ремонтные бригады, оплата и выключатель станции                       | `src/game/city/service.js`                 |
| Действующие полевые маршруты бригад, рабочие точки и сохранение пригодного пути | `src/game/city/service-field-routes.js`    |
| Legacy дорожный граф бригад (не используется текущим полевым подвозом)          | `src/game/city/service-roads.js`           |
| Legacy справочник исследований для совместимости старых кампаний                | `src/game/research/tech-tree.config.js`    |
| Совместимость API упразднённых исследований: пустой статус и отказ команды      | `src/game/research/research.js`            |
| Однократная компенсация старых лабораторий и исследований                       | `src/game/persistence/retired-research.js` |
| Строительство города и налёты бота                                              | `src/game/ai/city-ai.js`                   |
| Пехота, укрытия и транспорт бота                                                | `src/game/ai/army-ai.js`                   |
| Новая кампания                                                                  | `src/game/state.js`                        |
| Главный шаг симуляции                                                           | `src/game/simulation.js`                   |
| Сериализация, миграции и проверка входящих данных                               | `src/game/persistence/saves.js`            |
| Импорт и проверка станций и ремонтных машин                                     | `src/game/persistence/services.js`         |
| Проверка конечного боезапаса, грузов и уничтоженных слотов снабжения            | `src/game/persistence/ammunition.js`       |

## Отрисовка, интерфейс, звук

| Ответственность отрисовки 8.9                                        | Главный модуль                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Общие instance batches техники и улиц, логические proxies            | `src/rendering/performance/vehicle-batch.js`                         |
| Кеш изменений дорог без строковой сигнатуры каждого кадра            | `src/rendering/performance/road-visual-cache.js`                     |
| Контактные тени каждый кадр                                          | `src/rendering/performance/contact-shadows.js`                       |
| Частота и разрешение статических теней по фактическому времени кадра | `src/rendering/performance/shadow-budget.js`                         |
| Автоматический бюджет пикселей и снимок видимости                    | `src/rendering/performance/render-budget.js`, `ground-visibility.js` |
| Общий instanced renderer ремонтного и снабженческого автопарков      | `src/rendering/service-fleet.js`                                     |
| Модели шахты, завода боеприпасов и кеш по типу/стороне/уровню        | `src/rendering/models/buildings.js`                                  |
| Обновление моделей и смена визуального уровня                        | `src/rendering/sync.js`, `models/ground.js`                          |
| CPU-регрессии batching, маршрутов дорог и теневого бюджета           | `tests/unit/ground-render-performance.test.mjs`                      |
| 60 образцов тяжёлых сцен и проверка состояния перед замерами         | `tests/browser/performance.py`                                       |

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
- `src/rendering/effects/projectile-trail.js` — точка следа назад по траектории (обёртка над `tracer-path.js`).
- `src/rendering/effects/weather-style.js` — плотность дождя, наземного тумана и дымки, направление ветра и детерминированные семена частиц; `weather-fx.js` рядом — пакетные погодные эффекты.
- `src/rendering/service-fleet.js` — пакетные модели ремонтных машин по `state.serviceVehicles`; `src/rendering/models/city/service-station.js` — внешний вид станции. Правила ремонта находятся в `game/city/service.js`.
- `src/rendering/effects/weapon-profiles.js` — внешний вид выстрела каждого класса оружия; `streaks.js` — росчерки трассеров и искр; `casings.js` — гильзы; `particles.js` — пакет дыма и свечения; `tracer-path.js` — точка и направление снаряда на траектории с опережением шага симуляции (зафиксировано, см. `docs/SHOTS.md`).
- `src/rendering/effects/post-processing.js` — свечение, тональная обработка и наземный туман по глубине; `film-grain.js` рядом — рисунок зерна без крупных полос.
- `src/ui/equipment-detail.js` — платное оснащение и конечные запасы в инспекторе; исследовательский интерфейс удалён.
- `src/ui/app.js` — сборка приложения, подключение контроллеров, сетевые переходы и связь интерфейса с правилами; тематические контроллеры перечислены ниже.
- `src/ui/layout.js`, `panels.js`, `inspector.js` — оболочка, меню и карточка выбранного объекта.
- `src/ui/icons.js`, `format.js`, `style.css`, `fonts.css` — оформление и форматирование.
- `src/audio/game-audio.js` — маршрутизация звука: расстояние от камеры, задержка, реверберация, эхо, моторы и сирена. `src/audio/synth.js` — синтез выстрелов, взрывов, свиста, моторов и импульсного отклика.
- `src/audio/ambience/rain.js` — отдельный синтез дождя; его уровень и пространственная примесь подключаются в `game-audio.js`.

## Управление, ввод и сессия 8.9

Контроллеры получают только названные зависимости: чтение текущего состояния, отправку команды, операции камеры или нужные callbacks. Они не импортируют `app.js` и не получают общий изменяемый context приложения. Глобальный `window.skyfront` остаётся диагностическим и тестовым входом.

| Что менять                                                                        | Модуль                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Модель наведения, выбор вооружения, маршрут и HUD удара                           | `src/ui/controllers/strike-controller.js`                                        |
| Переключение отрядов, поиск свободного бойца, фокус и похожие бойцы               | `src/ui/controllers/army-navigation.js`                                          |
| Цели состава, разовый набор и связь с игровыми командами                          | `src/ui/army-recruitment.js`, `app.js`                                           |
| Регистрация и вызов `data-action`                                                 | `src/ui/controllers/action-router.js`; состав обработчиков собирается в `app.js` |
| Горячие клавиши, группы, Enter в числовом поле, Escape                            | `src/ui/input/keyboard.js`                                                       |
| Указатель, blur, миникарта, visibility и unload                                   | `src/ui/input/browser-events.js`                                                 |
| Ключи localStorage, резервные копии миграций, настройки, запись и замена кампании | `src/ui/session/campaign-store.js`                                               |
| Сохранить, экспорт, импорт и новая кампания; файловый адаптер                     | `src/ui/session/campaign-actions.js`                                             |
| Выбор local/network команды и отсечение ответа старой сессии                      | `src/ui/session/command-executor.js`                                             |
| Открытие формы по ссылке комнаты или `?multiplayer=1` после boot                  | `src/ui/session/multiplayer-entry.js`                                            |
| Проверка кода/адреса и сборка ссылки-приглашения                                  | `src/network/invite.js`                                                          |
| Роли, вооружение и пояснения карточек набора                                      | `src/ui/unit-profiles.js`, `army-recruitment.js`                                 |

Для новой кнопки `data-action` добавьте явный обработчик в реестр или тематическую коллекцию `.actions`. `dispatch` не подменяет шлюз `src/network/commands.js`: игровые полномочия проверяются там. Переключение инструментов и форм не должно поглощать WASD; возврат фокуса карте остаётся отдельной операцией. У асинхронного действия сохраняйте границы кампании, соединения и текущего выделения.

## Укрепления и фронт 8.9

| Что менять                                                       | Модуль                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Время, цена и защита укреплений; сектора и пределы резерва       | `src/game/defense/config.js`                                   |
| Земляные работы, платное улучшение окопа и блокпост              | `src/game/defense/fortifications.js`                           |
| Оценка фронта по видимым противникам, контактам и памяти         | `src/game/defense/frontline.js`                                |
| Ограниченные переброски, защита исходного гарнизона и возврат    | `src/game/defense/coordinator.js`                              |
| Включение/выключение `autoDefense` у своих защитников            | `src/game/defense/volunteers.js`                               |
| Миграция и проверка оборонных данных сохранения                  | `src/game/defense/persistence.js`                              |
| Инвалидация кэша отчёта фронта                                   | `src/game/defense/cache.js`                                    |
| Пакетные модели трёх стадий и линия на карте                     | `src/rendering/defense/fortifications.js`, `frontline-view.js` |
| Режим двух коридоров и обстановка по запросу, по умолчанию скрыт | `src/ui/frontline.js`, `frontline.css`                         |

Публичные функции — `setAutoDefense`, `frontlineReport`, `fortificationStatus` из `src/game/index.js`. Пехота на спокойном оборонном посту строит позицию; улучшения оплачиваются за выполненную работу. Переброски используют только разрешённый игроком резерв, не требуют телепортации и возвращают бойца на его исходный пост. Отчёт фронта — оценка по наблюдениям, а не раскрытие всех скрытых войск.

## Режимы, тыл, туман, погода, торговля

| Задача                                                                          | Где менять                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Режимы «Атака» / «Оборона коридора»                                             | `src/game/units/ground/stance.js`                    |
| Раненые, санитары, ремонт и ручные приказы поддержки (без скрытой покупки тыла) | `src/game/units/ground/rear.js`                      |
| Торговые караваны между рынками                                                 | `src/game/units/ground/trade.js`                     |
| Доход от поездок на работу                                                      | `src/game/city/economy.js` (`commute`)               |
| Туман разведки, радар, сетка обзора                                             | `src/game/vision-grid.js`, `visibility.js`           |
| Погода: цикл, влияние на обзор и точность                                       | `src/game/weather.js`                                |
| Сложность бота                                                                  | `src/game/ai/difficulty.config.js`                   |
| Вуаль тумана, дождь, молнии                                                     | `src/rendering/fog-veil.js`, `effects/weather-fx.js` |
| Машины на улицах                                                                | `src/rendering/traffic.js`                           |

## Новые механики армии

| Задача                                                         | Где менять                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Опыт, пороги рангов и бонус точности                           | `src/game/units/ground/veterancy.js`                             |
| Охрана поста, линия обороны, помощь соседям                    | `src/game/units/ground/guard.js`                                 |
| Постоянный состав 8.9, численность по типам, очередь и резервы | `src/game/units/ground/composition.js`                           |
| Legacy API и поля прежнего повтора набора; не цели состава 8.9 | `src/game/units/ground/repeat.js`                                |
| Режимы новых бойцов и точка сбора                              | `src/game/units/ground/recruitment.js`                           |
| Компактные приказы выбранной армии                             | `src/ui/army-controls.js`, `army.css`                            |
| Категории набора, постоянные цели и разовый набор              | `src/ui/army-recruitment.js`                                     |
| Магазин и нагрев ПВО                                           | `src/ui/defense-inspector.js`                                    |
| Денежное оснащение, склад, местный резерв и груз в инспекторе  | `src/ui/equipment-detail.js`, `inspector.js`, `army-controls.js` |
| Процедурные бронепанели, люки и стволы                         | `src/rendering/models/vehicles/geometry.js`                      |

## Сетевая дуэль

`server/ssh-proxy.mjs` — условный CONNECT-мост для SSH через существующий HTTP(S)-прокси, только к `localhost.run:22`; выбор прокси выполняет `server/proxy.mjs`. `src/network/client.js` проверяет 15 секунд без входящих сообщений и запускает возврат; при терминальном отказе сервера очищает сохранённые данные комнаты.

`server/index.mjs` запускает сервер, с `--internet` — ещё и временный публичный адрес: сначала через `server/ssh-tunnel.mjs` (OpenSSH/localhost.run), затем при неудаче через резервный `server/tunnel.mjs` (Cloudflare). `Играть через интернет.cmd` готовит зависимости хозяина; CLI — `npm run multiplayer:internet`. `server/rooms.mjs` хранит комнаты, места и симуляцию; `src/network/commands.js` проверяет команды; `perspective.js` подготавливает разрешённые данные игроку; `client.js` связывает WebSocket и сглаживание. `src/network/invite.js` проверяет приглашения и выбирает адрес сервера. `src/ui/multiplayer.js` / `multiplayer.css` — имя, вход, копирование ссылки и готовность. `/api/server-info` сообщает `publicUrl` для приглашений с локального адреса. Подробности и тесты — [MULTIPLAYER.md](MULTIPLAYER.md).

| Ответственность интернет-запуска                            | Модуль                   |
| ----------------------------------------------------------- | ------------------------ |
| Выбор SSH/Cloudflare и жизненный цикл                       | `server/internet.mjs`    |
| Env/Windows-прокси, исключения и строгий TLS agent          | `server/proxy.mjs`       |
| JSON и полный ответ 32 КБ, три успешные проверки готовности | `server/tunnel.mjs`      |
| Интернет-HTML, внешние шрифты и кешированный gzip           | `scripts/dev-server.mjs` |

Хозяин играет с локального loopback-адреса, гость — с публичного адреса из `/api/server-info`. Интернет-WSS использует стандартное согласуемое сжатие, LAN по умолчанию без сжатия; протокол 8. Автономный HTML сохраняет встроенные шрифты.

## Общие модули

Пополнение с индивидуальным назначением: `units/ground/deployment.js`; состав и ожидающие бойцы отряда: `squads.js`; выбор целей, классы брони и упреждение: `engagement.js`. Все пути здесь от `src/game/`. Интерфейс наведения и карточек — `src/ui/deployment.js`; линия пути — `src/rendering/deployment-preview.js`. Формат метаданных проверяется в `game/persistence/squads.js`.

Расход пикселей — `src/rendering/performance/render-budget.js`; общий снимок видимости для отрисовки — `ground-visibility.js` рядом. Разбиение леса — `rendering/terrain/instance-tiles.js`; цветное объединение геометрии — `rendering/mesh-utils.js`; разворот самолётов — `rendering/models/aircraft-motion.js`. Сравнение тяжёлых сцен — `tests/browser/performance.py`, проверка нового набора — `tests/browser/deployment.py`.

`src/game/index.js` — стабильный вход для интерфейса и тестов. `api.js` собирает экспорт правил из тематических файлов. `config.js` собирает справочники и общие функции характеристик. `shared/random.js`, `shared/events.js`, `shared/math.js` обслуживают системы без зависимости от браузера.

`archive/legacy/` нужен только тестам прежнего прототипа. `docs/history/` хранит планы прошлых версий. Готовый `play/Skyfront.html` объединяет текущие исходники и не служит местом ручных изменений.

## Карта, нефть и порты (8.6)

- `src/game/map.js` — размеры поля (`MAP`, `FIELD`, `inField`), море (`SEA`, `seaDistance`, `isWater`; `riverDistance` оставлен как совместимая мера «меньше 44 — вода»), коридоры `CORRIDORS`, остров `ISLAND`, месторождения `OIL_FIELDS`, холмы `HILLS` с запечённой сеткой высот (`groundHeight`, `terrainClear` для линии видимости), леса `COVER_PATCHES`.
- `src/game/city/oil.js` — запас, ёмкость, добыча, расход топлива, цена в нефти, пожары хранилищ; `city/ports.js` — суда, причалы, торговля на бирже; `ai/oil-ai.js` — нефть и порт бота; `persistence/oil.js` — проверка и миграция формата 12.
- `src/rendering/terrain/environment.js` — рельеф с цветом по высоте, море с рябью и прибоем, остров с маяком, леса двух видов, месторождения и пограничные посты; `src/rendering/models/city/oil.js` — качалка, резервуар, порт, судно; `src/rendering/ships.js` — пакетная отрисовка судов и кильватерный след.
- `src/game/units/ground/training.js` — учебный полигон: опыт новобранцев и тренировка рядом; `city/road-network.js` (`snapRoadPoint`, `ROAD_GRID`) — привязка улиц к углам, длинам и параллельным направляющим.

Боезапас 8.9: units/ground/ammunition.js; выпуск — city/ammo-production.js; физическая доставка — city/ammo-logistics.js; проверка сохранений — persistence/ammunition.js. Местные склады и запросы доставки аппаратов — units/aviation/launch-supply.js. Городской ремонт по полю — city/service-field-routes.js; пакетная отрисовка обоих парков — rendering/service-fleet.js. Мастер-план последних требований — MASTER_PLAN.md.

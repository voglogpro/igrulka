# Карта кода

## Изменения 8.14.0

| Механика                                                   | Основные файлы                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Карта 4800×4000, сдвиг берегов, лесополосы и новые поля    | `src/game/map.js` (`expandV23X`, `compressV23X`, `COVER_PATCHES[].belt`)                 |
| Миграция 22→23 и прежних форматов                          | `src/game/persistence/map-layout.js` (`migrateV23Layout`), `territory/settlements.js`    |
| Посты на переднем крае лесополосы                          | `src/game/defense/geometry.js` (`treeLinePoint`), `defense/config.js` (`homeLineX`)      |
| Опорный пункт и форт, цена леса и бетона                   | `src/game/defense/config.js`, `fortifications.js`, `rendering/defense/fortifications.js` |
| Захват окопов штурмом и закрепление                        | `src/game/units/ground/defense-attack.js` (`seizeTrench`, `ASSAULT`)                     |
| Режим «Один против двух» и командные правила               | `src/game/state.js`, `factions.js` (`teamOf`, `frontDirection`, `frontIds`)              |
| Выбор режима на старте и в новой игре                      | `src/ui/app.js`, `ui/session/campaign-actions.js`                                        |
| Бюджетный арсенал, залпы, подавление ЗРК, прикрытие штурма | `src/game/ai/strike-ai.js`, `city-ai.js`, `army-ai.js` (`ARMY_PACE`)                     |

Состояние 23 и протокол 17. Сторона больше не определяет направление или
команду через чётность: используйте `teamOf`, `frontDirection`, `frontIds` и
`onOwnFront`. Сдвиг берегов равен 192 м — целому числу клеток маршрута (24 м)
и препятствий (64 м), поэтому пути внутри городов не меняются. Сохранения
старше 23 переводятся `migrateV23Layout` до проверки поселений и нефти.

## Изменения 8.13.3

| Механика                                               | Основные файлы                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Дополнительный бас и два отражения громкой основы      | `src/audio/impact-return.js`, `src/audio/game-audio.js`                  |
| Адресный дорожный подряд и сохранение оплаты           | `src/game/city/road-recovery.js`, `economy.js`, `src/game/simulation.js` |
| Компактное восстановление при пустом кошельке          | `src/ui/road-recovery.js`, `panels.js`, `app.js`                         |
| Конечный неоплаченный FIFO и поштучная оплата          | `src/game/units/aviation/factory-orders.js`, `factory-plans.js`          |
| Количество заказа и отмена остатка                     | `src/ui/factory-orders.js`, `panels.js`, `app.js`                        |
| Реальная кампания: разрыв → восстановление → 20 дронов | `tests/soak/recovery-orders.mjs`, `tests/browser/recovery_orders.py`     |

Состояние 22 и протокол 16. `productionOrders` — неоплаченные намерения;
`queue` — уже оплаченные изделия. Их нельзя объединять или возвращать деньги
при отмене намерения. `side.roadRecovery` содержит адресную оплату; она не
является свободными деньгами. Старые отчёты ниже описывают свои выпуски.

## Изменения 8.13.2 и сохранённые механики 8.13.1

| Механика                                                 | Основные файлы                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Проект экономики и статический расчёт рецептов           | `docs/design/ECONOMY.md`, `scripts/economy-report.mjs`                                          |
| Прежний микс, бас, эхо, дистанция и лимит голосов 8.13.0 | `src/audio/game-audio.js`                                                                       |
| Прежние источники взрывов и каталог                      | `src/audio/pcm-catalog.js`, `src/audio/synth.js`, `assets/audio/LICENSE.md`                     |
| Общая 18-метровая форма, места, длинные секции и проходы | `src/game/defense/trench-footprint.js`                                                          |
| Укрытие/занятие/повторное использование                  | `defense/positions.js`, `fortifications.js`, `units/infantry/cover.js`, `units/ground/guard.js` |
| Шесть графических batches окопов, наклон на склоне       | `src/rendering/defense/fortifications.js`, `trench-links.js`                                    |
| Подготовка атаки и наземный боезапас                     | `src/game/units/ground/assault-supply.js`, `defense-attack.js`                                  |
| Поход к конечному ящику/возврат к приказу                | `units/ground/field-supply.js`, `city/field-ammo.js`, `persistence/field-supply.js`             |

Сохранение 21, протокол 15. Проектные цены из `ECONOMY.md` не применяются
автоматически. Реальная оплата по-прежнему находится в существующих командах и
производстве; нельзя списывать рецепт второй раз при выдаче уже оплаченного груза.

## Армия, склады и электроника 8.13

Состояние 21, протокол 14. `city/electronics.js` — рецепт, предел запаса,
резерв денег и миграция компонентов. `city/oil.js` — расход двигателей и полевых
перевозок; `buildings.config.js` — выпуск сплавов и электронный цех.
`units/aviation/weapon-stores.js` отделяет заводской склад от пусковой;
`city/weapon-delivery-status.js` только читает запас/груз/ETA, не заказывает машину.
`city/ammo-logistics.js` перевозит реальные партии, `factory-plans.js` учитывает
местный запас и оплаченные очереди. При открытии карточки снабжение не меняется.

`units/ground/defense-attack.js` — продолжающаяся операция, число живых, отзыв
и приоритет ручного приказа. `ai/army-ai.js:launchAIAssault` применяет эти же
правила на существующих часах налёта бота. `ground/rear.js` — отдельные лагеря
поддержки по направлениям, лечение и медики-пассажиры санитарного транспорта.
`city/service-field-routes.js` — парковка ремонтных машин без занятых мест.

`combat/radar-support.js` — местное сопровождение ПВО и оценка подхода только
по наблюдаемой скорости; будущие маршруты противника не читаются.
`audio/ambience/rain.js` использует записанный Opus из `assets/audio/`; источник
и условия — `assets/audio/LICENSE.md`. `rendering/defense/fortifications.js`
и `trench-links.js` рисуют секции в прежних instanced batches.
`performance/warmup-draw.js` готовит реальные буферы даже скрытых пустых пулов;
`tactical-overlays.js` создаёт цвет тактических меток до сбора графических программ.

`performance/road-visual-cache.js` и `road-visual-sync.js` сохраняют неизменные
дороги, обновляя только пересечения со старым/новым участком. `traffic.js:buildGraph`
отсекает удалённые пары до точной геометрии. `world.resizeRender` сохраняет размер
canvas при адаптации; `effects/post-processing.js` меняет внутренние FBO.
`performance/vehicle-batch.js` пропускает неизменные занятые слоты только у
`versionedDrive` из `tracked-chassis.js`. Не убирайте проверку предыдущего поколения:
после отсечения слот мог занять другой объект. `performance/selection-coverage.js`
показывает актуальные радиусы с ограниченной частотой чтения радаров.

`shared/static-spatial.js` ведёт производную ревизию геометрии окопов. При создании,
замене или перемещении позиции вызывается инвалидация; прогресс и смена владельца
остаются живыми данными. В `ground/update.js` магазин/перезарядка/нагрев вычисляются
без создания полного объекта `defenseStats`. Состояние и RNG не меняются.

Приёмка и границы — [ARMY-LOGISTICS-813](qa/ARMY-LOGISTICS-813.md).

## Короткие остановки и подготовка 8.12.1

Формат состояния 20 и протокол 13 сохранены. Новые кеши — производные данные;
их не включают в сохранения или снимки сети. Подготовка не тратит ресурсы,
не отдаёт приказы и не продвигает время/RNG игры.

| Что проверять/менять                                                                    | Точка кода                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Подготовка до Start, ограничение времени, смена кампании во время загрузки              | `src/rendering/performance/startup-prewarm.js`, связка `world.shaderWarmup` в `world.js`                                                               |
| Реальные семейства моделей/материалов, обычные и instanced-варианты, теневые программы  | `rendering/performance/warmup-families.js`, `warmup-draw.js`, `shader-warmup.js`                                                                       |
| Индикатор загрузки, заблокированный Start, ограниченная необязательная подготовка аудио | `src/ui/session/startup-readiness.js`, связка в `app.js`                                                                                               |
| Прежний аудиограф заранее без звука; включение только жестом                            | `src/audio/game-audio.js`: `prepare`, `unlock`; банк PCM по-прежнему `sample-bank.js`/`pcm-worker.js`                                                  |
| Только изменённые Float32-матрицы, диапазоны GPU upload, актуальные bounds выбора       | `rendering/performance/instance-updates.js`; потребители — `models/infantry/soldiers.js`, `vehicle-batch.js`, `contact-shadows.js`, `service-fleet.js` |
| Локальная очистка леса под дорогой/стройкой без полного обхода                          | `rendering/performance/tree-index.js`, `rendering/terrain/environment.js`: `clearTrees`                                                                |
| Статическая геометрия без больших временных JS-массивов                                 | `src/rendering/mesh-utils.js`: `batchStatic`                                                                                                           |
| Общий неизменный рельеф, маски радиусов и расстояния вдоль рёбер сетки                  | `src/game/units/ground/navigation.js`; `navigationWarmup` — итератор подготовки                                                                        |
| Береговая геометрия один раз на проход распределения/проверки постов                    | `src/game/defense/formation.js`, `persistence.js`                                                                                                      |
| Каталог публичных зданий/дорог без повторного поиска через армию                        | `src/game/visibility.js`: `knownTargets`; правила скрытых целей — прежний `observedTarget`                                                             |
| Единственный разбор версии после загрузки, прежние raw-резервные копии                  | `src/ui/session/campaign-store.js`: `loadCampaign`                                                                                                     |

`tree-index.js` сохраняет порядок исходного массива, а живые флаги очистки
проверяются в момент запроса. Индекс заменяется при смене массива или длины.
`navigation.js` отделяет постоянный рельеф от меняющихся зданий; маски препятствий
по-прежнему зависят от кампании и `networkRevision`. Локальная подготовка путей
пропускается у сетевого клиента: авторитетная навигация работает на сервере.

`game/units/ground/candidate-buffer.js` переиспользует массивы ссылок, оценок и
индексов при поиске наземных целей. `guard.js` извлекает ближайшие цели из кучи
и проверяет видимость по очереди. `engagement.js` сохраняет полный порядок по
оценке/ID и прежнее окно из двух первых и шести сменяемых кандидатов. Равные
ключи сохраняют исходный порядок. Буферы принадлежат производным кешам подсистем,
живут вне состояния игры и не входят в сохранения или сетевые снимки.

Короткие регрессии — `tests/unit/instance-updates.test.mjs`, `tree-index.test.mjs`,
`static-mesh-output.test.mjs`, `navigation-terrain-cache.test.mjs`,
`navigation-warmup.test.mjs`, `startup-prewarm.test.mjs`, `startup-readiness.test.mjs`,
`audio-startup.test.mjs`, `city-target-performance.test.mjs`,
`candidate-buffer.test.mjs`, `ground-engagement.test.mjs`,
`guard-sight-performance.test.mjs`. Реальный ввод и причины
долгих кадров — `tests/browser/hitch_hunt.py`, `hitch_probe.js`, `hitch_summary.py`.
Замеры требуют одинаковых сценариев без параллельной нагрузки. План —
[PLAN-8121.md](PLAN-8121.md); цифры приёмки ведутся отдельно.

`world.js:resizeRender` меняет canvas одним `setDrawingBufferSize` только при
новых размерах/DPR/масштабе. `performance/context-recovery.js` восстанавливает
статическую тень после замены WebGL-контекста. `warmup-draw.js` сначала готовит
семейства, затем целую настоящую сцену во внутренних буферах. Неблокирующий GPU
fence в `startup-prewarm.js` ожидается через loading RAF, с тем же общим дедлайном.
Тесты жизненного цикла — `render-resize-lifecycle.test.mjs`,
`startup-prewarm.test.mjs`; отчёт — [qa/FREEZES-8121.md](qa/FREEZES-8121.md).

Массовое ручное отступление — `game/units/ground/orders.js:commandUnits`, порог
16 доступных бойцов. Маршруты получает прежняя очередь
`game/units/ground/route-queue.js` (два поиска за шаг). Для центра здания базы
планировщик сохраняет прежнюю безопасную конечную ячейку `groundPath` как маркер
прибытия. Проверки — `tests/unit/manual-retreat.test.mjs`; native-клик —
`hitch_hunt.py --scenario retreat --units 90 --seconds 10 --require-ready`.

## Автономная боёвка 8.12

Единая доктрина для игрока, кооператива и ботов — `src/game/defense/`:

| Задача                                                     | Модуль                            |
| ---------------------------------------------------------- | --------------------------------- |
| Частота планирования и порядок подсистем                   | `coordinator.js`, `config.js`     |
| Положение рубежей относительно склада, море и свой город   | `geometry.js`                     |
| Предпочтения ролей: пехота, МОГ, броня, артиллерия         | `layers.js`                       |
| Квоты направлений, посты, гарнизон, физический захват      | `formation.js`                    |
| Только замеченные наземные угрозы и оценка прорыва         | `frontline.js`                    |
| Ближайший подходящий резерв, сопровождение угрозы, возврат | `reserves.js`                     |
| Ограниченные обходные группы, естественное укрытие, отзыв  | `missions.js`                     |
| Безопасная точка встречи с оплачиваемым подвозом           | `supply.js`                       |
| Постоянные позиции и производные соединения окопов         | `positions.js`, `trench-links.js` |
| Строгая проверка формата 20 и старых сохранений            | `persistence.js`                  |

`game/units/ground/movement.js` использует один пространственный индекс для пехоты,
техники, ремонтных и снабженческих машин. Объезд — локальный; восстановление A* —
не более двух путей за шаг. `navigation.js` проверяет весь пройденный отрезок, а
`vehicles/transport-orders.js` ждёт свободного места высадки без потери пассажиров.
Постройка поверх физически занятой площадки блокируется в `city/construction.js`.

`ground/tactics.js` временно передаёт автоматического защитника обычному механизму
укрытия, сохраняет его пост и задачу. `tactical-budget.js` ограничивает поиск путей
и не даёт всей группе одновременно отступить. `ground/guard.js` использует
пространственные корзины целей и постов вместо перебора всей армии каждым бойцом.

`ai/depot-doctrine.js` выбирает смешанный оплачиваемый набор и резерв ресурсов;
`ai/district-ai.js` ставит намерения тому же координатору, не создавая вторую
систему приказов. Часы решений бота сохраняются через `persistence/ai.js`.
`city/field-ammo.js` выбирает площадку у безопасного склада; запас, оплата и рейсы
остаются в обычных модулях снабжения.

Связи окопов пакетируются в `simulation.js` только вокруг наземного шага через
`beginTrenchLinkBatch`/`endTrenchLinkBatch` и `try/finally`. Это производный кеш:
его нельзя сохранять, переносить между кампаниями или держать после конца шага.
Вне пакета строительство/захват должны немедленно обновлять геометрию.

Приёмка — `tests/unit/depot-combat12.test.mjs`, `combat-micro.test.mjs`,
`ground-movement.test.mjs`, `civic-movement.test.mjs`, `trench-link-batch.test.mjs`,
`ai-depot-doctrine.test.mjs`, `ai-persistence.test.mjs`, а также браузерный
`tests/browser/depot_battle.py`. План — [PLAN-812.md](PLAN-812.md).

## Городки и производительность 8.11

Шаблоны восьми городков и дорожные въезды — `src/game/territory/settlements.config.js`; материализация обычных зданий, наследование, стабильные ID и защита старой застройки — `settlement-cities.js`; захват, связь и статус — `settlements.js`. Доход считается общей `city/economy.js`, без второй выплаты поселению. Карточка и список — `src/ui/settlements.js`, нейтральные модели — `src/rendering/terrain/settlements.js`.

Полевые ящики — `game/city/field-ammo.js`; физические рейсы машин — `city/ammo-logistics.js`; подход защитника и возврат на пост — `units/ground/field-supply.js`; строгий импорт формата 19 — `persistence/field-supply.js`. Геометрия и выбор ящика — `rendering/terrain/ammo-crates.js`, карточка — `ui/ammo-crate.js`. Чужой запас отсекает `network/perspective.js`, отдельная коллекция дельт — `network/snapshots.js`. Границы команды, ввода цели и импорта отделены от численности производства в `units/ground/limits.js`.

Бюджет догоняющих шагов браузера — `ui/session/simulation-budget.js`; разрешение большого выделения — `ui/selection.js`. `game/units/ground/navigation.js` индексирует статические препятствия для точных проверок движения; `engagement.js` разделяет боевые корзины по сторонам. Пакетный приказ поста переиспользует оценки укрытий только внутри одного вызова `guardGround`.

Подготовка прежних PCM-звуков — `audio/pcm-catalog.js`, отдельный Worker — `audio/pcm-worker.js`, общий банк и буферы AudioContext — `audio/sample-bank.js`. `scripts/build-portable.mjs` встраивает Worker в автономный HTML как Blob; dev использует модульный Worker. Не возвращайте синхронный массовый синтез в `unlock()`.

Общие шаблоны статических зданий — `rendering/models/buildings.js`, пакетная отрисовка с сохранением выбора и теней — `rendering/performance/building-batch.js`. `effects/post-processing.js` уменьшает MSAA вместе со стабильным снижением разрешения RenderBudget. Готовые неизменяемые коэффициенты оснащения — `game/combat/upgrade-tiers.js`; `air-defense.js` переиспользует перечни целей без изменения порядка наведения и RNG.

Сравнение CPU в отдельных процессах — `tests/soak/performance.mjs --baseline-root=...`; настоящий WS под задержкой подтверждений — `tests/soak/network-load.mjs`. Артефакты локальны в `artifacts/qa/`. Для постоянного хостинга используйте `server/hosted.mjs`, `Dockerfile` и [BOTHOST.md](BOTHOST.md). Локальный internet launcher остаётся в `server/index.mjs`.

Пути ниже считаются от корня репозитория. Характеристики, правила и внешний вид разделены: изменение модели не меняет урон, а изменение урона не требует править геометрию.

В 8.9.1 отдельные новые точки входа: `game/city/weapon-transfer.js` — предпочтение вооружения и возврат старого типа из заполненной площадки; `audio/footsteps.js` — ограниченный планировщик пространственных шагов; `rendering/models/equipment.js` — визуальное оснащение уровней. Эти пути находятся внутри `src/`. Полная сверка прежних запросов и заменённых решений — `docs/REQUESTS_CHECKLIST.md`.

В 8.10 четыре кооперативных города используют `game/factions.js`: владение, команда, свой штаб и стороны ботов определяются отдельно. Стороны 0/2 союзны, 1/3 союзны; сетевое представление переставляет стороны относительно своего города, сохраняя реальные координаты. Общие цвета четырёх городов находятся в `rendering/team-colors.js`.

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

Живые записи двигателей, дистанция и ограничение голосов — `audio/engines.js`, встроенные петли — `audio/samples/`; оригинальные обработанные WAV, лицензии CC0 и воспроизводимый кодировщик — `assets/audio/`. Атмосферный туман по глубине — `rendering/effects/post-processing.js`; `rendering/fog-veil.js` и `game/vision-grid.js` сохраняют только legacy-совместимость отключённого тумана войны, без периодического построения сетки.

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

Стратегические районы находятся отдельно в `src/game/territory/`: `districts.config.js` задаёт два спорных склада в центре северного и южного сухопутных коридоров, `state.js` — только изменяемые поля, `districts.js` — захват с учётом команд, доход, взрывы и ремонт. `persistence.js` объединяет прежние четыре района в два и проверяет сохранения. Города, казна и оплаченные очереди при этом не меняются. `ai/district-ai.js` подключает армию бота к общей доктрине складов. Конфигурационные цены и координаты не принимаются из импортированного состояния.

| Задача                                                                         | Где менять                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------ |
| Восемь поселений, доход и общие координаты домов для коллизий                  | `src/game/territory/settlements.config.js` |
| Автоподключение своей дорогой, отключение дохода, оспаривание и строгий импорт | `src/game/territory/settlements.js`        |
| Дорожный граф к конкретному штабу                                              | `src/game/city/road-network.js`            |
| Доход поселений и процентный бонус складов, без повторного бонуса содержания   | `src/game/city/economy.js`, `oil.js`       |
| Статические пакетные дома и выбор поселения лучом                              | `src/rendering/terrain/settlements.js`     |
| Карточка поселения без отдельной кнопки подключения                            | `src/ui/settlements.js`                    |
| Городские дороги бота к поселениям                                             | `src/game/ai/settlement-ai.js`             |
| Физические подходы, доход, команды, миграция и сохранение                      | `tests/unit/settlements-810.test.mjs`      |
| Стабильная геометрия, четыре цвета и общие footprints                          | `tests/unit/settlement-rendering.test.mjs` |

`s.settlements` хранит владельца, претендента, контроль, признаки оспаривания, а с 8.11 также `materialized`, `componentIds` и `roadIds`. `s.settlementClock` сохраняет секундную частоту расчёта. `settlementLayoutMask` — 24 стабильные позиции компонентов (20 используются шаблонами), legacy `settlementHouseMask` — прежние 16 домов. Миграция исключает новые компоненты поверх оплаченной застройки, бойцов, маршрутов и полевых машин. `activeSettlementFootprints(s)` кеширует препятствия до первого присоединения; после него коллизиями служат обычные здания. `settlementStatus` выводит связь, выпуск, причину остановки, въезд и ID компонентов; необязательный третий `Map` делит расчёт экономики только в пределах одного UI-списка. Нейтральных зданий со стороной -1 в `buildings` нет: первые обычные записи создаёт `settlement-cities.js` при присоединении, последующий захват переносит их без восстановления здоровья. `settlementIncome` описывает уже учтённый общей экономикой выпуск, отдельного начисления больше нет.

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
| Радар ПВО и legacy API открытой карты (без сетки обзора)                        | `src/game/vision-grid.js`, `visibility.js`           |
| Погода: цикл, влияние на обзор и точность                                       | `src/game/weather.js`                                |
| Сложность бота                                                                  | `src/game/ai/difficulty.config.js`                   |
| Legacy отключённая вуаль; действующие дождь и молнии                            | `src/rendering/fog-veil.js`, `effects/weather-fx.js` |
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

Ускорение 8.10.2: `src/network/snapshots.js` — дополнительное кодирование `delta-v1`, компактные поля, изменения маршрутов и неизменяемая сборка снимков; `server/outbound-snapshots.mjs` — ограниченная очередь, ACK снимков, приоритет команд и адаптация 100–500 мс по RTT/CPU. `snapshotPlayerView` в `perspective.js` заимствует вложенные данные только для немедленного синхронного кодирования, обычные проекции отделены полностью. Карточки: `ui/inspector.js`, `ui/inspector-card.js`, `ui/army-controls.js`; основные действия вне раскрывающихся подробностей, состояние раскрытия переживает замену сетевого объекта состояния.

`server/index.mjs` запускает сервер, с `--internet` — ещё и временный публичный адрес: сначала через `server/ssh-tunnel.mjs` (OpenSSH/localhost.run), затем при неудаче через резервный `server/tunnel.mjs` (Cloudflare). `Играть через интернет.cmd` готовит зависимости хозяина; CLI — `npm run multiplayer:internet`. `server/rooms.mjs` хранит комнаты, места и симуляцию; `src/network/commands.js` проверяет команды; `perspective.js` подготавливает разрешённые данные игроку; `client.js` связывает WebSocket и сглаживание. `src/network/invite.js` проверяет приглашения и выбирает адрес сервера. `src/ui/multiplayer.js` / `multiplayer.css` — имя, вход, копирование ссылки и готовность. `/api/server-info` сообщает `publicUrl` для приглашений с локального адреса. Подробности и тесты — [MULTIPLAYER.md](MULTIPLAYER.md).

| Ответственность интернет-запуска                            | Модуль                   |
| ----------------------------------------------------------- | ------------------------ |
| Выбор SSH/Cloudflare и жизненный цикл                       | `server/internet.mjs`    |
| Env/Windows-прокси, исключения и строгий TLS agent          | `server/proxy.mjs`       |
| JSON и полный ответ 32 КБ, три успешные проверки готовности | `server/tunnel.mjs`      |
| Интернет-HTML, внешние шрифты и кешированный gzip           | `scripts/dev-server.mjs` |

Хозяин играет с локального loopback-адреса, гость — с публичного адреса из `/api/server-info`. Интернет-WSS использует стандартное согласуемое сжатие, LAN по умолчанию без сжатия; протокол 9. Автономный HTML сохраняет встроенные шрифты.

## Общие модули

### Оборона и звук 8.11.2

Пути игровых модулей в таблице указаны от `src/`.

| Механика                                         | Модуль                                                 |
| ------------------------------------------------ | ------------------------------------------------------ |
| Баланс фронтов и ближайший подходящий защитник   | `game/defense/formation.js`                            |
| Повторное занятие и оспаривание укреплений       | `game/defense/positions.js`, `fortifications.js` рядом |
| Непрерывные участки укрытия                      | `game/defense/trench-links.js`                         |
| Пакетная отрисовка рва                           | `rendering/defense/trench-links.js`                    |
| Реакция на прорыв и резерв                       | `game/defense/frontline.js`, `reserves.js` рядом       |
| Атака 30% пехоты                                 | `game/units/ground/defense-attack.js`                  |
| Дозированное планирование больших приказов       | `game/units/ground/orders.js`, `route-queue.js` рядом  |
| Быстрый отказ для несвязанных областей           | `game/units/ground/navigation.js`                      |
| Стабильные кнопки больших групп                  | `ui/deployment.js`                                     |
| Отложенное автосохранение и защита границ сессии | `ui/session/autosave.js`, подключение в `ui/app.js`    |
| Кнопка атаки в составе обороны                   | `ui/army-recruitment.js`                               |
| Цена, охлаждение и нагрев МОГ                    | `game/combat/upgrade-tiers.js`                         |
| Дробная часть темпа МОГ                          | `game/combat/air-defense.js`                           |
| Интервалы парного пуска                          | `game/units/aviation/launch.js`                        |
| Записанные ракеты и артиллерия, ресемплинг       | `audio/ordnance.js`                                    |
| Дистанция, приоритет и микс                      | `audio/game-audio.js`                                  |

Источник и воспроизводимая подготовка аудио: `assets/audio/prepare-ordnance.py`,
`ordnance-sources.json` и `LICENSE.md`. Замер обработчика приказа:
`tests/soak/input-cost.mjs`. Итоговые проверки: [DEFENSE-8112](qa/DEFENSE-8112.md).

Пополнение с индивидуальным назначением: `units/ground/deployment.js`; состав и ожидающие бойцы отряда: `squads.js`; выбор целей, классы брони и упреждение: `engagement.js`. Все пути здесь от `src/game/`. Интерфейс наведения и карточек — `src/ui/deployment.js`; линия пути — `src/rendering/deployment-preview.js`. Формат метаданных проверяется в `game/persistence/squads.js`.

Расход пикселей — `src/rendering/performance/render-budget.js`; общий снимок видимости для отрисовки — `ground-visibility.js` рядом. Разбиение леса — `rendering/terrain/instance-tiles.js`; цветное объединение геометрии — `rendering/mesh-utils.js`; разворот самолётов — `rendering/models/aircraft-motion.js`. Сравнение тяжёлых сцен — `tests/browser/performance.py`, проверка нового набора — `tests/browser/deployment.py`.

`src/game/index.js` — стабильный вход для интерфейса и тестов. `api.js` собирает экспорт правил из тематических файлов. `config.js` собирает справочники и общие функции характеристик. `shared/random.js`, `shared/events.js`, `shared/math.js` обслуживают системы без зависимости от браузера.

`archive/legacy/` нужен только тестам прежнего прототипа. `docs/history/` хранит планы прошлых версий. Готовый `play/Skyfront.html` объединяет текущие исходники и не служит местом ручных изменений.

Зависания 8.11.1: индекс неподвижных препятствий и окопов — `game/shared/static-spatial.js`; ближайшая видимая угроза — `game/units/ground/guard.js`; занятые БТР в обороне — `game/defense/formation.js`. Фиксированные матрицы ландшафта — `rendering/performance/static-scenery.js`, матрицы городских моделей — `static-transforms.js` рядом. Растущие instance buffers и ленивые bounds пехоты — `rendering/models/infantry/soldiers.js`. Очередь периодических обновлений UI — `ui/session/frame-tasks.js`, подключение — `ui/app.js`; каталог армии — `ui/army-recruitment.js`. Сравнение длительности отдельных шагов и полного SHA состояния — `tests/soak/frame-cost.mjs`; условия и ограничения — [STUTTERS-8111.md](qa/STUTTERS-8111.md). Все пути относительно `src/`, кроме `tests/`.

## Карта, нефть и порты (8.6)

- `src/game/map.js` — размеры поля (`MAP`, `FIELD`, `inField`), море (`SEA`, `seaDistance`, `isWater`; `riverDistance` оставлен как совместимая мера «меньше 44 — вода»), коридоры `CORRIDORS`, остров `ISLAND`, месторождения `OIL_FIELDS`, холмы `HILLS` с запечённой сеткой высот (`groundHeight`, `terrainClear` для линии видимости), леса `COVER_PATCHES`.
- `src/game/city/oil.js` — запас, ёмкость, добыча, расход топлива, цена в нефти, пожары хранилищ; `city/ports.js` — суда, причалы, торговля на бирже; `ai/oil-ai.js` — нефть и порт бота; `persistence/oil.js` — проверка и миграция формата 12.
- `src/rendering/terrain/environment.js` — рельеф с цветом по высоте, море с рябью и прибоем, остров с маяком, леса двух видов, месторождения и пограничные посты; `src/rendering/models/city/oil.js` — качалка, резервуар, порт, судно; `src/rendering/ships.js` — пакетная отрисовка судов и кильватерный след.
- `src/game/units/ground/training.js` — учебный полигон: опыт новобранцев и тренировка рядом; `city/road-network.js` (`snapRoadPoint`, `ROAD_GRID`) — привязка улиц к углам, длинам и параллельным направляющим.

Боезапас 8.9: units/ground/ammunition.js; выпуск — city/ammo-production.js; физическая доставка — city/ammo-logistics.js; проверка сохранений — persistence/ammunition.js. Местные склады и запросы доставки аппаратов — units/aviation/launch-supply.js. Городской ремонт по полю — city/service-field-routes.js; пакетная отрисовка обоих парков — rendering/service-fleet.js. Мастер-план последних требований — MASTER_PLAN.md.

# Оригинальный multiplayer server в нативном пакете

`server.mjs` запускает исходный `createRoomServer` из `server/rooms.mjs`.
Правила, ownership, ACK/delta snapshots, PvP и 2×2 coop не переписываются.
Слушает **только 127.0.0.1 на случайном свободном порту**. Не открывает браузер,
не создаёт туннель, не выдаёт loopback за доступный другу интернет-сервер.
Дистрибутив включает лицензии встроенных Node.js и ws в папке `licenses/`.
Для внешней сети нужен тот же доступный сервер, что и прежней браузерной игре.

```powershell
node scripts/build-native-network.mjs
native/build/network/node.exe native/build/network/server.mjs
node native/network/smoke.mjs
```

После bind stdout содержит одну строку:
`{"kind":"server-ready","url":"http://127.0.0.1:PORT","protocol":18}`.
Держите stdin открытым; `{"cmd":"shutdown"}`, EOF, SIGINT или SIGTERM закрывают
только собственный сервер и его комнаты. При ошибке диагностика идёт в stderr.

В `client/Skyfront.html` лежит точная копия прежнего standalone HTML для
обычного браузерного участника. `--client-root=ABS_PATH` позволяет указать
другой упакованный публичный каталог с `Skyfront.html`. Корень и `/index.html`
отдают этот файл, остальные пути ограничены данным каталогом. Исходный HTTP
API сохранён; разрешён CORS от встроенного `http://skyfront.localhost`.

Bundler убирает **только CLI guard** исходного `scripts/dev-server.mjs` в копии
модуля во время сборки: иначе объединённый ESM ошибочно считает imported
dev-server главным модулем и открывает лишний порт/браузер. Исходные файлы
`server/`, `scripts/dev-server.mjs` и `src/game/` не меняются.

Smoke запускает упакованный node/server, подключает два исходных
`NetworkSession`, проверяет отдельные города, готовность, старт, настоящую
оплату стройки и её видимость у обоих, владение, delta snapshots и продвижение
времени для PvP и coop. Состояние и деньги напрямую не подменяются; GPU нет.

## Проверка исходного меню внутри настоящего Godot-окна

`scripts/native-parity-network-qa.js` использует исходные кнопки создания комнаты,
выбора PvP/coop, готовности, старта и выхода. `native/network/native-peer.mjs`
подключает второго участника через исходный `NetworkSession`, без второго GPU и
без запуска дополнительного сервера. Оба участника платят за свои дороги и
постройки, получают изменения второго города и проверяют отказ чужого сноса.

Сначала соберите полный нативный пакет. Следующие команды выполняются из корня
репозитория в двух терминалах. Для каждого прогона используйте новый путь лога:
режим `--follow` читает коды комнат из stdout конкретного запущенного Godot-клиента.

Первый терминал:

```powershell
node native/network/native-peer.mjs --follow artifacts/native/native-network-ui.out.log
```

Второй терминал:

```powershell
$qaRepo = (Get-Location).Path
$qaScript = Join-Path $qaRepo 'scripts/native-parity-network-qa.js'
$qaGame = Start-Process -FilePath (Join-Path $qaRepo 'native/build/parity-windows/Skyfront.exe') -WorkingDirectory $qaRepo -ArgumentList @('--position', '-25000,-25000', '--', '--qa-parity', ('--qa-script="' + $qaScript + '"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $qaRepo 'artifacts/native/native-network-ui.out.log') -RedirectStandardError (Join-Path $qaRepo 'artifacts/native/native-network-ui.err.log')
$qaGame.WaitForExit()
```

`Start-Process` сохраняет исходный UTF-8 stdout; обычное перенаправление через
старую Windows PowerShell может превратить лог в UTF-16, который `--follow`
не читает. Сценарий последовательно создаёт две настоящие комнаты: PvP с двумя
городами, затем coop с четырьмя. Peer также можно подключить вручную по сообщению
`await-network-peer`:

```powershell
node native/network/native-peer.mjs 'ws://127.0.0.1:PORT/match' CODE pvp
```

Итоги peer находятся в `artifacts/native/parity-network-peer-results.json`, а
нативного клиента — в строках `SKYFRONT_PARITY_WEB_QA`. Проверенный прогон
`parity-native-network2.out.log` прошёл **23/23** проверки обоих режимов. Это
проверка loopback, а не обещание публичного интернет-хостинга.

Возврат из сети сравнивается со всем результатом исходного `E.load(E.save(state))`,
без исключения полей. Исходный загрузчик увеличивает `networkRevision`: в этом
прогоне изменения `6→7` и `7→8` точно совпали с браузерным контрактом; других
отличий от ожидаемого состояния не обнаружено.

## Два настоящих нативных клиента

`scripts/native-parity-dual-native.mjs` запускает настоящий Host и настоящий Guest
из одного Windows-пакета. Шаблон Guest — `scripts/native-parity-dual-native-guest.js`;
Host использует `scripts/native-parity-network-qa.js`. Coordinator не подменяет
сетевой клиент: оба окна проходят исходные формы создания/входа, готовность и
старт, получают авторитетные снимки и отрисовывают их Godot. Одновременно работают
максимум два созданных им клиента; перед следующим Guest предыдущий должен выйти.
При ошибке coordinator завершает только собственные дочерние процессы.

Проверка генерации сценариев без запуска окна или сервера:

```powershell
node scripts/native-parity-dual-native.mjs --prepare-only --mode coop --no-capture --output artifacts/native/dual-native-preflight-check
```

Для функциональной приёмки используйте отдельный новый каталог на каждый прогон.
Вместо пути по умолчанию можно передать полный путь к проверяемому `Skyfront.exe`:

```powershell
node scripts/native-parity-dual-native.mjs --exe native/build/parity-windows/Skyfront.exe --mode coop --no-capture --resolution 960x540 --output artifacts/native/dual-native-coop-check
node scripts/native-parity-dual-native.mjs --exe native/build/parity-windows/Skyfront.exe --mode pvp --no-capture --resolution 960x540 --output artifacts/native/dual-native-pvp-check
```

Без `--mode` выполняются оба режима последовательно. Без `--no-capture` каждый
клиент также запрашивает нативный PNG при завершении. Этот флаг убирает только
запрос снимка; исходные сетевые проверки, настоящий Godot ACK, проверка кодов
завершения и пустого stderr сохраняются. `--resolution` уменьшает размер окна
для двух контекстов на одном компьютере и не превращает этот тест в FPS-бенчмарк.

В `report.json` находятся проверки обоих клиентов, совпадение ID оплаченных
зданий/дорог, полный результат восстановления через исходный `E.load`, коды
завершения и stderr. Отдельные UTF-8 логи и UTC-таймлайн фиксируют `bootstrap`,
`native-ready`, `first-scene`, `first-scene-ack` и транспортные сообщения.

Фактические результаты на Ryzen5 3500U / Vega8:

- Изолированный `dual-native-pvp-only/report.json` завершился полностью успешно:
  два города, **12/12 Host + 13/13 Guest**, оба процесса вышли с кодом0,
  stderr пуст. Совпали ID оплаченных зданий/дорог, исходные проверки владения,
  Godot ACK и полный ожидаемый результат восстановления через `E.load`.
- Изолированный `dual-native-coop-only/report.json` завершился полностью успешно:
  четыре города, **12/12 Host + 13/13 Guest**, оба процесса вышли с кодом0,
  stderr пуст. Совпали ID оплаченных объектов у двух настоящих нативных клиентов
  и весь ожидаемый результат восстановления локальной кампании.
- В `dual-native-021-nocapture` фаза PvP прошла функциональные проверки Host,
  включая возврат из сети, и **13/13 Guest с exit0**. Весь последовательный прогон
  не прошёл: следующий холодный Guest-coop не получил первый ACK за100 секунд.
  Bootstrap и `first-scene` были достигнуты; перед этим собственный Node-сервис
  исчерпал15-секундное ожидание. Это не полный успешный изолированный прогон PvP.
- Первый `dual-native-021` со снимками прошёл13 проверок Guest-PvP, но затем
  завершился ошибкой ACK при выходе, до создания PNG. Повтор без снимков позволил
  Guest-PvP выйти с кодом0. Причина первого сбоя полностью не локализована;
  его результат не считается успешным.

Оба режима прошли отдельно без запроса снимков; это не меняет FAIL ранних
последовательного batch и capture-прогона. Причина их ресурсных/временных сбоев
полностью не профилирована, production-таймауты не увеличивались.

Эта приёмка подтверждает функциональную работу двух нативных клиентов через
loopback. Она не подтверждает публичный интернет-хостинг, производительность
массового боя или отсутствие всех задержек холодного старта.

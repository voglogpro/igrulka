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

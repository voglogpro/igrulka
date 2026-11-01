# BrowserHost — исходный интерфейс поверх Godot

Отдельный STA-процесс для WebView2. Он не заменяет 3D браузерным изображением:
цель — сохранить исходные DOM/UI/JavaScript-механики, пока Godot рисует мир.
Контроллер создаётся непосредственно для HWND, переданного Godot. Отдельного
видимого окна в обычном режиме нет; helper держит WinForms message pump.

`Skyfront.BrowserHost.exe --self-test` проверяет ограничение очереди,
порядок ресурсов и замену только полных снимков; окно и GPU не запускаются.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-browser-host.ps1
native/build/browser-host/Skyfront.BrowserHost.exe --parent-hwnd 12345 --web-root C:/path/to/packaged-web --user-data C:/path/to/native-profile
```

Точный SDK: официальный `Microsoft.Web.WebView2` **1.0.4314.35**, полученный
из NuGet `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4314.35/microsoft.web.webview2.1.0.4314.35.nupkg`.
Кэш SDK — `.tools/nuget/browser-host-feed`; сборка не меняет глобальные PATH,
политики Windows или установленный браузер. Self-contained output не требует
отдельного .NET, но использует установленный WebView2 Runtime.
SHA-256 официального nupkg:
`90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4`.

## Протокол

- Страница: `http://skyfront.localhost/index.html`; файлы только из `--web-root`.
  HTTP localhost сохраняет работу прежних `ws://` LAN-адресов. Другие страницы
  не получают мост. `--url` разрешён только внутри этого виртуального origin.
- Сообщение документа `window.chrome.webview.postMessage(object)` проходит
  без переименования в stdout как одна строка JSON.
- JSON-объект из stdin проходит в `chrome.webview` событие `message`.
- Статусы helper: `host-ready`, `host-error`, `host-closed`, `host-capture`.
- Каждое направление имеет максимум 64 сообщения, строка максимум 32 MiB.
  Полные снимки могут задать `coalesceKey`; очередь заменяет предыдущий
  ожидающий снимок с тем же ключом. Дельты/ресурсы так помечать нельзя.
  Переполнение обычной очереди явно завершает helper, не накапливает лаг.
- `{kind:"host-command",command:"close"|"focus"|"reload"}` — управление helper.
  Все обращения WebView2 выполняются в его UI/STA-потоке, без Wait/Result.
- Только доверенный stdin поддерживает QA RPC
  `{kind:"host-eval",id,script}` → `{kind:"host-eval-result",id,result}`.
  `result` — JSON-строка WebView2 ExecuteScriptAsync. Асинхронный сценарий
  сам отправляет `qa-result` через postMessage. Страница и сеть не получают
  возможность выполнить этот RPC внутри helper.
- Размер следует client rect родителя, сворачивание скрывает контроллер;
  EOF stdin, потеря родителя и его закрытие завершают собственный helper.

## Собственный проверочный экран

```powershell
native/build/browser-host/Skyfront.BrowserHost.exe --proof --capture C:/path/to/artifacts/webview-proof.png
```

Создаёт только собственное окно за пределами экрана. После загрузки берёт
PNG через WebView2 CapturePreviewAsync и проверяет alpha=0 у пустого угла.
Это снимок **только собственного WebView**, без рабочего стола и без слоя
Godot. Он подтверждает прозрачность WebView, но реальное совмещение с HWND
Godot и управление необходимо отдельно проверить интеграционно.

Только для offscreen QA `SKYFRONT_NATIVE_QA=1` отключает Chromium occlusion и
background timer throttling; это позволяет исходному requestAnimationFrame
работать за пределами экрана. В обычной игре эти флаги не устанавливаются.

## Прозрачность над Windows/OpenGL

Перед созданием WebView2 helper снимает у переданного родительского HWND только
`WS_CLIPCHILDREN` (`0x02000000`). Иначе Godot/OpenGL исключает из своей отрисовки
всю область дочернего WebView, и за прозрачным HTML получается пустое белое поле.
Стиль класса `CS_OWNDC` сохраняется. `host-ready.parentComposition` сообщает исходный
и текущий стиль окна, стиль класса и фактическое снятие флага. При завершении helper
возвращает только снятый им бит, сохраняя остальные текущие настройки окна Godot.
Для диагностического сравнения можно задать `SKYFRONT_WEBVIEW_UNCLIP_PARENT=0`;
в обычном запуске исправление включено.

Та же проблема воспроизведена в [Godot/Wry issue 1540](https://github.com/tauri-apps/wry/issues/1540),
где автор подтвердил решение из [Bevy issue 16544](https://github.com/bevyengine/bevy/issues/16544).
Проверка alpha через CapturePreviewAsync отдельно не доказывает корректное совмещение
слоёв: для принятия исправления нужен снимок только собственного видимого HWND игры.

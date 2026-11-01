# Настоящий Windows-ввод и экспорт в Native

`scripts/native-parity-input-export-qa.js` требует настоящих доверенных событий
Windows для Start, W и кнопки экспорта. Настройки открываются существующей
DOM-кнопкой. Сценарий не подменяет `Blob`, `URL`, загрузчик файлов или сохранение;
он вычисляет SHA-256 исходного `E.save(state)` до клика и проверяет неизменность
этой строки при доверенном клике. Содержимое сохранения в лог не выводится.

Сначала соберите нативный пакет. Команды ниже выполняются из корня репозитория;
каталоги результата должны быть новыми. В явном whitelist helper находятся
только соседние папки `Skyfront-Native-0.2-Windows` и
`Skyfront-Native-0.2.1-Windows`; это намеренно не общий доступ ко всем окнам.

```powershell
$qaRepo = (Get-Location).Path
$qaExe = Join-Path (Split-Path -Parent $qaRepo) 'Skyfront-Native-0.2.1-Windows/Skyfront.exe'
$qaScript = Join-Path $qaRepo 'scripts/native-parity-input-export-qa.js'
$qaStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$qaStdout = Join-Path $qaRepo ('artifacts/native/input-export-' + $qaStamp + '.out.log')
$qaStderr = Join-Path $qaRepo ('artifacts/native/input-export-' + $qaStamp + '.err.log')
$qaResult = 'artifacts/native/input-export-' + $qaStamp
$qaGame = Start-Process -FilePath $qaExe -WorkingDirectory $qaRepo -ArgumentList @('--position', '-25000,-25000', '--', '--qa-parity', ('--qa-script="' + $qaScript + '"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput $qaStdout -RedirectStandardError $qaStderr
node scripts/native-parity-input-export.mjs --pid $qaGame.Id --follow $qaStdout --downloads "$env:USERPROFILE/Downloads" --output $qaResult
$qaGame.WaitForExit()
```

Если загрузки сохраняются в другом каталоге, передайте его явно вместо
`$env:USERPROFILE/Downloads`. Запускайте coordinator сразу после игры, не ожидая
стадии вручную. Он не запускает и не завершает игровой процесс: управляет только
собственным PowerShell-worker и проверкой нового файла.

`native-parity-input-worker.ps1` один раз компилирует C# из
`native-parity-owned-input.ps1`, привязывает PID, время создания процесса и точный
путь EXE. Перед кликом проверяются HWND владельца и `WindowFromPoint`; перед W —
foreground root и отсутствие уже удерживаемых модификаторов/W. Клавиша отпускается
в `finally`. Cursor и прежнее foreground-окно восстанавливаются. `KeepVisible`
сохраняет геометрию собственного окна между этапами, не оставляя его topmost.

Сначала coordinator выполняет `RevealOnly`, не отправляя ввод. После возможного
изменения DPI/layout он ждёт два свежих стабильных сообщения point/viewport.
Координаты CSS переводятся в физические клиентские пиксели. Если этап не
продвигается после одного клика, повторного слепого клика нет: сохраняется только
изображение собственного окна и отчёт об отказе. Ожидания этапов относятся только
к QA-сценарию; производственные таймауты не меняются.

`native-parity-verify-export.ps1` рассматривает только новый файл после указанного
UTC с запрошенным именем `skyfront-city-N.json` или стандартным суффиксом `(N)`.
Он сверяет размер и SHA-256; другие файлы Downloads не читает. JSON-вывод задаёт
UTF-8 явно, поэтому кириллица в пути сохраняется при запуске из Node.

Проверенный `artifacts/native/input-export-auto-1/report.json`: **16/16** проверок,
настоящий Start, W с запросом удержания330мс, движение desired и самой камеры,
Godot ACK и настоящий клик экспорта. Новый файл4609байт совпал с SHA-256
`1bd1e6e19afd9876faebb625ce53cbbb26e4ec02428d0bb20028e37c0aa2a734`;
игровой stderr пуст. Повторная узкая read-only проверка того же файла записана в
`file-utf8-reverified.json` и подтвердила исправленный вывод кириллического пути.

Ранний ручной прогон не дождался доверенного Start за120секунд. Его причина не
локализована; он не считается успешным. Автоматический прогон выше принят
отдельно. Эта проверка подтверждает конкретный путь Windows-ввода и реального
экспорта, а не все возможные раскладки, устройства, многопользовательскую связь
или производительность массового боя.

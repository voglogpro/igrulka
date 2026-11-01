# Настоящий Windows FilePicker в Native

`scripts/native-parity-filepicker-qa.js` проверяет исходный импорт через настоящий
Windows-диалог. Start, настройки и импорт получают реальные доверенные щелчки
собственного окна. Затем helper выбирает только ранее подтверждённый собственный
экспорт; исходные `#import-file`, чтение файла, сохранение и перезагрузка страницы
работают без подмены. `DataTransfer`, присваивание FileList, замена FileReader и
прямая запись игрового состояния не используются.

## Подготовка и запуск

Команды выполняются из корня репозитория. Нужен отдельный соседний пакет
`Skyfront-Native-0.2.1-Windows` и подтверждённый отчёт собственного экспорта из
[NATIVE-INPUT-QA.md](NATIVE-INPUT-QA.md). Этот узкий сценарий намеренно привязан к
уже проверенному файлу 4609 байт с SHA-256
`1bd1e6e19afd9876faebb625ce53cbbb26e4ec02428d0bb20028e37c0aa2a734`.
Нельзя подставлять произвольное пользовательское сохранение.

CPU-подготовка читает только файл из явно указанного отчёта и сначала сверяет его
размер/SHA. Генератор вычисляет ожидаемый результат исходной цепочки
`E.load -> E.save -> E.load`: первая загрузка происходит при импорте, вторая —
после настоящего reload. Он записывает fixture в игнорируемый `artifacts/native`,
а в stdout выводит только метаданные. Полный JSON в tracked-файлы и логи не попадает.

```powershell
$qaVerified = 'artifacts/native/input-export-auto-1/file-utf8-reverified.json'
node scripts/native-parity-filepicker-fixture.mjs $qaVerified artifacts/native/real-filepicker-qa.js
powershell.exe -Mta -NoProfile -ExecutionPolicy Bypass -File scripts/native-parity-owned-filepicker.ps1 -CompileOnly
```

Для реальной проверки coordinator нужно запустить сразу после своего Native,
не ожидая стадии вручную. Каталог результата и stdout должны быть новыми.

```powershell
$qaRepo = (Get-Location).Path
$qaExe = Join-Path (Split-Path -Parent $qaRepo) 'Skyfront-Native-0.2.1-Windows/Skyfront.exe'
$qaScript = Join-Path $qaRepo 'artifacts/native/real-filepicker-qa.js'
$qaStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$qaStdout = Join-Path $qaRepo ('artifacts/native/filepicker-' + $qaStamp + '.out.log')
$qaStderr = Join-Path $qaRepo ('artifacts/native/filepicker-' + $qaStamp + '.err.log')
$qaResult = 'artifacts/native/filepicker-' + $qaStamp
$qaGame = Start-Process -FilePath $qaExe -WorkingDirectory $qaRepo -ArgumentList @('--position', '-25000,-25000', '--', '--qa-parity', ('--qa-script="' + $qaScript + '"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput $qaStdout -RedirectStandardError $qaStderr
node scripts/native-parity-filepicker.mjs --pid $qaGame.Id --follow $qaStdout --verified-export-report $qaVerified --output $qaResult
$qaCoordinatorExit = $LASTEXITCODE
$qaGame.WaitForExit()
[pscustomobject]@{ coordinatorExit = $qaCoordinatorExit; nativeExit = $qaGame.ExitCode; stderrBytes = (Get-Item -LiteralPath $qaStderr).Length }
```

Coordinator сам не запускает и не завершает игру. Его уже принятый hardware-worker
проверяет PID, время запуска, точный EXE, foreground root и `WindowFromPoint`.
После RevealOnly он ждёт свежие стабильные CSS-координаты. Работает отдельный
процесс helper, подготовленный до открытия модального диалога. JSON stdin/stdout
используют UTF-8, включая кириллицу в путях.

## Границы действий диалога

Helper рассматривает только процессы, доказанно происходящие от указанного
Native: точный упакованный BrowserHost и установленный WebView2. PID и время
создания проверяются повторно. `EnumThreadWindows` ограничен их потоками;
глобального перечисления окон или desktop UIA нет. Требуются единственный видимый
`#32770`, принадлежащая тому же дереву цепочка owner/parent и foreground этого
диалога.

`GetDlgItem1148` должен дать единственную цепочку
`ComboBoxEx32 -> ComboBox -> Edit` или её точный ComboBox/Edit либо Edit хвост.
Каждый HWND должен быть видимым, разрешённым дочерним окном того же диалога с
проверенным PID. Только этот Edit получает `WM_SETTEXT` с подтверждённым
абсолютным путём. `GetDlgItem1` должен иметь class Button; только ему отправляется
`BM_CLICK`. Перед каждым действием заново проверяются владельцы, PID+StartTime,
идентичность контролов, foreground и SHA файла. `SendMessageTimeout` ограничен
пятью секундами.

Helper не читает Name, текущее значение filename или списки каталогов. Метаданные
контролов содержат только class/id. Неизвестные и неоднозначные цепочки отвергаются.
Нет clipboard, SendKeys, снимков диалога, общих скриншотов при отказе или доступа
к посторонним Downloads. CompileOnly выполняет 10 проверок нативной политики и 6
проверок прежних дескрипторов без перечисления окон и без ввода.

## Зафиксированный результат

`artifacts/native/real-filepicker-auto-4/report.json` — **PASS**, **14/14**
браузерных проверок, `ownedPickerPassed:true`. Исходный импорт получил доверенный
клик и доверенное изменение FileList от настоящего диалога, выполнил reload и
совпал со всеми полями исходной цепочки загрузчика: число различий 0,
ожидаемая/фактическая revision 8/8. Исходный экран «Продолжить» открыт на паузе.
Реестр подтверждённого кадра Godot совпал с исходными 2800 объектами.

Coordinator завершился с exit0; hardware-worker и picker-helper также exit0 с
пустым stderr. Игровой лог `parity-real-filepicker4.out.log` содержит успешное
завершение, игровой stderr пуст. Этот функциональный сценарий использует маленькое
собственное сохранение и не доказывает импорт любых повреждённых/больших файлов,
все физические жесты или производительность боя.

Первые три попытки остались FAIL до изменения filename: провайдер UIA отдавал
три непрозрачные Pane 1148 без ValuePattern и без raw descendants. Их не объявляют
успешными. Четвёртая попытка прошла через подтверждённые нативные контролы, без
изменения production-кода или исходного импортёра.

Контракты Windows: [GetDlgItem](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdlgitem),
[IsChild](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-ischild),
[WM_SETTEXT](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-settext),
[BM_CLICK](https://learn.microsoft.com/en-us/windows/win32/controls/bm-click),
[SendMessageTimeout](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw).

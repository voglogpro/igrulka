# Инструменты для нативной версии

Проверено 1 ноября 2026 на Windows x64. Цепочка разработки доступна и
проверена локально. Полная игра, экспорт Windows Release, импорт новых
моделей и измерение GPU на этом этапе не выполнены.

## Зафиксированные версии

| Инструмент   | Версия                       | Проверка                                                                                 |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------------- |
| Godot .NET   | 4.7.2 stable, `ed1daf0bf`    | C#-проект собран и действительно исполнен движком headless                               |
| .NET SDK x64 | 10.0.403                     | Локальный SDK, сборка `net10.0` без ошибок и предупреждений                              |
| .NET runtime | 10.0.14                      | Версия получена из исполняемого C#-проекта                                               |
| Blender      | 4.5.14 LTS                   | Найден прежний переносимый инструмент, `--version` проверен; новый экспорт не запускался |
| FFmpeg       | Имеется локальный executable | Найден для будущей офлайн-конвертации Opus; новые записи/конверсии не делались           |

Godot и SDK распакованы в игнорируемую `.tools/` этой рабочей копии. Машинный
PATH, ассоциации файлов и настройки драйвера не изменялись. Скрипт проверки
задаёт окружение только на время своего процесса и восстанавливает его.
Экспортные шаблоны Godot пока не загружались: они понадобятся на этапе
реального Windows-пакета. Из headless-успеха не следует успех такого экспорта.

Godot .NET и SDK скачаны с официальных адресов; архивы проверены до запуска.
Godot asset SHA-256 взят из метаданных GitHub Releases, SDK SHA-512 — из
официального release manifest Microsoft. Это проверки соответствия выбранным
публикациям, не отдельная проверка цифровой подписи издателя.

| Архив                                | Контрольная сумма                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Godot_v4.7.2-stable_mono_win64.zip` | SHA-256 `a2a48473a7414c5f19fab690518caebb738c09ef9601f6bd2388676a7f53b3c0`                                                                 |
| `dotnet-sdk-10.0.403-win-x64.zip`    | SHA-512 `7a114c318fa7f1d9822991b534b2814d0e78386ceda816b371f5141acefe741d87ccb606ede06cadac8f9ac5070e32b708a67bbd1619ff5e5a7858a27874ef48` |

Источники:

- [Godot release](https://github.com/godotengine/godot-builds/releases/tag/4.7.2-stable).
- [Godot .NET ZIP](https://github.com/godotengine/godot-builds/releases/download/4.7.2-stable/Godot_v4.7.2-stable_mono_win64.zip).
- [Microsoft SDK](https://dotnet.microsoft.com/en-us/download/dotnet/10.0).
- [Microsoft release manifest](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json).

## Повторить диагностику

После скачивания и проверки тех же версий распаковать их в:

```text
.tools/godot/dotnet-4.7.2/Godot_v4.7.2-stable_mono_win64/
.tools/dotnet/10.0.403/
```

Из корня репозитория:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-native-toolchain.ps1
```

`ExecutionPolicy` здесь относится только к дочернему процессу; постоянную
политику Windows не меняем. Можно передать другие расположения тех же версий:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-native-toolchain.ps1 -GodotRoot 'C:/Tools/Godot_v4.7.2-stable_mono_win64' -SdkRoot 'C:/Tools/dotnet-10.0.403'
```

Помощник создаёт только отсутствующий локальный `tools/engine-probe/NuGet.Config`
с поставляемым Godot NuGet-каталогом. Существующий конфиг не перезаписывается.
Зависимости берутся локально, кеш и первый запуск SDK остаются в `.tools/`
и `artifacts/`. Не нужно менять пользовательский глобальный NuGet.Config.

## Что подтвердил запуск

`tools/engine-probe/SkyfrontEngineProbe.csproj` использует Godot.NET.Sdk 4.7.2
и `net10.0`. Движок запустил `EngineProbe.cs`, создал одну общую сетку и четыре
MultiMesh по 128 экземпляров, затем штатно завершился. Получен маркер:

```json
{
  "status": "pass",
  "godot": "4.7.2-stable (official)",
  "dotnet": "10.0.14",
  "display": "headless",
  "sharedMeshes": 1,
  "multiMeshChunks": 4,
  "instancesCreated": 512,
  "gameSimulationTested": false,
  "gpuPerformanceMeasured": false
}
```

Это проверка загрузки managed-кода и API ресурсов. Она не рисовала 512
солдат, не запускала их AI и не доказывает FPS. Лог пишется в игнорируемый
`artifacts/engine-prep/godot-probe.log`; подтверждение исполнения обязательно,
одного нулевого exit code недостаточно. При неуспехе помощник завершится ошибкой.

Следующая проверка — графический фрагмент и реальный Windows export,
затем [аппаратная матрица](VALIDATION.md). Оригинальные игровые тесты JS
остаются эталоном механик, но не заменяют тестирование будущего C#-ядра.

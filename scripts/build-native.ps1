param([switch]$DebugBuild)
$ErrorActionPreference = 'Stop'
$nativeRepo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $nativeRepo
$nativeProject = Join-Path $nativeRepo 'native/Skyfront.Client'
$nativeTools = Join-Path $nativeRepo '.tools/godot/dotnet-4.7.2/Godot_v4.7.2-stable_mono_win64'
$nativeEngine = Join-Path $nativeTools 'Godot_v4.7.2-stable_mono_win64.exe'
$nativeSdk = Join-Path $nativeRepo '.tools/dotnet/10.0.403'
Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class SkyfrontBuildPaths { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string p, StringBuilder b, uint n); }'
$nativeSdkShort = [Text.StringBuilder]::new(4096)
[void][SkyfrontBuildPaths]::GetShortPathName($nativeSdk, $nativeSdkShort, 4096)
if ($nativeSdkShort.Length -gt 0) { $nativeSdk = $nativeSdkShort.ToString() }
$env:DOTNET_ROOT = $nativeSdk
$env:PATH = "$nativeSdk;$env:PATH"
$env:DOTNET_CLI_HOME = Join-Path $nativeRepo 'artifacts/engine-prep/dotnet-home'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:MSBUILDDISABLENODEREUSE = '1'
$env:DOTNET_CLI_USE_MSBUILD_SERVER = '0'
$env:UseSharedCompilation = 'false'
$env:NUGET_PACKAGES = Join-Path $nativeRepo '.tools/nuget/packages'
$nativeOutput = Join-Path $nativeRepo 'native/build/windows'
New-Item -ItemType Directory -Path $nativeOutput -Force | Out-Null
$nativeFeed = [Security.SecurityElement]::Escape((Join-Path $nativeTools 'GodotSharp/Tools/nupkgs'))
$nativeConfig = '<configuration><packageSources><clear/><add key="Godot-local" value="'+$nativeFeed+'"/></packageSources></configuration>'
[IO.File]::WriteAllText((Join-Path $nativeProject 'NuGet.Config'), $nativeConfig, [Text.UTF8Encoding]::new($false))
& node scripts/stage-native-audio.mjs
if ($LASTEXITCODE -ne 0) { throw 'Audio staging failed' }
& node scripts/build-native-runtime.mjs (Join-Path $nativeOutput 'runtime')
if ($LASTEXITCODE -ne 0) { throw 'Rules bundling failed' }
$nativeTemplateRoot = (Join-Path $nativeRepo '.tools/godot/templates').Replace('\','/')
$nativePreset = @"
[preset.0]
name="Windows"
platform="Windows Desktop"
runnable=true
advanced_options=false
export_filter="all_resources"
include_filter=""
exclude_filter="*.md,NuGet.Config,*.csproj,*.sln"
export_path=""
script_export_mode=2

[preset.0.options]
custom_template/debug="$nativeTemplateRoot/windows_debug_x86_64.exe"
custom_template/release="$nativeTemplateRoot/windows_release_x86_64.exe"
binary_format/embed_pck=false
binary_format/architecture="x86_64"
codesign/enable=false
dotnet/include_scripts_content=false
dotnet/include_debug_symbols=false
dotnet/embed_build_outputs=false
"@
[IO.File]::WriteAllText((Join-Path $nativeProject 'export_presets.cfg'), $nativePreset, [Text.UTF8Encoding]::new($false))
& "$nativeSdk/dotnet.exe" build (Join-Path $nativeProject 'Skyfront.Client.csproj') --nologo --disable-build-servers
if ($LASTEXITCODE -ne 0) { throw 'Native compilation failed' }
$nativeImportLog = Join-Path $nativeRepo 'artifacts/native/last-import.log'
$nativeImportArgs = '--headless --editor --path "' + $nativeProject + '" --import --quit --log-file "' + $nativeImportLog + '"'
$nativeImport = Start-Process -FilePath $nativeEngine -ArgumentList $nativeImportArgs -WindowStyle Hidden -PassThru
$null = $nativeImport.Handle
if (-not $nativeImport.WaitForExit(180000)) { $nativeImport.Kill(); throw 'Godot import timed out' }
$nativeImport.Refresh()
if ($nativeImport.ExitCode -ne 0) { throw 'Godot import failed' }
$nativeExportMode = if ($DebugBuild) { '--export-debug' } else { '--export-release' }
$nativeExportLog = Join-Path $nativeRepo 'artifacts/native/last-export.log'
$nativeExportArgs = '--headless --path "' + $nativeProject + '" ' + $nativeExportMode + ' Windows "' + (Join-Path $nativeOutput 'Skyfront.exe') + '" --quit --log-file "' + $nativeExportLog + '"'
$nativeExport = Start-Process -FilePath $nativeEngine -ArgumentList $nativeExportArgs -WindowStyle Hidden -PassThru
$null = $nativeExport.Handle
if (-not $nativeExport.WaitForExit(300000)) { $nativeExport.Kill(); throw 'Godot export timed out' }
$nativeExport.Refresh()
if ($nativeExport.ExitCode -ne 0) { throw 'Windows export failed' }
if (Select-String -LiteralPath $nativeExportLog -SimpleMatch 'ERROR:' -Quiet) {
    throw 'Godot reported an export error; package is not accepted'
}
if (-not (Get-ChildItem -LiteralPath $nativeOutput -Recurse -Filter Skyfront.Client.dll -File)) {
    throw 'Export omitted the managed game assembly; package is not playable'
}
New-Item -ItemType Directory -Path (Join-Path $nativeOutput 'licenses') -Force | Out-Null
Copy-Item -Path native/licenses/* -Destination (Join-Path $nativeOutput 'licenses') -ErrorAction Stop
Copy-Item -LiteralPath native/Skyfront.Client/Assets/audio/README.md -Destination (Join-Path $nativeOutput 'licenses/NATIVE-AUDIO.md')
Copy-Item -LiteralPath native/Skyfront.Client/Assets/effects/Kenney-License.txt -Destination (Join-Path $nativeOutput 'licenses/KENNEY-EFFECTS.txt')
Copy-Item -LiteralPath native/README-WINDOWS.txt -Destination (Join-Path $nativeOutput 'README.txt')
Write-Output "Ready: $nativeOutput"

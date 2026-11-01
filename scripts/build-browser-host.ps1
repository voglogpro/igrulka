param([switch]$FrameworkDependent)
$ErrorActionPreference = 'Stop'
$hostRepo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $hostRepo
$hostProject = Join-Path $hostRepo 'native/BrowserHost'
$hostSdk = Join-Path $hostRepo '.tools/dotnet/10.0.403'
$hostFeed = Join-Path $hostRepo '.tools/nuget/browser-host-feed'
$runtimeFeed = Join-Path $hostRepo '.tools/godot/dotnet-4.7.2/Godot_v4.7.2-stable_mono_win64/GodotSharp/Tools/nupkgs'
$hostPackage = Join-Path $hostFeed 'microsoft.web.webview2.1.0.4314.35.nupkg'
if (-not (Test-Path -LiteralPath $hostPackage)) { throw 'Missing official WebView2 SDK 1.0.4314.35 in .tools/nuget/browser-host-feed; see native/BrowserHost/README.md' }
$env:DOTNET_ROOT = $hostSdk
$env:DOTNET_CLI_HOME = Join-Path $hostRepo 'artifacts/engine-prep/dotnet-home'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:MSBUILDDISABLENODEREUSE = '1'
$env:DOTNET_CLI_USE_MSBUILD_SERVER = '0'
$env:UseSharedCompilation = 'false'
$env:NUGET_PACKAGES = Join-Path $hostRepo '.tools/nuget/packages'
$feed1 = [Security.SecurityElement]::Escape($hostFeed)
$feed2 = [Security.SecurityElement]::Escape($runtimeFeed)
$config = '<configuration><packageSources><clear/><add key="WebView2-local" value="'+$feed1+'"/><add key="Runtime-local" value="'+$feed2+'"/></packageSources></configuration>'
[IO.File]::WriteAllText((Join-Path $hostProject 'NuGet.Config'), $config, [Text.UTF8Encoding]::new($false))
$hostOutput = Join-Path $hostRepo 'native/build/browser-host'
$selfContained = if ($FrameworkDependent) { 'false' } else { 'true' }
& (Join-Path $hostSdk 'dotnet.exe') publish (Join-Path $hostProject 'Skyfront.BrowserHost.csproj') -c Release -r win-x64 --self-contained $selfContained --nologo --disable-build-servers -o $hostOutput
if ($LASTEXITCODE -ne 0) { throw 'BrowserHost publish failed' }
$sdkLicense = Join-Path $env:NUGET_PACKAGES 'microsoft.web.webview2/1.0.4314.35/LICENSE.txt'
if (Test-Path -LiteralPath $sdkLicense) { Copy-Item -LiteralPath $sdkLicense -Destination (Join-Path $hostOutput 'WEBVIEW2-SDK-LICENSE.txt') }
$sdkNotice = Join-Path $env:NUGET_PACKAGES 'microsoft.web.webview2/1.0.4314.35/NOTICE.txt'
if (Test-Path -LiteralPath $sdkNotice) { Copy-Item -LiteralPath $sdkNotice -Destination (Join-Path $hostOutput 'WEBVIEW2-SDK-NOTICE.txt') }
Write-Output "Ready: $hostOutput"

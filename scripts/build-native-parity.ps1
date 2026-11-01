param([switch]$SkipHost, [switch]$SkipWeb)
$ErrorActionPreference = 'Stop'
$parityRepo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $parityRepo
if (-not $SkipWeb) {
    & node scripts/build-native-parity-web.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Original game web bundle failed' }
}
if (-not $SkipHost) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-browser-host.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Original interface host failed' }
}
& node scripts/build-native-network.mjs
if ($LASTEXITCODE -ne 0) { throw 'Original multiplayer server bundle failed' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1
if ($LASTEXITCODE -ne 0) { throw 'Godot build failed' }
$parityOutput = Join-Path $parityRepo 'native/build/parity-windows'
New-Item -ItemType Directory -Path $parityOutput -Force | Out-Null
foreach ($part in @('Skyfront.exe', 'Skyfront.pck', 'data_Skyfront.Client_windows_x86_64', 'licenses')) {
    Copy-Item -LiteralPath (Join-Path $parityRepo ('native/build/windows/' + $part)) -Destination $parityOutput -Recurse -Force
}
$hostOutput = Join-Path $parityRepo 'native/build/browser-host'
$webOutput = Join-Path $parityRepo 'native/build/parity-web'
New-Item -ItemType Directory -Path (Join-Path $parityOutput 'browser'), (Join-Path $parityOutput 'web'), (Join-Path $parityOutput 'network') -Force | Out-Null
Get-ChildItem -LiteralPath $hostOutput -Force | Copy-Item -Destination (Join-Path $parityOutput 'browser') -Recurse -Force
Get-ChildItem -LiteralPath $webOutput -Force | Copy-Item -Destination (Join-Path $parityOutput 'web') -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $parityRepo 'native/build/network') -Force | Copy-Item -Destination (Join-Path $parityOutput 'network') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $parityRepo 'native/README-PARITY.txt') -Destination (Join-Path $parityOutput 'README.txt')
foreach ($terrainLicense in @('README.md','provenance.json','CC0-1.0.txt')) {
    Copy-Item -LiteralPath (Join-Path $parityRepo ('native/Skyfront.Client/Assets/terrain/'+$terrainLicense)) -Destination (Join-Path $parityOutput ('licenses/TERRAIN-'+$terrainLicense))
}
Write-Output "Full original game + Godot: $parityOutput"

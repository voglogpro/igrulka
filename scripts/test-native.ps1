param(
    [string]$PackageRoot = '',
    [string]$FixturePath = '',
    [string]$Name = 'launch',
    [switch]$Flow
)
$ErrorActionPreference = 'Stop'
$qaRepo = Split-Path -Parent $PSScriptRoot
if (-not $PackageRoot) { $PackageRoot = Join-Path $qaRepo 'native/build/windows' }
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
if ($Name -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Use a simple alphanumeric QA name' }
$qaRoot = Join-Path $qaRepo 'artifacts/native'
New-Item -ItemType Directory -Path $qaRoot -Force | Out-Null
$qaImage = Join-Path $qaRoot "$Name.png"
$qaOut = Join-Path $qaRoot "$Name.out.log"
$qaErr = Join-Path $qaRoot "$Name.err.log"
$qaArgs = @('--position', '-25000,-25000', '--resolution', '1280x720', '--disable-vsync', '--print-fps', '--quit-after', '2400', '--', '--qa', ('"--capture=' + $qaImage + '"'))
if ($FixturePath) {
    $FixturePath = (Resolve-Path -LiteralPath $FixturePath).Path
    $qaArgs += ('"--fixture=' + $FixturePath + '"')
}
if ($Flow) { $qaArgs += '--qa-flow' }
$env:DOTNET_ROOT = $null
$qaProcess = Start-Process -FilePath (Join-Path $PackageRoot 'Skyfront.exe') -WorkingDirectory $PackageRoot -ArgumentList $qaArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $qaOut -RedirectStandardError $qaErr
$qaHandle = $qaProcess.Handle
if (-not $qaProcess.WaitForExit(60000)) {
    $qaChildren = Get-CimInstance Win32_Process -Filter ("ParentProcessId = " + $qaProcess.Id)
    $qaProcess.Kill()
    foreach ($qaChild in $qaChildren) { Stop-Process -Id $qaChild.ProcessId -ErrorAction SilentlyContinue }
    throw 'Native QA did not finish within 60 seconds'
}
$qaProcess.WaitForExit()
if ($qaProcess.ExitCode -ne 0) { throw "Native process exited with $($qaProcess.ExitCode); see $qaErr" }
$qaErrors = Get-Content -LiteralPath $qaErr -Raw -Encoding UTF8
if ($qaErrors) { throw "Native stderr was not empty: $qaErrors" }
$qaLine = Get-Content -LiteralPath $qaOut -Encoding UTF8 | Where-Object { $_.StartsWith('SKYFRONT_NATIVE_QA ') } | Select-Object -Last 1
if (-not $qaLine) { throw 'Native QA result is missing' }
$qaReport = $qaLine.Substring(19) | ConvertFrom-Json
if (-not $qaReport.ready -or -not (Test-Path -LiteralPath $qaImage)) { throw 'Native scene/capture did not become ready' }
if ($Flow -and (-not $qaReport.paidConstruction -or -not $qaReport.saved)) { throw 'Paid construction/save check failed' }
$qaReport | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qaRoot "$Name.report.json") -Encoding UTF8
$qaReport | Format-List

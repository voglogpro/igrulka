param(
    [string]$GodotRoot,
    [string]$SdkRoot
)

$ErrorActionPreference = 'Stop'
$probeRepo = Split-Path -Parent $PSScriptRoot
if (-not $GodotRoot) {
    $GodotRoot = Join-Path $probeRepo '.tools/godot/dotnet-4.7.2/Godot_v4.7.2-stable_mono_win64'
}
if (-not $SdkRoot) { $SdkRoot = Join-Path $probeRepo '.tools/dotnet/10.0.403' }
$GodotRoot = (Resolve-Path -LiteralPath $GodotRoot).Path
$SdkRoot = (Resolve-Path -LiteralPath $SdkRoot).Path
$probeProject = Join-Path $probeRepo 'tools/engine-probe'
$probeExe = Join-Path $GodotRoot 'Godot_v4.7.2-stable_mono_win64_console.exe'
$probeDotnet = Join-Path $SdkRoot 'dotnet.exe'
$probePackages = Join-Path $GodotRoot 'GodotSharp/Tools/nupkgs'
foreach ($probeRequired in @($probeExe, $probeDotnet, $probePackages)) {
    if (-not (Test-Path -LiteralPath $probeRequired)) { throw "Missing tool: $probeRequired" }
}

# Scope environment to this helper process; restore it even after an error.
$probeOldEnv = @{}
$probeEnvNames = @('PATH', 'DOTNET_ROOT', 'DOTNET_CLI_HOME', 'DOTNET_NOLOGO',
    'DOTNET_SKIP_FIRST_TIME_EXPERIENCE', 'DOTNET_CLI_TELEMETRY_OPTOUT', 'NUGET_PACKAGES')
foreach ($probeName in $probeEnvNames) {
    $probeOldEnv[$probeName] = [Environment]::GetEnvironmentVariable($probeName, 'Process')
}
try {
    $probeArtifacts = Join-Path $probeRepo 'artifacts/engine-prep'
    New-Item -ItemType Directory -Path $probeArtifacts -Force | Out-Null
    $env:PATH = "$SdkRoot;$env:PATH"
    $env:DOTNET_ROOT = $SdkRoot
    $env:DOTNET_CLI_HOME = Join-Path $probeArtifacts 'dotnet-home'
    $env:DOTNET_NOLOGO = '1'
    $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $env:NUGET_PACKAGES = Join-Path $probeRepo '.tools/nuget/packages'
    $probeConfig = Join-Path $probeProject 'NuGet.Config'
    if (-not (Test-Path -LiteralPath $probeConfig)) {
        $probeFeed = [System.Security.SecurityElement]::Escape($probePackages)
        $probeXml = '<configuration><packageSources><clear/><add key="Godot-local" value="' + $probeFeed + '"/></packageSources></configuration>'
        [IO.File]::WriteAllText($probeConfig, $probeXml, [Text.UTF8Encoding]::new($false))
    }
    & $probeDotnet build (Join-Path $probeProject 'SkyfrontEngineProbe.csproj') --configuration Debug --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Native C# probe build failed' }
    $probeLog = Join-Path $probeArtifacts 'godot-probe.log'
    & $probeExe --headless --path $probeProject --quit-after 120 --log-file $probeLog
    if ($LASTEXITCODE -ne 0) { throw 'Managed Godot headless probe failed' }
    if (-not (Select-String -LiteralPath $probeLog -SimpleMatch '"status":"pass"' -Quiet)) {
        throw 'Godot exited without running the C# probe'
    }
} finally {
    foreach ($probeName in $probeEnvNames) {
        [Environment]::SetEnvironmentVariable($probeName, $probeOldEnv[$probeName], 'Process')
    }
}

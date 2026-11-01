param([Parameter(Mandatory=$true)][int]$GameProcessId)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Write-InputJson($Value){[Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress -Depth 6));[Console]::Out.Flush()}
$inputContainer=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$inputAllowed=@(
 [IO.Path]::GetFullPath((Join-Path $inputContainer 'Skyfront-Native-0.2-Windows/Skyfront.exe')),
 [IO.Path]::GetFullPath((Join-Path $inputContainer 'Skyfront-Native-0.2.1-Windows/Skyfront.exe'))
)
$boundGame=Get-Process -Id $GameProcessId
$boundExe=[IO.Path]::GetFullPath($boundGame.Path)
if(-not ($inputAllowed | Where-Object {[string]::Equals($_,$boundExe,[StringComparison]::OrdinalIgnoreCase)})){throw 'Only explicitly named release 0.2/0.2.1 may receive worker input'}
$boundStart=$boundGame.StartTime.ToUniversalTime()
$compileClock=[Diagnostics.Stopwatch]::StartNew()
Write-InputJson @{kind='input-worker-compiling';atUtc=[DateTime]::UtcNow.ToString('o');gameProcessId=$GameProcessId}
$helperSource=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'native-parity-owned-input.ps1'))
$typeSource=[regex]::Match($helperSource,"(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
if(-not $typeSource){throw 'Cannot extract the existing owned-input C# helper'}
Add-Type -TypeDefinition $typeSource
[void][SkyfrontOwnedInput]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
Write-InputJson @{kind='input-worker-ready';atUtc=[DateTime]::UtcNow.ToString('o');compileMs=$compileClock.Elapsed.TotalMilliseconds;gameProcessId=$GameProcessId;boundStartUtc=$boundStart.ToString('o');executable=$boundExe}
while($null -ne ($line=[Console]::In.ReadLine())){
 $request=$null
 try{
  $request=$line | ConvertFrom-Json
  if($request.kind -eq 'close'){break}
  if($request.kind -ne 'owned-input'){throw 'Unsupported input worker command'}
  $currentGame=Get-Process -Id $GameProcessId
  if($currentGame.StartTime.ToUniversalTime() -ne $boundStart -or -not [string]::Equals([IO.Path]::GetFullPath($currentGame.Path),$boundExe,[StringComparison]::OrdinalIgnoreCase)){throw 'The originally bound game process was replaced; no input sent'}
  if($request.keyW -and ($request.holdMilliseconds -lt 300 -or $request.holdMilliseconds -gt 350)){throw 'W hold must remain within 300-350ms'}
  $started=[DateTime]::UtcNow.ToString('o')
  Write-InputJson @{kind='input-worker-action-start';id=$request.id;atUtc=$started;revealOnly=[bool]$request.revealOnly;keyW=[bool]$request.keyW}
  $result=[SkyfrontOwnedInput]::Click($GameProcessId,[int]$request.x,[int]$request.y,$true,[bool]$request.keyW,[int]$request.holdMilliseconds,[int]$request.cssWidth,[int]$request.cssHeight,$true,[bool]$request.revealOnly)
  Write-InputJson @{kind='input-worker-result';id=$request.id;ok=$true;startedAtUtc=$started;finishedAtUtc=[DateTime]::UtcNow.ToString('o');message=$result}
 }catch{
  Write-InputJson @{kind='input-worker-result';id=$request.id;ok=$false;finishedAtUtc=[DateTime]::UtcNow.ToString('o');error=$_.Exception.Message}
 }
}
Write-InputJson @{kind='input-worker-closed';atUtc=[DateTime]::UtcNow.ToString('o')}

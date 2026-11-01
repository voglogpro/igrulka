param(
 [Parameter(Mandatory=$true)][string]$DownloadsDirectory,
 [Parameter(Mandatory=$true)][ValidatePattern('^skyfront-city-\d+\.json$')][string]$RequestedFilename,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
 [Parameter(Mandatory=$true)][ValidateRange(1,5000000)][long]$ExpectedBytes,
 [Parameter(Mandatory=$true)][string]$AfterUtc,
 [ValidateRange(1,30)][int]$WaitSeconds=15
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Write-ExportJson($Value){[Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 4));[Console]::Out.Flush()}
$downloadScope=[IO.Path]::GetFullPath((Resolve-Path -LiteralPath $DownloadsDirectory).Path)
if(-not (Get-Item -LiteralPath $downloadScope).PSIsContainer){throw 'DownloadsDirectory must name the explicitly authorized directory'}
$after=[DateTimeOffset]::Parse($AfterUtc,[Globalization.CultureInfo]::InvariantCulture).UtcDateTime
$baseName=[IO.Path]::GetFileNameWithoutExtension($RequestedFilename)
$exactNamePattern='^'+[regex]::Escape($baseName)+'(?: \(\d+\))?\.json$'
$deadline=[DateTime]::UtcNow.AddSeconds($WaitSeconds)
$newCandidateCount=0
do {
 $verifiedExports=@()
 $candidates=@(Get-ChildItem -LiteralPath $downloadScope -File -Filter ($baseName+'*.json') | Where-Object {
  $_.Name -match $exactNamePattern -and $_.CreationTimeUtc -ge $after -and $_.Length -eq $ExpectedBytes
 })
 $newCandidateCount=$candidates.Count
 foreach($file in $candidates){
  try{$actualHash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}catch{continue}
  if($actualHash -eq $ExpectedSha256.ToLowerInvariant()){$verifiedExports+=[pscustomobject]@{path=$file.FullName;filename=$file.Name;bytes=$file.Length;sha256=$actualHash;createdUtc=$file.CreationTimeUtc.ToString('o');modifiedUtc=$file.LastWriteTimeUtc.ToString('o')}}
 }
 if($verifiedExports.Count -eq 1){Write-ExportJson ([pscustomobject]@{passed=$true;scope='Only NEW matching native-game exports in the explicitly supplied Downloads directory were hashed; no raw contents printed';requestedFilename=$RequestedFilename;afterUtc=$after.ToString('o');file=$verifiedExports[0]});exit 0}
 if($verifiedExports.Count -gt 1){throw 'More than one NEW export matches the exact expected hash; file acceptance is ambiguous'}
 Start-Sleep -Milliseconds 400
}while([DateTime]::UtcNow -lt $deadline)
Write-ExportJson ([pscustomobject]@{passed=$false;requestedFilename=$RequestedFilename;expectedBytes=$ExpectedBytes;expectedSha256=$ExpectedSha256;afterUtc=$after.ToString('o');newMatchingNameAndSizeCandidates=$newCandidateCount;error='No NEW export with the expected exact SHA-256 was found; no unrelated files were read'})
exit 1

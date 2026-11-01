param([Parameter(Mandatory=$true)][string]$PackageDirectory)
$ErrorActionPreference='Stop'
$repoDirectory=Split-Path -Parent $PSScriptRoot
$readyRoot=Split-Path -Parent $repoDirectory
$package=(Resolve-Path -LiteralPath $PackageDirectory).Path
$packageName=Split-Path -Leaf $package
if((Split-Path -Parent $package) -ne $readyRoot -or $packageName -notmatch '^Skyfront-Native-\d+\.\d+(\.\d+)?-Windows$'){throw 'Expected a named native release beside the repository'}
foreach($required in @('Skyfront.exe','Skyfront.pck','BUILD-INFO.json','PARITY-REPORT.md','web/game.js')){
 if(!(Test-Path -LiteralPath (Join-Path $package $required) -PathType Leaf)){throw ('Missing release file: '+$required)}
}
$archivePath=Join-Path ([Environment]::GetFolderPath('Desktop')) ($packageName+'.zip')
if(Test-Path -LiteralPath $archivePath){throw 'Archive already exists; preserve the accepted release'}
$hashes=@{};$lines=[Collections.Generic.List[string]]::new()
$sha=[Security.Cryptography.SHA256]::Create()
function StreamHash($stream){([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
$files=Get-ChildItem -LiteralPath $package -Recurse -File | Where-Object {$_.Name -ne 'SHA256SUMS.txt'} | Sort-Object FullName
foreach($file in $files){
 $relative=$file.FullName.Substring($package.Length+1).Replace('\','/')
 $stream=[IO.File]::OpenRead($file.FullName);try{$hash=StreamHash $stream}finally{$stream.Dispose()}
 $hashes[$relative]=$hash;$lines.Add($hash+'  '+$relative)
}
[IO.File]::WriteAllLines((Join-Path $package 'SHA256SUMS.txt'),$lines,[Text.UTF8Encoding]::new($false))
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::Open($archivePath,[IO.Compression.ZipArchiveMode]::Create)
try{
 foreach($file in (Get-ChildItem -LiteralPath $package -Recurse -File)){
  $relative=$file.FullName.Substring($package.Length+1).Replace('\','/')
  [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,($packageName+'/'+$relative),[IO.Compression.CompressionLevel]::Fastest)
 }
}finally{$archive.Dispose()}
$verified=0;$archive=[IO.Compression.ZipFile]::OpenRead($archivePath)
try{
 if($archive.Entries.Count -ne $hashes.Count+1){throw 'Unexpected archive entry count'}
 foreach($entry in $archive.Entries){
  if(!$entry.FullName.StartsWith($packageName+'/')){throw 'Archive path boundary mismatch'}
  $relative=$entry.FullName.Substring($packageName.Length+1)
  if($relative -eq 'SHA256SUMS.txt'){continue}
  if(!$hashes.ContainsKey($relative)){throw ('Unexpected archive entry '+$relative)}
  $stream=$entry.Open();try{$hash=StreamHash $stream}finally{$stream.Dispose()}
  if($hash -ne $hashes[$relative]){throw ('Archive hash mismatch '+$relative)}
  $verified++
 }
}finally{$archive.Dispose();$sha.Dispose()}
$result=[pscustomobject]@{passed=$true;package=$package;archive=$archivePath;verifiedPayloadFiles=$verified;archiveBytes=(Get-Item -LiteralPath $archivePath).Length;archiveSha256=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash;verifiedEveryDecompressedEntry=$true}
$reportPath=Join-Path $repoDirectory ('artifacts/native/'+$packageName+'-archive.json')
[IO.File]::WriteAllText($reportPath,($result|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$result|ConvertTo-Json

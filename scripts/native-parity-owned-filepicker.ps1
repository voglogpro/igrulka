param([int]$GameProcessId=0,[string]$VerifiedExportReport,[switch]$WaitForCommand,[switch]$CompileOnly,[ValidateRange(1,90)][int]$WaitSeconds=45)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Write-PickerJson($Value){[Console]::Out.WriteLine(($Value|ConvertTo-Json -Compress -Depth 7));[Console]::Out.Flush()}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SkyfrontOwnedPickerWindow {
 delegate bool Callback(IntPtr w,IntPtr data);
 [StructLayout(LayoutKind.Sequential)]struct Rect{public int L,T,R,B;}
 [DllImport("user32.dll")]static extern bool EnumThreadWindows(uint thread,Callback cb,IntPtr data);
 [DllImport("user32.dll")]static extern bool EnumChildWindows(IntPtr parent,Callback cb,IntPtr data);
 [DllImport("user32.dll")]static extern int GetDlgCtrlID(IntPtr window);
 [DllImport("user32.dll")]static extern IntPtr GetDlgItem(IntPtr dialog,int id);
 [DllImport("user32.dll")]static extern IntPtr GetParent(IntPtr window);
 [DllImport("user32.dll")]static extern bool IsChild(IntPtr parent,IntPtr child);
 [DllImport("user32.dll")]static extern bool IsWindowEnabled(IntPtr window);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr wParam,string text,uint flags,uint milliseconds,out IntPtr result);
 [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",SetLastError=true)]static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr wParam,IntPtr lParam,uint flags,uint milliseconds,out IntPtr result);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr w,out uint process);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr w,StringBuilder name,int length);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr w);
 [DllImport("user32.dll")]public static extern bool IsWindow(IntPtr w);
 [DllImport("user32.dll")]static extern bool GetClientRect(IntPtr w,out Rect rect);
 [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr w,uint command);
 [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr w,uint command);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr w);
 [DllImport("user32.dll")]static extern IntPtr GetDesktopWindow();
 public static int ProcessOf(long value){uint process;GetWindowThreadProcessId(new IntPtr(value),out process);return (int)process;}
 public static bool Visible(long value){return IsWindow(new IntPtr(value))&&IsWindowVisible(new IntPtr(value));}
 public static long[] FilenameWindows(long value,int[] allowedProcesses){var dialog=new IntPtr(value);Prove(value,allowedProcesses);var allowed=new HashSet<int>(allowedProcesses);var result=new List<long>();EnumChildWindows(dialog,(w,d)=>{uint process;GetWindowThreadProcessId(w,out process);if(allowed.Contains((int)process)&&GetDlgCtrlID(w)==1148&&GetAncestor(w,2)==dialog)result.Add(w.ToInt64());return true;},IntPtr.Zero);return result.ToArray();}
 public static long RootFor(int process,int[] threads){IntPtr result=IntPtr.Zero;long area=0;foreach(int thread in threads)EnumThreadWindows((uint)thread,(w,d)=>{uint owner;GetWindowThreadProcessId(w,out owner);Rect r;if(owner==(uint)process&&GetClientRect(w,out r)&&(long)r.R*r.B>area){area=(long)r.R*r.B;result=w;}return true;},IntPtr.Zero);if(result==IntPtr.Zero)throw new Exception("Bound Native root window was not found within its own threads");return result.ToInt64();}
 public static long[] Dialogs(int[] threads,int[] allowedProcesses){var allowed=new HashSet<int>(allowedProcesses);var result=new HashSet<long>();foreach(int thread in threads)EnumThreadWindows((uint)thread,(w,d)=>{uint process;GetWindowThreadProcessId(w,out process);if(!allowed.Contains((int)process)||!IsWindowVisible(w))return true;var name=new StringBuilder(64);GetClassName(w,name,64);if(name.ToString()=="#32770")result.Add(w.ToInt64());return true;},IntPtr.Zero);var values=new long[result.Count];result.CopyTo(values);return values;}
 public static long[] Prove(long value,int[] allowedProcesses){var dialog=new IntPtr(value);if(!IsWindow(dialog)||!IsWindowVisible(dialog))throw new Exception("Owned picker dialog disappeared");var name=new StringBuilder(64);GetClassName(dialog,name,64);if(name.ToString()!="#32770")throw new Exception("Candidate is not a common #32770 dialog");var allowed=new HashSet<int>(allowedProcesses);var seen=new HashSet<long>();var queue=new Queue<IntPtr>();var desktop=GetDesktopWindow();queue.Enqueue(dialog);while(queue.Count>0){var window=queue.Dequeue();if(window==IntPtr.Zero||window==desktop||seen.Contains(window.ToInt64()))continue;if(seen.Count>=32)throw new Exception("Owner/parent chain exceeds its bound");uint process;GetWindowThreadProcessId(window,out process);if(!allowed.Contains((int)process))throw new Exception("Dialog owner/parent chain leaves the proven Native process tree; no action allowed");seen.Add(window.ToInt64());queue.Enqueue(GetWindow(window,4));queue.Enqueue(GetAncestor(window,1));}var proof=new long[seen.Count];seen.CopyTo(proof);return proof;}
 public static void Foreground(long value,int[] allowedProcesses){Prove(value,allowedProcesses);var dialog=new IntPtr(value);if(GetAncestor(GetForegroundWindow(),2)!=dialog){SetForegroundWindow(dialog);System.Threading.Thread.Sleep(150);}if(GetAncestor(GetForegroundWindow(),2)!=dialog)throw new Exception("Owned picker is not the foreground root; no UIA mutation allowed");}
 public sealed class NativeControl { public long Handle;public string Class;public int Id; }
 public sealed class NativeTargets { public long Dialog,Edit,Open;public NativeControl[] FilenameChain;public NativeControl OpenControl; }
 static string ClassOf(IntPtr window){var value=new StringBuilder(128);if(GetClassName(window,value,value.Capacity)==0)throw new Exception("Cannot identify an exact filename/Open control");return value.ToString();}
 static void FilenamePolicy(int rootId,string[] classes,int editCount){var path=String.Join("/",classes);if(rootId!=1148||editCount!=1||(path!="ComboBoxEx32/ComboBox/Edit"&&path!="ComboBox/Edit"&&path!="Edit"))throw new Exception("Filename control is not a unique exact1148 ComboBoxEx32/ComboBox/Edit chain");}
 static void OpenPolicy(int id,string className){if(id!=1||className!="Button")throw new Exception("Only the exact ID1 native Button may open the verified test file");}
 static void ChildProof(IntPtr dialog,IntPtr window,HashSet<int> allowed){uint process;if(window==IntPtr.Zero||!IsWindow(window)||!IsChild(dialog,window)||GetAncestor(window,2)!=dialog)throw new Exception("A filename/Open handle is outside the proven dialog");GetWindowThreadProcessId(window,out process);if(!allowed.Contains((int)process))throw new Exception("A filename/Open handle PID is outside the proven process tree");if(!IsWindowEnabled(window)||!IsWindowVisible(window))throw new Exception("A filename/Open handle is disabled or invisible");}
 public static NativeTargets ResolveNativeTargets(long dialogValue,int[] allowedProcesses){
  Prove(dialogValue,allowedProcesses);var dialog=new IntPtr(dialogValue);var allowed=new HashSet<int>(allowedProcesses);var root=GetDlgItem(dialog,1148);ChildProof(dialog,root,allowed);if(GetDlgCtrlID(root)!=1148)throw new Exception("GetDlgItem1148 did not return the exact filename control");
  var chain=new List<NativeControl>();var classes=new List<string>();var current=root;var edits=0;var edit=IntPtr.Zero;
  for(var depth=0;depth<3;depth++){
   ChildProof(dialog,current,allowed);var className=ClassOf(current);classes.Add(className);chain.Add(new NativeControl{Handle=current.ToInt64(),Class=className,Id=GetDlgCtrlID(current)});
   if(className=="Edit"){edits++;edit=current;break;}
   var expected=className=="ComboBoxEx32"?"ComboBox":className=="ComboBox"?"Edit":null;if(expected==null)throw new Exception("Unknown native filename control class; no fallback typing");
   var matches=new List<IntPtr>();var parent=current;
   EnumChildWindows(parent,(child,data)=>{if(GetParent(child)==parent&&ClassOf(child)==expected){ChildProof(dialog,child,allowed);matches.Add(child);}return true;},IntPtr.Zero);
   if(matches.Count!=1)throw new Exception("The exact filename hierarchy has no unique immediate "+expected+" child");current=matches[0];
  }
  FilenamePolicy(GetDlgCtrlID(root),classes.ToArray(),edits);var open=GetDlgItem(dialog,1);ChildProof(dialog,open,allowed);var openClass=ClassOf(open);OpenPolicy(GetDlgCtrlID(open),openClass);
  return new NativeTargets{Dialog=dialogValue,Edit=edit.ToInt64(),Open=open.ToInt64(),FilenameChain=chain.ToArray(),OpenControl=new NativeControl{Handle=open.ToInt64(),Class=openClass,Id=GetDlgCtrlID(open)}};
 }
 static NativeTargets SameTargets(NativeTargets expected,int[] allowed){var current=ResolveNativeTargets(expected.Dialog,allowed);if(current.Edit!=expected.Edit||current.Open!=expected.Open||current.FilenameChain.Length!=expected.FilenameChain.Length)throw new Exception("The exact native filename/Open handle identity changed");for(var i=0;i<current.FilenameChain.Length;i++)if(current.FilenameChain[i].Handle!=expected.FilenameChain[i].Handle)throw new Exception("The exact native filename chain changed");return current;}
 public static void SetVerifiedFilename(NativeTargets targets,int[] allowed,string absolutePath){SameTargets(targets,allowed);Foreground(targets.Dialog,allowed);IntPtr result;if(SendMessageTimeout(new IntPtr(targets.Edit),0x000C,IntPtr.Zero,absolutePath,3,5000,out result)==IntPtr.Zero||result==IntPtr.Zero)throw new Exception("Bounded WM_SETTEXT failed for the verified own filename Edit");}
 public static void ClickVerifiedOpen(NativeTargets targets,int[] allowed){SameTargets(targets,allowed);Foreground(targets.Dialog,allowed);IntPtr result;if(SendMessageTimeout(new IntPtr(targets.Open),0x00F5,IntPtr.Zero,IntPtr.Zero,3,5000,out result)==IntPtr.Zero)throw new Exception("Bounded BM_CLICK failed for the verified own ID1 Button");}
 public static int NativePolicySelfTest(){var checks=0;FilenamePolicy(1148,new[]{"ComboBoxEx32","ComboBox","Edit"},1);checks++;FilenamePolicy(1148,new[]{"ComboBox","Edit"},1);checks++;FilenamePolicy(1148,new[]{"Edit"},1);checks++;OpenPolicy(1,"Button");checks++;Action[] denied={()=>FilenamePolicy(1147,new[]{"Edit"},1),()=>FilenamePolicy(1148,new[]{"Pane","Edit"},1),()=>FilenamePolicy(1148,new[]{"ComboBoxEx32","ComboBox","Edit"},2),()=>FilenamePolicy(1148,new[]{"ComboBoxEx32","ComboBox"},0),()=>OpenPolicy(2,"Button"),()=>OpenPolicy(1,"Edit")};foreach(var check in denied){var rejected=false;try{check();}catch(InvalidOperationException){throw;}catch(Exception){rejected=true;}if(!rejected)throw new Exception("A forbidden native filename/Open descriptor was accepted");checks++;}return checks;}
}
'@
function Select-ScopedFilenameIndex([object[]]$Descriptors){
 foreach($kind in @('ControlType.Edit','ControlType.ComboBox')){
  $valid=@($Descriptors | Where-Object {$_.kind -eq $kind -and $_.hasValue -and -not $_.readOnly -and $_.enabled})
  if($valid.Count -gt 1){throw 'Ambiguous editable filename controls within the proven filename scope'}
  if($valid.Count -eq 1){return [int]$valid[0].index}
 }
 return -1
}
if($CompileOnly){
 $edit=[pscustomobject]@{index=0;kind='ControlType.Edit';hasValue=$true;readOnly=$false;enabled=$true}
 $combo=[pscustomobject]@{index=1;kind='ControlType.ComboBox';hasValue=$true;readOnly=$false;enabled=$true}
 $locked=[pscustomobject]@{index=2;kind='ControlType.ComboBox';hasValue=$true;readOnly=$true;enabled=$true}
 $unknown=[pscustomobject]@{index=3;kind='ControlType.Pane';hasValue=$true;readOnly=$false;enabled=$true}
 if((Select-ScopedFilenameIndex @($edit)) -ne 0){throw 'Edit descriptor policy failed'}
 if((Select-ScopedFilenameIndex @($combo)) -ne 1){throw 'Editable ComboBox descriptor policy failed'}
 if((Select-ScopedFilenameIndex @($locked)) -ne -1){throw 'Read-only descriptor must be rejected'}
 if((Select-ScopedFilenameIndex @($unknown)) -ne -1){throw 'Unknown control type must be rejected'}
 if((Select-ScopedFilenameIndex @($combo,$edit)) -ne 0){throw 'Concrete Edit must be preferred over its editable container'}
 $ambiguous=$false;try{[void](Select-ScopedFilenameIndex @($combo,$combo))}catch{$ambiguous=$true}
 if(-not $ambiguous){throw 'Ambiguous editable scope must be rejected'}
 $nativePolicyChecks=[SkyfrontOwnedPickerWindow]::NativePolicySelfTest()
 Write-PickerJson @{kind='filepicker-helper-compile';passed=$true;descriptorChecks=6;nativePolicyChecks=$nativePolicyChecks;scope='Win32/UIA types + strict filename policies tested; no window enumeration or UI action executed'};exit 0
}
if($GameProcessId -le 0 -or -not $VerifiedExportReport){throw 'Runtime requires explicit own Native PID and the verified own-export report'}
$pickerContainer=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pickerExpectedExe=[IO.Path]::GetFullPath((Join-Path $pickerContainer 'Skyfront-Native-0.2.1-Windows/Skyfront.exe'))
$boundNative=Get-Process -Id $GameProcessId
if(-not [string]::Equals([IO.Path]::GetFullPath($boundNative.Path),$pickerExpectedExe,[StringComparison]::OrdinalIgnoreCase)){throw 'Only the explicit Native0.2.1 package is authorized'}
$boundNativeStart=$boundNative.StartTime.ToUniversalTime()
$known=Get-Content -LiteralPath $VerifiedExportReport -Raw -Encoding UTF8 | ConvertFrom-Json
if($known.passed -ne $true -or $known.file.bytes -ne 4609 -or $known.file.sha256 -ne '1bd1e6e19afd9876faebb625ce53cbbb26e4ec02428d0bb20028e37c0aa2a734'){throw 'This dialog proof accepts only the previously verified own test export'}
$ownedFile=[IO.Path]::GetFullPath($known.file.path)
if($ownedFile.Contains([char]0xFFFD) -or [IO.Path]::GetFileName($ownedFile) -ne $known.file.filename){throw 'Verified filename/path is malformed'}
function Confirm-BoundNative{
 $currentNative=Get-Process -Id $GameProcessId
 if($currentNative.StartTime.ToUniversalTime() -ne $boundNativeStart -or -not [string]::Equals([IO.Path]::GetFullPath($currentNative.Path),$pickerExpectedExe,[StringComparison]::OrdinalIgnoreCase)){throw 'Bound Native process was replaced'}
}
function Confirm-OwnedFile{
 $item=Get-Item -LiteralPath $ownedFile
 if($item.PSIsContainer -or $item.Length -ne 4609 -or (Get-FileHash -LiteralPath $ownedFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $known.file.sha256){throw 'The verified own test file changed'}
}
function Get-OwnedPickerTree{
 Confirm-BoundNative
 $tree=@{};$tree[$GameProcessId]=[pscustomobject]@{id=$GameProcessId;parent=0;role='native';start=$boundNativeStart}
 $frontier=@($GameProcessId)
 $expectedHost=Join-Path (Split-Path -Parent $pickerExpectedExe) 'browser/Skyfront.BrowserHost.exe'
 $runtimeRoots=@('C:/Program Files (x86)/Microsoft/EdgeWebView/Application','C:/Program Files/Microsoft/EdgeWebView/Application',(Join-Path $env:LOCALAPPDATA 'Microsoft/EdgeWebView/Application'))
 for($depth=0;$depth -lt 7 -and $frontier.Count;$depth++){
  $next=@()
  foreach($parentValue in $frontier){
   $children=Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$parentValue) -Property ProcessId,ParentProcessId,Name,ExecutablePath
   foreach($child in $children){
    $childValue=[int]$child.ProcessId;if($tree.ContainsKey($childValue)){continue}
    if(-not $child.ExecutablePath){continue}
    $role=$null
    if($child.Name -ieq 'Skyfront.BrowserHost.exe' -and $parentValue -eq $GameProcessId -and [string]::Equals([IO.Path]::GetFullPath($child.ExecutablePath),[IO.Path]::GetFullPath($expectedHost),[StringComparison]::OrdinalIgnoreCase)){$role='browser-host'}
    elseif($child.Name -ieq 'msedgewebview2.exe' -and $tree[$parentValue].role -in @('browser-host','webview')){
     $executable=[IO.Path]::GetFullPath($child.ExecutablePath)
     foreach($runtimeRoot in $runtimeRoots){if($executable.StartsWith([IO.Path]::GetFullPath($runtimeRoot)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){$role='webview';break}}
    }
    if(-not $role){continue}
    $processInfo=Get-Process -Id $childValue
    $created=$processInfo.StartTime.ToUniversalTime()
    if($created -lt $tree[$parentValue].start){throw 'PID creation order does not prove Native descendant ownership'}
    $tree[$childValue]=[pscustomobject]@{id=$childValue;parent=$parentValue;role=$role;start=$created};$next+=$childValue
    if($tree.Count -gt 64){throw 'Owned picker process tree exceeds its bound'}
   }
  }
  $frontier=$next
 }
 return ,$tree
}
Confirm-OwnedFile
$ownedTree=Get-OwnedPickerTree
Write-PickerJson @{kind='filepicker-helper-ready';atUtc=[DateTime]::UtcNow.ToString('o');gameProcessId=$GameProcessId;ownedProcessCount=$ownedTree.Count;file=@{filename=$known.file.filename;bytes=4609;sha256=$known.file.sha256};scope='Only Native descendants; no global window enumeration, screenshot, or file-list reads'}
if($WaitForCommand){$request=[Console]::In.ReadLine() | ConvertFrom-Json;if($request.kind -ne 'choose-owned-file'){throw 'Explicit choose-owned-file command required'}}
$deadline=[DateTime]::UtcNow.AddSeconds($WaitSeconds)
$dialogHandle=$null
do{
 $ownedTree=Get-OwnedPickerTree;$threadValues=@()
 foreach($entry in $ownedTree.Values){$current=Get-Process -Id $entry.id;if($current.StartTime.ToUniversalTime() -ne $entry.start){throw 'Owned process identity changed'};foreach($thread in $current.Threads){$threadValues+=[int]$thread.Id}}
 $dialogCandidates=@([SkyfrontOwnedPickerWindow]::Dialogs([int[]]$threadValues,[int[]]$ownedTree.Keys))
 if($dialogCandidates.Count -gt 1){throw 'Multiple owned common dialogs; refusing ambiguous automation'}
 if($dialogCandidates.Count -eq 1){$dialogHandle=[long]$dialogCandidates[0];break}
 Start-Sleep -Milliseconds 300
}while([DateTime]::UtcNow -lt $deadline)
if(-not $dialogHandle){throw 'No #32770 dialog was found within the proven Native/BrowserHost/WebView process tree'}
$proof=[SkyfrontOwnedPickerWindow]::Prove($dialogHandle,[int[]]$ownedTree.Keys)
function Confirm-CurrentDialogProof{
 Confirm-BoundNative
 $currentProof=[SkyfrontOwnedPickerWindow]::Prove($dialogHandle,[int[]]$ownedTree.Keys)
 foreach($ownedHandle in $currentProof){
  $chainValue=[SkyfrontOwnedPickerWindow]::ProcessOf($ownedHandle);$visited=@{}
  while($chainValue -gt 0){
   if($visited.ContainsKey($chainValue) -or -not $ownedTree.ContainsKey($chainValue)){throw 'Current dialog process chain is no longer proven'}
   $visited[$chainValue]=$true;$entry=$ownedTree[$chainValue];$currentProcess=Get-Process -Id $chainValue
   if($currentProcess.StartTime.ToUniversalTime() -ne $entry.start){throw 'An owned dialog/ancestor PID was reused'}
   $chainValue=[int]$entry.parent
  }
 }
}
# UIA on this proven native dialog exposes opaque Pane wrappers only. Use the
# exact Win32 filename chain, never desktop UIA, file-list reads or SendKeys.
Confirm-CurrentDialogProof;Confirm-OwnedFile
$dialogProcessId=[SkyfrontOwnedPickerWindow]::ProcessOf($dialogHandle)
$nativeTargets=[SkyfrontOwnedPickerWindow]::ResolveNativeTargets($dialogHandle,[int[]]$ownedTree.Keys)
function Confirm-NativeTargetIdentities{
 Confirm-CurrentDialogProof
 foreach($targetHandle in @($nativeTargets.FilenameChain | ForEach-Object {$_.Handle})+@($nativeTargets.Open)){
  $controlProcessId=[SkyfrontOwnedPickerWindow]::ProcessOf([long]$targetHandle)
  if(-not $ownedTree.ContainsKey($controlProcessId)){throw 'The native filename/Open PID is outside the proven tree'}
  $controlProcess=Get-Process -Id $controlProcessId
  if($controlProcess.StartTime.ToUniversalTime() -ne $ownedTree[$controlProcessId].start){throw 'A native filename/Open control PID was reused'}
 }
}
Confirm-NativeTargetIdentities
$filenameMetadata=@($nativeTargets.FilenameChain | ForEach-Object {@{class=$_.Class;id=$_.Id}})
Write-PickerJson @{kind='filepicker-native-control-scope';filenameChain=$filenameMetadata;openControl=@{class=$nativeTargets.OpenControl.Class;id=$nativeTargets.OpenControl.Id};scope='Only GetDlgItem1148 exact native ComboBoxEx32/ComboBox/Edit and GetDlgItem1 Button inside the proven own dialog';noNameValueOrListRead=$true}
Confirm-NativeTargetIdentities;Confirm-OwnedFile
[SkyfrontOwnedPickerWindow]::SetVerifiedFilename($nativeTargets,[int[]]$ownedTree.Keys,$ownedFile)
Confirm-NativeTargetIdentities;Confirm-OwnedFile
[SkyfrontOwnedPickerWindow]::ClickVerifiedOpen($nativeTargets,[int[]]$ownedTree.Keys)
$closeDeadline=[DateTime]::UtcNow.AddSeconds(10)
while([SkyfrontOwnedPickerWindow]::Visible($dialogHandle) -and [DateTime]::UtcNow -lt $closeDeadline){Start-Sleep -Milliseconds 100}
if([SkyfrontOwnedPickerWindow]::Visible($dialogHandle)){throw 'Owned Open dialog did not close after its exact ID1 BM_CLICK'}
Write-PickerJson @{kind='filepicker-helper-complete';passed=$true;atUtc=[DateTime]::UtcNow.ToString('o');dialogHandle=$dialogHandle;dialogProcessId=$dialogProcessId;ownerChainHandles=$proof;ownedProcessIds=@($ownedTree.Keys);filenameChain=$filenameMetadata;filenameScope='GetDlgItem1148 exact native chain WM_SETTEXT';openControl='GetDlgItem1 Button BM_CLICK';file=@{filename=$known.file.filename;bytes=4609;sha256=$known.file.sha256};scope='Only the proven owned dialog filename and Open controls were touched; no Name/Value/list reads, screenshot or SendKeys'}

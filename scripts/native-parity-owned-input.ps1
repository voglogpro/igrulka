param([Parameter(Mandatory=$true)][int]$GameProcessId,[Parameter(Mandatory=$true)][int]$ClientX,[Parameter(Mandatory=$true)][int]$ClientY,[switch]$Hardware,[switch]$KeyW,[ValidateRange(300,350)][int]$HoldMilliseconds=330,[ValidateRange(0,16384)][int]$CssWidth=0,[ValidateRange(0,16384)][int]$CssHeight=0,[switch]$KeepVisible,[switch]$RevealOnly)
$ErrorActionPreference='Stop'
$gameInputProcess=Get-Process -Id $GameProcessId
$gameInputExe=[IO.Path]::GetFullPath($gameInputProcess.Path)
$gameInputContainer=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$gameInputExpected=@(
 [IO.Path]::GetFullPath((Join-Path $gameInputContainer 'Skyfront-Native-0.2-Windows/Skyfront.exe')),
 [IO.Path]::GetFullPath((Join-Path $gameInputContainer 'Skyfront-Native-0.2.1-Windows/Skyfront.exe'))
)
if(-not ($gameInputExpected | Where-Object { [string]::Equals($_,$gameInputExe,[StringComparison]::OrdinalIgnoreCase) })){throw 'Only the explicitly named 0.2 or 0.2.1 release game may receive test input'}
if($KeyW -and -not $Hardware){throw 'KeyW requires -Hardware so the owned canvas receives a real focus click first'}
if(($CssWidth -eq 0) -ne ($CssHeight -eq 0)){throw 'Supply both CssWidth and CssHeight, or neither for physical client coordinates'}
if($RevealOnly){$Hardware=$true}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SkyfrontOwnedInput {
 delegate bool Callback(IntPtr w,IntPtr data);
 [StructLayout(LayoutKind.Sequential)] struct Rect {public int L,T,R,B;}
 [StructLayout(LayoutKind.Sequential)] struct Point {public int X,Y;}
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,Callback cb,IntPtr data);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
 [DllImport("user32.dll")] static extern int GetClassName(IntPtr w,StringBuilder name,int count);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr w,out Rect rect);
 [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr w,ref Point p);
 [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr w,ref Point p);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr w,uint message,IntPtr wp,IntPtr lp);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr w,uint flags);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr w,out Rect r);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr w,int mode);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr w,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr w);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 [DllImport("user32.dll")] static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 static bool OwnedForeground(IntPtr root) {return GetAncestor(GetForegroundWindow(),2)==root;}
 static void HoldW(IntPtr root,IntPtr child,int milliseconds) {
  if(!OwnedForeground(root))throw new Exception("Owned game is not the foreground root; no keyboard input sent");
  foreach(var key in new[]{0x10,0x11,0x12,0x5B,0x5C,0x57})
   if((GetAsyncKeyState(key)&0x8000)!=0)throw new Exception("A modifier or W is already held; no keyboard input sent");
  bool down=false;
  try {
   if(!OwnedForeground(root))throw new Exception("Foreground changed before W; no keyboard input sent");
   keybd_event(0x57,0x11,0,UIntPtr.Zero);down=true;
   var clock=System.Diagnostics.Stopwatch.StartNew();
   while(clock.ElapsedMilliseconds<milliseconds) {
    if(!OwnedForeground(root))throw new Exception("Foreground left the owned game while W was held; test rejected");
    System.Threading.Thread.Sleep(10);
   }
  } finally {
   if(down) {
    if(!OwnedForeground(root)){SetForegroundWindow(root);System.Threading.Thread.Sleep(40);}
    if(OwnedForeground(root))keybd_event(0x57,0x11,2,UIntPtr.Zero);
    else {
     // Never send a global key event to an unrelated foreground window.
     // A targeted key-up still releases the owned WebView's page-side key state.
     if(child!=IntPtr.Zero&&GetAncestor(child,2)==root)
      PostMessage(child,0x101,new IntPtr(0x57),new IntPtr(0xC0110001L));
     throw new Exception("Cannot restore owned foreground for global key-up; only the owned WebView received targeted key-up; test rejected");
    }
   }
  }
 }
 public static string Click(int process,int x,int y,bool hardware,bool keyW,int holdMilliseconds,int cssWidth,int cssHeight,bool keepVisible,bool revealOnly) {
  IntPtr root=IntPtr.Zero,child=IntPtr.Zero;long area=0;
  EnumWindows((w,d)=>{uint pid;GetWindowThreadProcessId(w,out pid);Rect r;
   if(pid==(uint)process&&GetClientRect(w,out r)&&(long)r.R*r.B>area){area=(long)r.R*r.B;root=w;}return true;},IntPtr.Zero);
  if(root==IntPtr.Zero)throw new Exception("Owned game window missing");
  Rect client;if(!GetClientRect(root,out client))throw new Exception("Cannot read owned game client; no input sent");
  if(cssWidth>0&&cssHeight>0){x=(int)Math.Round(x*(double)client.R/cssWidth);y=(int)Math.Round(y*(double)client.B/cssHeight);}
  if(x<0||y<0||x>=client.R||y>=client.B)throw new Exception("Point outside owned game client; no input sent");
  EnumChildWindows(root,(w,d)=>{var name=new StringBuilder(256);GetClassName(w,name,256);
   if(name.ToString()=="Chrome_RenderWidgetHostHWND")child=w;return true;},IntPtr.Zero);
  if(child==IntPtr.Zero||hardware) {
   Rect original;GetWindowRect(root,out original);var foreground=GetForegroundWindow();Point cursor;GetCursorPos(out cursor);
   try {
    ShowWindow(root,4);SetWindowPos(root,new IntPtr(-1),10,10,0,0,0x51);SetForegroundWindow(root);System.Threading.Thread.Sleep(700);
    if(revealOnly)return "Owned game revealed without input; wait for a fresh browser point and viewport before clicking";
    var click=new Point{X=x,Y=y};ClientToScreen(root,ref click);
    if(GetAncestor(WindowFromPoint(click),2)!=root)throw new Exception("Test click is not over the owned game; no input sent");
    SetCursorPos(click.X,click.Y);mouse_event(2,0,0,0,UIntPtr.Zero);System.Threading.Thread.Sleep(100);mouse_event(4,0,0,0,UIntPtr.Zero);
    System.Threading.Thread.Sleep(150);
    if(keyW)HoldW(root,child,holdMilliseconds);
    System.Threading.Thread.Sleep(250);
    return "Verified real mouse click sent only over the owned game at "+x+","+y+(keyW?"; foreground-guarded real W held "+holdMilliseconds+"ms with key-up in finally":"");
   } finally {
    if(keepVisible)SetWindowPos(root,new IntPtr(-2),0,0,0,0,0x13);
    else SetWindowPos(root,new IntPtr(-2),original.L,original.T,0,0,0x11);
    SetCursorPos(cursor.X,cursor.Y);SetForegroundWindow(foreground);
   }
  }
  if(GetAncestor(child,2)!=root)throw new Exception("WebView input child is outside the owned game window");
  var point=new Point{X=x,Y=y};ClientToScreen(root,ref point);ScreenToClient(child,ref point);
  Rect bounds;GetClientRect(child,out bounds);
  if(point.X<0||point.Y<0||point.X>=bounds.R||point.Y>=bounds.B)throw new Exception("Point outside owned WebView");
  var location=new IntPtr((point.Y<<16)|(point.X&65535));
  PostMessage(child,0x200,IntPtr.Zero,location);
  PostMessage(child,0x201,new IntPtr(1),location);
  System.Threading.Thread.Sleep(100);
  PostMessage(child,0x202,IntPtr.Zero,location);
  return "Native mouse messages posted only to owned WebView at "+point.X+","+point.Y;
 }
}
'@
[void][SkyfrontOwnedInput]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
[SkyfrontOwnedInput]::Click($GameProcessId,$ClientX,$ClientY,[bool]$Hardware,[bool]$KeyW,$HoldMilliseconds,$CssWidth,$CssHeight,[bool]$KeepVisible,[bool]$RevealOnly)

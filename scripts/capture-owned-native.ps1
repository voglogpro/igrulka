param([Parameter(Mandatory=$true)][int]$GameProcessId, [Parameter(Mandatory=$true)][string]$OutputPath, [switch]$Reveal)
$ErrorActionPreference = 'Stop'
$captureRepo = Split-Path -Parent $PSScriptRoot
$captureProcess = Get-Process -Id $GameProcessId
$captureExe = [IO.Path]::GetFullPath($captureProcess.Path)
$captureReleases = @('Skyfront-Native-0.2-Windows', 'Skyfront-Native-0.2.1-Windows') | ForEach-Object {
    [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $captureRepo) ($_ + '/Skyfront.exe')))
}
if (-not $captureExe.StartsWith([IO.Path]::GetFullPath($captureRepo) + '\', [StringComparison]::OrdinalIgnoreCase) -and $captureExe -notin $captureReleases) {
    throw 'Only this workspace-owned game process may be captured'
}
$captureProcess.Refresh()
$captureWindow = $captureProcess.MainWindowHandle
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class SkyfrontOwnedWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window,out Rect rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window,ref Point point);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr target, uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  delegate bool WindowCallback(IntPtr window,IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback,IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
  public static IntPtr Find(int process) {
    IntPtr found=IntPtr.Zero;long area=0;
    EnumWindows((window,data)=>{
      uint owner;GetWindowThreadProcessId(window,out owner);Rect bounds;
      if(owner==(uint)process&&GetWindowRect(window,out bounds)) {
        long current=(long)(bounds.Right-bounds.Left)*(bounds.Bottom-bounds.Top);
        if(current>area){area=current;found=window;}
      }
      return true;
    },IntPtr.Zero);
    return found;
  }
  public static void Capture(IntPtr window,string path,bool reveal) {
    Rect bounds; if(!GetWindowRect(window,out bounds)) throw new InvalidOperationException("Window bounds unavailable");
    bool shown=IsWindowVisible(window);
    try {
      if(reveal){ShowWindow(window,4);SetWindowPos(window,new IntPtr(-1),10,10,Math.Min(bounds.Right-bounds.Left,GetSystemMetrics(0)-20),Math.Min(bounds.Bottom-bounds.Top,GetSystemMetrics(1)-20),0x50);System.Threading.Thread.Sleep(800);}
      Rect client;Point topLeft=new Point();GetClientRect(window,out client);ClientToScreen(window,ref topLeft);
      using(var bitmap = new Bitmap(reveal?client.Right:bounds.Right-bounds.Left,reveal?client.Bottom:bounds.Bottom-bounds.Top)) {
      using(var graphics=Graphics.FromImage(bitmap)) {
        if(reveal) graphics.CopyFromScreen(topLeft.X,topLeft.Y,0,0,bitmap.Size,CopyPixelOperation.SourceCopy);
        else { var target=graphics.GetHdc();
          try { if(!PrintWindow(window,target,2)) throw new InvalidOperationException("PrintWindow failed"); }
          finally { graphics.ReleaseHdc(target); }
        }
      }
      bitmap.Save(path,ImageFormat.Png);
      }
    } finally {
      if(reveal){SetWindowPos(window,new IntPtr(-2),bounds.Left,bounds.Top,bounds.Right-bounds.Left,bounds.Bottom-bounds.Top,0x10);if(!shown)ShowWindow(window,0);}
    }
  }
}
'@
[void][SkyfrontOwnedWindowCapture]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
if ($captureWindow -eq [IntPtr]::Zero) { $captureWindow = [SkyfrontOwnedWindowCapture]::Find($GameProcessId) }
if ($captureWindow -eq [IntPtr]::Zero) { throw 'Game does not have an owned main window' }
[SkyfrontOwnedWindowCapture]::Capture($captureWindow,[IO.Path]::GetFullPath($OutputPath),[bool]$Reveal)
Get-Item -LiteralPath $OutputPath | Select-Object FullName,Length

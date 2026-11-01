using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Skyfront.BrowserHost;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--self-test") return QueueSelfTest.Run();
            var options = Options.Parse(args);
            Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "00000000");
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            ApplicationConfiguration.Initialize();
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            using var context = new BrowserContext(options);
            Application.ThreadException += (_, e) => context.Fail(e.Exception);
            Application.Run(context);
            return context.ExitCode;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.ToString());
            return 1;
        }
    }
}

internal sealed record Options(nint Parent, string WebRoot, string UserData, string Url,
    bool Proof, string? Capture, int CaptureAfterMs, bool DevTools)
{
    public const string Host = "skyfront.localhost";
    public static Options Parse(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var flags = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < args.Length; i++)
        {
            if (!args[i].StartsWith("--", StringComparison.Ordinal))
                throw new ArgumentException("Expected --option");
            var option = args[i][2..];
            var equals = option.IndexOf('=');
            if (equals >= 0)
                values[option[..equals]] = option[(equals + 1)..];
            else if (option is "proof" or "devtools")
                flags.Add(option);
            else if (++i < args.Length)
                values[option] = args[i];
            else
                throw new ArgumentException("Missing value: " + option);
        }
        var proof = flags.Contains("proof");
        var root = values.GetValueOrDefault("web-root", proof ? Path.Combine(AppContext.BaseDirectory, "Proof") : "");
        if (root.Length == 0 || !Directory.Exists(root))
            throw new ArgumentException("--web-root must name an existing packaged folder");
        var parentText = values.GetValueOrDefault("parent-hwnd", "0");
        long parent = parentText.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
            ? long.Parse(parentText[2..], NumberStyles.HexNumber, CultureInfo.InvariantCulture)
            : long.Parse(parentText, CultureInfo.InvariantCulture);
        if (!proof && (parent == 0 || !Windows.IsWindow((nint)parent)))
            throw new ArgumentException("--parent-hwnd is not a live native window");
        var userData = values.GetValueOrDefault("user-data", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Skyfront", proof ? "WebView2-Proof" : "WebView2"));
        var url = values.GetValueOrDefault("url", "http://" + Host + "/index.html");
        if (!AllowedUrl(url))
            throw new ArgumentException("Only the packaged skyfront.localhost document is supported");
        var capture = values.GetValueOrDefault("capture");
        int delay = int.Parse(values.GetValueOrDefault("capture-after-ms", "3500"), CultureInfo.InvariantCulture);
        return new((nint)parent, Path.GetFullPath(root), Path.GetFullPath(userData), url, proof,
            capture == null ? null : Path.GetFullPath(capture), Math.Clamp(delay, 1000, 45000), flags.Contains("devtools"));
    }
    public static bool AllowedUrl(string url) => Uri.TryCreate(url, UriKind.Absolute, out var uri) &&
        uri.Scheme == "http" && uri.Host == Host && uri.IsDefaultPort && uri.UserInfo.Length == 0;
}

// Every pipe owns a bounded queue. Replacement is opt-in and only for complete snapshots.
internal sealed class MessageQueue
{
    private readonly LinkedList<(string? Key, string Json)> _messages = new();
    private readonly object _gate = new();
    public bool Add(string json)
    {
        using var document = JsonDocument.Parse(json);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Messages must be JSON objects");
        string? key = document.RootElement.TryGetProperty("coalesceKey", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        lock (_gate)
        {
            if (!string.IsNullOrEmpty(key))
                for (var node = _messages.First; node != null; node = node.Next)
                    if (node.Value.Key == key)
                    {
                        _messages.Remove(node);
                        break;
                    }
            if (_messages.Count >= 64)
                return false;
            _messages.AddLast((key, json));
            return true;
        }
    }
    public bool Take(out string json)
    {
        lock (_gate)
        {
            if (_messages.First == null)
            {
                json = "";
                return false;
            }
            json = _messages.First.Value.Json;
            _messages.RemoveFirst();
            return true;
        }
    }
}

internal static class QueueSelfTest
{
    public static int Run()
    {
        var queue = new MessageQueue();
        for (int i = 0; i < 64; i++)
            Check(queue.Add(JsonSerializer.Serialize(new { kind = "resource", index = i })), "resource accepted");
        Check(!queue.Add("{\"kind\":\"overflow\"}"), "bounded ordered backlog");
        for (int i = 0; i < 64; i++)
        {
            Check(queue.Take(out var json), "ordered resource exists");
            using var document = JsonDocument.Parse(json);
            Check(document.RootElement.GetProperty("index").GetInt32() == i, "resource order preserved");
        }
        Check(!queue.Take(out _), "queue drains");
        Check(queue.Add("{\"kind\":\"frame\",\"coalesceKey\":\"scene\",\"seq\":1}"), "initial full frame");
        Check(queue.Add("{\"kind\":\"resource\",\"id\":81}"), "resource between frames");
        Check(queue.Add("{\"kind\":\"frame\",\"coalesceKey\":\"scene\",\"seq\":2}"), "replacement full frame");
        Check(queue.Take(out var resource) && resource.Contains("resource"), "resource survives coalescing");
        Check(queue.Take(out var frame) && frame.Contains("\"seq\":2"), "latest full frame survives");
        Check(!queue.Take(out _), "obsolete full frame removed");
        bool rejected = false;
        try { queue.Add("[1,2]"); } catch (InvalidDataException) { rejected = true; }
        Check(rejected, "non-object protocol input rejected");
        Console.WriteLine("{\"kind\":\"host-self-test\",\"ok\":true,\"scope\":\"bounded order and opt-in coalescing; no GUI\"}");
        return 0;
    }
    private static void Check(bool value, string message)
    {
        if (!value) throw new InvalidOperationException("Queue self-test failed: " + message);
    }
}

internal sealed class PipeOutput : IDisposable
{
    private readonly MessageQueue _queue = new();
    private readonly SemaphoreSlim _signal = new(0, 1);
    private readonly CancellationTokenSource _stop = new();
    private readonly Task _worker;
    private bool _completed;
    public PipeOutput()
    {
        _worker = Task.Run(async () =>
        {
            try
            {
                while (true)
                {
                    await _signal.WaitAsync(_stop.Token);
                    while (_queue.Take(out var json))
                        await Console.Out.WriteLineAsync(json);
                    await Console.Out.FlushAsync();
                    if (_completed)
                        return;
                }
            }
            catch (OperationCanceledException) { }
            catch (IOException) { }
        });
    }
    public bool Send(string json)
    {
        if (!_queue.Add(json))
            return false;
        Wake();
        return true;
    }
    private void Wake()
    {
        try
        {
            _signal.Release();
        }
        catch (SemaphoreFullException) { }
    }
    public void Dispose()
    {
        _completed = true;
        Wake();
        if (!_worker.Wait(1000))
            _stop.Cancel();
        _stop.Dispose();
    }
}

internal sealed class BrowserContext : ApplicationContext
{
    private const int MaxLine = 32 * 1024 * 1024;
    private readonly Options _options;
    private readonly PipeOutput _output = new();
    private readonly MessageQueue _input = new();
    private readonly CancellationTokenSource _stop = new();
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 16 };
    private readonly Form? _proof;
    private CoreWebView2Controller? _controller;
    private CoreWebView2? _web;
    private ParentCompositionStyle? _parentComposition;
    private nint _parent;
    private Rectangle _bounds, _outer;
    private bool _starting, _closed, _capturing, _navigationReady, _processing;
    private long _readyAt;
    private volatile bool _closeRequested;
    private string? _inputError;
    public int ExitCode
    {
        get; private set;
    }

    public BrowserContext(Options options)
    {
        _options = options;
        _parent = options.Parent;
        if (options.Proof)
        {
            _proof = new ProofForm();
            _proof.FormClosed += (_, _) => Close();
            _proof.Show();
            _parent = _proof.Handle;
        }
        _timer.Tick += Tick;
        _timer.Start();
        Application.Idle += StartOnce;
        if (Console.IsInputRedirected)
            _ = Task.Run(ReadInput);
    }

    private async void StartOnce(object? sender, EventArgs args)
    {
        if (_starting)
            return;
        _starting = true;
        Application.Idle -= StartOnce;
        try
        {
            Directory.CreateDirectory(_options.UserData);
            var environmentOptions = new CoreWebView2EnvironmentOptions();
            if (Environment.GetEnvironmentVariable("SKYFRONT_NATIVE_QA") == "1")
                environmentOptions.AdditionalBrowserArguments = "--disable-backgrounding-occluded-windows --disable-background-timer-throttling --disable-renderer-backgrounding";
            var environment = await CoreWebView2Environment.CreateAsync(null, _options.UserData, environmentOptions);
            if (_closed)
                return;
            // Godot's OpenGL parent must keep drawing underneath the transparent child.
            // WS_CLIPCHILDREN otherwise clips the whole viewport to the WebView's bounds.
            _parentComposition = new ParentCompositionStyle(_parent,
                Environment.GetEnvironmentVariable("SKYFRONT_WEBVIEW_UNCLIP_PARENT") != "0");
            _controller = await environment.CreateCoreWebView2ControllerAsync(_parent);
            if (_closed)
            {
                _controller.Close();
                return;
            }
            _controller.DefaultBackgroundColor = Color.Transparent;
            _web = _controller.CoreWebView2;
            _web.Settings.AreDevToolsEnabled = _options.DevTools;
            _web.Settings.AreDefaultContextMenusEnabled = false;
            _web.Settings.AreHostObjectsAllowed = false;
            _web.Settings.IsStatusBarEnabled = false;
            _web.SetVirtualHostNameToFolderMapping(Options.Host, _options.WebRoot, CoreWebView2HostResourceAccessKind.DenyCors);
            _web.NavigationStarting += (_, e) => { if (!Options.AllowedUrl(e.Uri)) e.Cancel = true; };
            _web.NewWindowRequested += (_, e) => e.Handled = true;
            _web.WebMessageReceived += (_, e) =>
            {
                if (!Options.AllowedUrl(e.Source))
                    return;
                try
                {
                    var json = e.WebMessageAsJson;
                    if (json.Length > MaxLine || !_output.Send(json))
                        Fail(new InvalidDataException("Browser output exceeded the bounded queue"));
                }
                catch (Exception error) { Fail(error); }
            };
            _web.ProcessFailed += (_, e) => Fail(new InvalidOperationException("WebView process failed: " + e.ProcessFailedKind));
            _web.NavigationCompleted += (_, e) =>
            {
                if (!e.IsSuccess)
                {
                    Fail(new InvalidOperationException("Packaged page failed: " + e.WebErrorStatus));
                    return;
                }
                _navigationReady = true;
                _readyAt = Environment.TickCount64;
                Send(new
                {
                    kind = "host-ready",
                    runtime = environment.BrowserVersionString,
                    url = _web.Source,
                    transparent = _controller.DefaultBackgroundColor.A == 0,
                    parent = (long)_parent,
                    parentComposition = _parentComposition.Diagnostics()
                });
            };
            UpdateBounds();
            _web.Navigate(_options.Url);
        }
        catch (Exception error) { Fail(error); }
    }

    private async Task ReadInput()
    {
        try
        {
            while (!_stop.IsCancellationRequested)
            {
                var line = await Console.In.ReadLineAsync(_stop.Token);
                if (line == null)
                {
                    _closeRequested = true;
                    return;
                }
                if (line.Length > MaxLine || !_input.Add(line))
                    throw new InvalidDataException("Native input exceeded the bounded queue");
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception error) { _inputError = error.Message; _closeRequested = true; }
    }

    private async void Tick(object? sender, EventArgs args)
    {
        if (_closed)
            return;
        if (_closeRequested || !Windows.IsWindow(_parent))
        {
            if (_inputError != null)
                Fail(new InvalidDataException(_inputError));
            else
                Close();
            return;
        }
        if (_processing)
            return;
        try
        {
            UpdateBounds();
            if (_web == null || !_navigationReady)
                return;
            _processing = true;
            for (int i = 0; i < 12 && _input.Take(out var json); i++)
            {
                using var document = JsonDocument.Parse(json);
                var root = document.RootElement;
                if (root.TryGetProperty("kind", out var kind) && kind.GetString() == "host-command")
                {
                    var command = root.GetProperty("command").GetString();
                    if (command == "close")
                    {
                        Close();
                        return;
                    }
                    if (command == "focus")
                        _controller!.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);
                    if (command == "reload")
                        _web.Reload();
                }
                else if (root.TryGetProperty("kind", out kind) && kind.GetString() == "host-eval")
                {
                    var id = root.TryGetProperty("id", out var token) ? token.Clone() : default(JsonElement?);
                    try
                    {
                        var result = await _web.ExecuteScriptAsync(root.GetProperty("script").GetString() ?? "");
                        Send(new
                        {
                            kind = "host-eval-result",
                            id,
                            result
                        });
                    }
                    catch (Exception error) { Send(new { kind = "host-error", id, message = error.Message }); }
                }
                else
                    _web.PostWebMessageAsJson(json);
            }
            if (!_capturing && _options.Capture != null && Environment.TickCount64 - _readyAt >= _options.CaptureAfterMs)
            {
                _capturing = true;
                Directory.CreateDirectory(Path.GetDirectoryName(_options.Capture)!);
                await using (var output = File.Create(_options.Capture))
                    await _web.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, output);
                bool? transparent = null;
                if (_options.Proof)
                {
                    using var image = new Bitmap(_options.Capture);
                    transparent = image.GetPixel(0, 0).A == 0;
                    if (transparent != true)
                        ExitCode = 2;
                }
                Send(new
                {
                    kind = "host-capture",
                    path = _options.Capture,
                    browserTransparent = transparent,
                    scope = "Owned WebView content only; does not capture desktop or underlying Godot window"
                });
                Close();
            }
        }
        catch (Exception error) { Fail(error); }
        finally { _processing = false; }
    }

    private void UpdateBounds()
    {
        if (_controller == null)
            return;
        if (!Windows.GetClientRect(_parent, out var client) || !Windows.GetWindowRect(_parent, out var outer))
            return;
        var bounds = new Rectangle(0, 0, Math.Max(1, client.Right), Math.Max(1, client.Bottom));
        if (bounds != _bounds)
        {
            _bounds = bounds;
            _controller.Bounds = bounds;
        }
        var position = Rectangle.FromLTRB(outer.Left, outer.Top, outer.Right, outer.Bottom);
        if (position != _outer)
        {
            _outer = position;
            _controller.NotifyParentWindowPositionChanged();
        }
        bool visible = !Windows.IsIconic(_parent);
        if (_controller.IsVisible != visible)
            _controller.IsVisible = visible;
    }

    private void Send(object message)
    {
        if (!_output.Send(JsonSerializer.Serialize(message)))
        {
            ExitCode = 1;
            Close();
        }
    }
    public void Fail(Exception error)
    {
        if (_closed)
            return;
        ExitCode = 1;
        Console.Error.WriteLine(error.ToString());
        Send(new
        {
            kind = "host-error",
            message = error.Message
        });
        Close();
    }
    private void Close()
    {
        if (_closed)
            return;
        _closed = true;
        _timer.Stop();
        _stop.Cancel();
        _controller?.Close();
        _controller = null;
        try { _parentComposition?.Dispose(); }
        catch (Exception error)
        {
            ExitCode = 1;
            Console.Error.WriteLine(error.ToString());
        }
        _parentComposition = null;
        Send(new
        {
            kind = "host-closed",
            exitCode = ExitCode
        });
        _proof?.Close();
        ExitThread();
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Close();
            Application.Idle -= StartOnce;
            _timer.Dispose();
            _proof?.Dispose();
            _stop.Dispose();
            _output.Dispose();
        }
        base.Dispose(disposing);
    }
}

// Only this helper's changed bit is restored: Godot may change other styles for
// fullscreen or window resizing while the overlay is alive. CS_OWNDC is untouched.
internal sealed class ParentCompositionStyle : IDisposable
{
    private readonly nint _parent;
    private readonly bool _enabled;
    private readonly uint _originalStyle, _classStyle;
    private bool _removedClipChildren, _disposed;

    public ParentCompositionStyle(nint parent, bool enabled)
    {
        _parent = parent;
        _enabled = enabled;
        _originalStyle = Windows.GetStyle(parent);
        _classStyle = Windows.GetClassStyle(parent);
        if (enabled && (_originalStyle & Windows.ClipChildren) != 0)
        {
            Windows.SetStyle(parent, _originalStyle & ~Windows.ClipChildren);
            _removedClipChildren = true;
            try { Windows.RefreshStyle(parent); }
            catch
            {
                Dispose();
                throw;
            }
        }
    }

    public object Diagnostics() => new
    {
        unclippingEnabled = _enabled,
        originalWindowStyle = $"0x{_originalStyle:X8}",
        currentWindowStyle = $"0x{Windows.GetStyle(_parent):X8}",
        classStyle = $"0x{_classStyle:X8}",
        clipChildrenRemoved = _removedClipChildren,
        ownDeviceContext = (_classStyle & 0x0020) != 0
    };

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        if (!_removedClipChildren || !Windows.IsWindow(_parent))
            return;
        var current = Windows.GetStyle(_parent);
        if ((current & Windows.ClipChildren) == 0)
        {
            Windows.SetStyle(_parent, current | Windows.ClipChildren);
            Windows.RefreshStyle(_parent);
        }
    }
}

internal sealed class ProofForm : Form
{
    public ProofForm()
    {
        Text = "Skyfront owned WebView transparency proof";
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-25000, -25000);
        ClientSize = new Size(1280, 720);
        DoubleBuffered = true;
    }
    protected override void OnPaint(PaintEventArgs args)
    {
        for (int y = 0; y < Height; y += 80)
            for (int x = 0; x < Width; x += 80)
                args.Graphics.FillRectangle((x / 80 + y / 80) % 2 == 0 ? Brushes.DarkOliveGreen : Brushes.DarkGoldenrod, x, y, 80, 80);
        base.OnPaint(args);
    }
}

internal static class Windows
{
    internal const uint ClipChildren = 0x02000000;
    private const int WindowStyle = -16, ClassStyle = -26;
    private const uint StyleRefreshFlags = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020 | 0x4000;

    [StructLayout(LayoutKind.Sequential)]
    internal struct Rect
    {
        public int Left, Top, Right, Bottom;
    }
    [DllImport("user32.dll")][return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindow(nint handle);
    [DllImport("user32.dll")][return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsIconic(nint handle);
    [DllImport("user32.dll")][return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetClientRect(nint handle, out Rect rect);
    [DllImport("user32.dll")][return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetWindowRect(nint handle, out Rect rect);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)] private static extern nint GetWindowLongPtr(nint handle, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] private static extern nint SetWindowLongPtr(nint handle, int index, nint value);
    [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW", SetLastError = true)] private static extern nuint GetClassLongPtr(nint handle, int index);
    [DllImport("user32.dll", SetLastError = true)][return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetWindowPos(nint handle, nint after, int x, int y, int width, int height, uint flags);

    internal static uint GetStyle(nint handle)
    {
        Marshal.SetLastPInvokeError(0);
        var value = GetWindowLongPtr(handle, WindowStyle);
        var error = Marshal.GetLastPInvokeError();
        if (value == 0 && error != 0)
            throw new Win32Exception(error, "Cannot read overlay parent window style");
        return unchecked((uint)(long)value);
    }

    internal static uint GetClassStyle(nint handle)
    {
        Marshal.SetLastPInvokeError(0);
        var value = GetClassLongPtr(handle, ClassStyle);
        var error = Marshal.GetLastPInvokeError();
        if (value == 0 && error != 0)
            throw new Win32Exception(error, "Cannot read overlay parent class style");
        return unchecked((uint)value);
    }

    internal static void SetStyle(nint handle, uint style)
    {
        Marshal.SetLastPInvokeError(0);
        var previous = SetWindowLongPtr(handle, WindowStyle, unchecked((nint)(int)style));
        var error = Marshal.GetLastPInvokeError();
        if (previous == 0 && error != 0)
            throw new Win32Exception(error, "Cannot update overlay parent window style");
        if (GetStyle(handle) != style)
            throw new InvalidOperationException("Overlay parent window style update was not applied");
    }

    internal static void RefreshStyle(nint handle)
    {
        if (!SetWindowPos(handle, 0, 0, 0, 0, 0, StyleRefreshFlags))
            throw new Win32Exception(Marshal.GetLastPInvokeError(), "Cannot refresh overlay parent window style");
    }
}

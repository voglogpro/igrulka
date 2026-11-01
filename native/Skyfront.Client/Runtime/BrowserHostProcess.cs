using Godot;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Skyfront.Transport;

namespace Skyfront.Client.Runtime;

/// <summary>Owns only the packaged UI host. Gameplay remains in the original application.</summary>
public sealed class BrowserHostProcess : IDisposable
{
    private Process? _process;
    private readonly ConcurrentQueue<string> _messages = new();
    private readonly Channel<string> _outbound = Channel.CreateBounded<string>(NativeTransportPolicy.MaxQueuedMessages);
    private string _error = "";
    public string Error => _error;
    public bool Alive => _process is { HasExited: false };

    public void Start(long parentWindow, string profile, bool qa = false, string? pageUrl = null)
    {
        var package = Path.GetDirectoryName(OS.GetExecutablePath())!;
        var repo = Path.GetFullPath(ProjectSettings.GlobalizePath("res://../.."));
        var executable = Path.Combine(package, "browser", "Skyfront.BrowserHost.exe");
        var web = Path.Combine(package, "web");
        if (!File.Exists(executable))
            executable = Path.Combine(repo, "native", "build", "browser-host", "Skyfront.BrowserHost.exe");
        if (!Directory.Exists(web))
            web = Path.Combine(repo, "native", "build", "parity-web");
        if (!File.Exists(executable) || !File.Exists(Path.Combine(web, "index.html")))
            throw new FileNotFoundException("Не собраны исходный интерфейс и Windows-хост игры. Запустите сборку полной версии.");
        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        foreach (var argument in new[] { "--parent-hwnd", parentWindow.ToString(), "--web-root", web, "--user-data", profile })
            start.ArgumentList.Add(argument);
        if (pageUrl != null)
        {
            start.ArgumentList.Add("--url");
            start.ArgumentList.Add(pageUrl);
        }
        if (qa)
        {
            start.Environment["SKYFRONT_NATIVE_QA"] = "1";
            start.Environment["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--disable-backgrounding-occluded-windows --disable-background-timer-throttling --disable-renderer-backgrounding";
        }
        _process = Process.Start(start) ?? throw new InvalidOperationException("Не удалось запустить интерфейс игры.");
        var child = _process;
        _ = Task.Run(async () =>
        {
            try
            {
                await foreach (var message in _outbound.Reader.ReadAllAsync())
                {
                    await child.StandardInput.WriteLineAsync(message);
                    await child.StandardInput.FlushAsync();
                }
            }
            catch (Exception e) { _error = e.Message; }
        });
        _ = Task.Run(async () =>
        {
            try
            {
                while (await child.StandardOutput.ReadLineAsync() is { } message)
                {
                    NativeTransportPolicy.RequireMessageLength(message.Length, "Browser host output");
                    if (_messages.Count >= NativeTransportPolicy.MaxQueuedMessages)
                        throw new InvalidDataException($"Переполнена очередь интерфейса: actualChars={message.Length}, queueLimit={NativeTransportPolicy.MaxQueuedMessages}. Кадры должны ждать подтверждения.");
                    _messages.Enqueue(message);
                }
            }
            catch (Exception e) { _error = e.Message; }
        });
        _ = Task.Run(async () =>
        {
            try
            {
                while (await child.StandardError.ReadLineAsync() is { } line)
                    _error = line;
            }
            catch (Exception) { }
        });
    }

    public void Send(object message)
    {
        var json = JsonSerializer.Serialize(message);
        NativeTransportPolicy.RequireMessageLength(json.Length, "Native host input");
        if (!_outbound.Writer.TryWrite(json))
            _error = "Переполнена очередь графического адаптера.";
    }
    public bool Poll(out string message) => _messages.TryDequeue(out message!);
    public void Dispose()
    {
        _outbound.Writer.TryComplete();
        if (_process == null)
            return;
        try
        {
            if (!_process.HasExited)
            {
                _process.StandardInput.Close();
                if (!_process.WaitForExit(1500))
                    _process.Kill(true);
            }
        }
        catch (Exception) { }
        _process.Dispose();
        _process = null;
    }
}

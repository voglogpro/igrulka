using Godot;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Skyfront.Client.Runtime;

/// <summary>Original multiplayer authority, idle until a room exists; loopback binding only.</summary>
public sealed class NativeServerProcess : IDisposable
{
    private Process? _process;
    public string Address { get; private set; } = "";
    public string Error { get; private set; } = "";
    public async Task StartAsync()
    {
        var package = Path.Combine(Path.GetDirectoryName(OS.GetExecutablePath())!, "network");
        if (!File.Exists(Path.Combine(package, "server.mjs")))
            package = Path.Combine(Path.GetFullPath(ProjectSettings.GlobalizePath("res://../..")), "native", "build", "network");
        if (!File.Exists(Path.Combine(package, "node.exe")))
            throw new FileNotFoundException("Не собран исходный сетевой сервер игры.");
        var start = new ProcessStartInfo(Path.Combine(package, "node.exe"))
        {
            WorkingDirectory = package,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        start.ArgumentList.Add(Path.Combine(package, "server.mjs"));
        _process = Process.Start(start) ?? throw new IOException("Не запустился сетевой сервер игры.");
        var child = _process;
        _ = Task.Run(async () => { try { while (await child.StandardError.ReadLineAsync() is { } line) Error = line; } catch (Exception) { } });
        var firstLine = await child.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(15));
        if (firstLine == null)
            throw new IOException("Сетевой сервер завершился: " + Error);
        using var document = JsonDocument.Parse(firstLine);
        if (document.RootElement.S("kind") != "server-ready" || document.RootElement.I("protocol") != 18)
            throw new InvalidDataException("Несовместимый сетевой сервер.");
        Address = document.RootElement.S("url");
        if (!Uri.TryCreate(Address, UriKind.Absolute, out var endpoint) || endpoint.Host != "127.0.0.1")
            throw new InvalidDataException("Локальный сервер не использует loopback.");
    }
    public void Dispose()
    {
        if (_process == null)
            return;
        try
        {
            if (!_process.HasExited)
            {
                _process.StandardInput.WriteLine("{\"cmd\":\"shutdown\"}");
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

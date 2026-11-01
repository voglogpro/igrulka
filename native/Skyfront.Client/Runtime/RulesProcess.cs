using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Godot;

namespace Skyfront.Client.Runtime;

public sealed class RulesProcess : IDisposable
{
    private Process? _process;
    private string? _latest;
    private int _id;
    private readonly ConcurrentQueue<string> _control = new();
    private readonly Channel<(int Id, string Cmd, object? Data)> _outbound = Channel.CreateBounded<(int, string, object?)>(32);
    public string Error { get; private set; } = "";
    public bool Alive => _process is { HasExited: false };
    public void Start()
    {
        var packaged = Path.Combine(Path.GetDirectoryName(OS.GetExecutablePath())!, "runtime");
        var repo = Path.GetFullPath(ProjectSettings.GlobalizePath("res://../.."));
        var bridge = Path.Combine(packaged, "bridge.mjs");
        var node = Path.Combine(packaged, "node.exe");
        if (!File.Exists(bridge))
            bridge = Path.Combine(repo, "native", "runtime", "bridge.mjs");
        if (!File.Exists(node))
            node = "node.exe";
        var start = new ProcessStartInfo(node)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            StandardInputEncoding = new UTF8Encoding(false)
        };
        start.ArgumentList.Add(bridge);
        _process = new Process { StartInfo = start };
        _process.Start();
        var started = _process;
        _ = Task.Run(async () =>
        {
            try
            {
                await foreach (var pending in _outbound.Reader.ReadAllAsync())
                {
                    var body = pending.Data == null ? new Dictionary<string, object?>() :
                        JsonSerializer.Deserialize<Dictionary<string, object?>>(JsonSerializer.Serialize(pending.Data))!;
                    body["id"] = pending.Id;
                    body["cmd"] = pending.Cmd;
                    await started.StandardInput.WriteLineAsync(JsonSerializer.Serialize(body));
                    await started.StandardInput.FlushAsync();
                }
            }
            catch (Exception e) { Error = e.Message; }
        });
        _ = Task.Run(async () =>
        {
            try
            {
                while (await _process.StandardOutput.ReadLineAsync() is { } line)
                {
                    if (line.Length > 20_000_000)
                        continue;
                    if (line.AsSpan(0, Math.Min(90, line.Length)).IndexOf("\"kind\":\"state\"".AsSpan()) >= 0)
                        Interlocked.Exchange(ref _latest, line);
                    else if (_control.Count < 32)
                        _control.Enqueue(line);
                }
            }
            catch (Exception e) { Error = e.Message; }
        });
        _ = Task.Run(async () =>
        {
            try
            {
                while (await _process.StandardError.ReadLineAsync() is { } line)
                    Error = line;
            }
            catch (Exception) { }
        });
    }
    public int Send(string cmd, object? data = null)
    {
        var id = Interlocked.Increment(ref _id);
        if (!Alive)
        {
            Error = "Локальная симуляция не запущена";
            return id;
        }
        if (!_outbound.Writer.TryWrite((id, cmd, data)))
        {
            if (_control.Count < 32)
                _control.Enqueue(JsonSerializer.Serialize(new
                {
                    kind = "error",
                    id,
                    message = "Очередь команд занята. Повторите действие через секунду."
                }));
        }
        return id;
    }
    public int Action(string type, object? payload = null) => Send("action", new { type, payload = payload ?? new { } });
    public bool PollControl(out string line) => _control.TryDequeue(out line!);
    public string? TakeState() => Interlocked.Exchange(ref _latest, null);
    public void Dispose()
    {
        if (_process == null)
            return;
        try
        {
            if (!_process.HasExited)
            {
                Send("quit");
                _outbound.Writer.TryComplete();
                if (!_process.WaitForExit(1200))
                    _process.Kill(true);
            }
        }
        catch (Exception) { }
        _process.Dispose();
        _process = null;
    }
}

using Godot;
using Skyfront.Client.Parity;
using Skyfront.Client.Runtime;
using System.Text.Json;
using System.Text;
using System.Diagnostics;

namespace Skyfront.Client;

/// <summary>Hosts the unchanged browser application over the native Godot scene renderer.</summary>
public partial class ParityApp : Node3D
{
    private readonly BrowserHostProcess _browser = new();
    private readonly NativeServerProcess _server = new();
    private WarAtmosphere _atmosphere = null!;
    private BrowserSceneView _scene = null!;
    private Label _status = null!;
    private bool _qa, _closing, _receivedFrame, _qaSent, _captured, _fixtureOnly, _exiting;
    private double _clock, _closeDeadline, _firstFrame;
    private long _frames;
    private string _capture = "", _testScript = "";
    private readonly List<double> _frameTimes = new();
    private double _lastApplyMs, _lastParseMs;
    private bool _qaFinished;
    private bool _rendererSeen;
    private bool _qaFailed;

    public override async void _Ready()
    {
        // Keep the project/user-data name stable so existing campaigns survive.
        DisplayServer.WindowSetTitle("Небесный рубеж — Godot 0.3 · правила 8.16");
        var args = OS.GetCmdlineUserArgs();
        _qa = args.Contains("--qa-parity");
        _capture = args.FirstOrDefault(x => x.StartsWith("--capture="))?[10..] ?? "";
        _testScript = args.FirstOrDefault(x => x.StartsWith("--qa-script="))?[12..] ?? "";
        var fixture = args.FirstOrDefault(x => x.StartsWith("--qa-scene-fixture="))?["--qa-scene-fixture=".Length..];
        _fixtureOnly = fixture != null;
        _qa |= _fixtureOnly;
        Engine.MaxFps = 60;
        GetTree().AutoAcceptQuit = false;
        _scene = new BrowserSceneView();
        AddChild(_scene);
        _atmosphere = new WarAtmosphere();
        AddChild(_atmosphere);
        _atmosphere.Configure(_scene.Camera);
        _atmosphere.Enabled = !args.Contains("--baseline-graphics");
        var layer = new CanvasLayer();
        AddChild(layer);
        _status = new Label { Text = "Загрузка полной игры 8.16…", Position = new Vector2(22, 22), MouseFilter = Control.MouseFilterEnum.Ignore };
        layer.AddChild(_status);
        if (_fixtureOnly)
        {
            try
            {
                using var fixtureDoc = JsonDocument.Parse(System.IO.File.ReadAllText(fixture!));
                var original = fixtureDoc.RootElement;
                _scene.Apply(original);
                var initial = JsonSerializer.SerializeToElement(_scene.Diagnostics()).I("objects");
                _scene.Apply(JsonSerializer.SerializeToElement(new
                {
                    kind = "scene",
                    protocol = 1,
                    seq = 2,
                    frame = new
                    {
                        objects = Array.Empty<object>(),
                        removed = Array.Empty<object>()
                    }
                }));
                var retained = JsonSerializer.SerializeToElement(_scene.Diagnostics()).I("objects");
                if (initial == 0 || retained != initial)
                    throw new InvalidDataException("Static scene vanished on an empty delta.");
                var remove = original.P("frame").P("objects").Items().First(x => x.S("type") == "line").S("id");
                _scene.Apply(JsonSerializer.SerializeToElement(new
                {
                    kind = "scene",
                    protocol = 1,
                    seq = 3,
                    frame = new
                    {
                        objects = Array.Empty<object>(),
                        removed = new[] { remove }
                    }
                }));
                var afterRemoval = JsonSerializer.SerializeToElement(_scene.Diagnostics()).I("objects");
                if (afterRemoval != initial - 1)
                    throw new InvalidDataException("Explicit object removal failed.");
                _scene.Apply(original);
                _receivedFrame = true;
                _frames = 4;
                _firstFrame = _clock;
                _status.Visible = false;
                GD.Print("SKYFRONT_PARITY_DELTA_QA " + JsonSerializer.Serialize(new
                {
                    initial,
                    retained,
                    afterRemoval,
                    passed = true
                }));
            }
            catch (Exception e) { ShowError(e.ToString()); }
            return;
        }
        try
        {
            try
            {
                await _server.StartAsync();
            }
            catch (Exception serverError) { GD.Print("Локальная сетевая служба недоступна: " + serverError.Message); }
            if (_exiting || !IsInsideTree())
                return;
            var handle = DisplayServer.WindowGetNativeHandle(DisplayServer.HandleType.WindowHandle);
            var profile = ProjectSettings.GlobalizePath(_qa ? $"user://parity-qa/run-{System.Environment.ProcessId}/browser-profile" : "user://browser-profile");
            _browser.Start(handle, profile, _qa);
        }
        catch (Exception e) { ShowError(e.ToString()); }
    }

    public override void _Process(double delta)
    {
        _clock += delta;
        if (_receivedFrame && _clock > _firstFrame + 8 && _frameTimes.Count < 3600)
            _frameTimes.Add(delta * 1000);
        for (var index = 0; index < 4 && _browser.Poll(out var line); index++)
        {
            try
            {
                var parseStart = Stopwatch.GetTimestamp();
                using var doc = JsonDocument.Parse(line);
                _lastParseMs = Stopwatch.GetElapsedTime(parseStart).TotalMilliseconds;
                var message = doc.RootElement;
                switch (message.S("kind"))
                {
                    case "renderer-attached":
                        if (_rendererSeen && _qa && _testScript != "")
                        {
                            _qaSent = false;
                            _qaFinished = false;
                        }
                        _rendererSeen = true;
                        _scene.Reset();
                        _browser.Send(new
                        {
                            kind = "native-ready",
                            protocol = 1,
                            serverAddress = _server.Address,
                            enhancedGraphics = _atmosphere.Enabled
                        });
                        break;
                    case "host-ready":
                        _browser.Send(new
                        {
                            kind = "native-ready",
                            protocol = 1,
                            serverAddress = _server.Address,
                            enhancedGraphics = _atmosphere.Enabled
                        });
                        break;
                    case "scene":
                        var applyStart = Stopwatch.GetTimestamp();
                        _scene.Apply(message);
                        _atmosphere.Apply(message.P("frame"));
                        _lastApplyMs = Stopwatch.GetElapsedTime(applyStart).TotalMilliseconds;
                        _frames++;
                        if (!_receivedFrame)
                        {
                            _receivedFrame = true;
                            _firstFrame = _clock;
                        }
                        _status.Visible = false;
                        _browser.Send(new
                        {
                            kind = "scene-ack",
                            seq = message.I("seq"),
                            packetBytes = Encoding.UTF8.GetByteCount(line),
                            applyMs = _lastApplyMs,
                            parseMs = _lastParseMs,
                            scene = _qa ? _scene.Diagnostics() : null
                        });
                        break;
                    case "host-error":
                    case "native-error":
                    case "web-error":
                        ShowError(message.S("message", line));
                        break;
                    case "host-transport":
                        if (_qa)
                            GD.Print("SKYFRONT_PARITY_TRANSPORT " + line);
                        break;
                    case "startup-stage":
                    case "web-status":
                        if (_qa)
                            GD.Print("SKYFRONT_PARITY_STARTUP " + line);
                        break;
                    case "qa-result":
                        GD.Print("SKYFRONT_PARITY_WEB_QA " + line);
                        if (_qa && _capture != "" && message.S("stage").StartsWith("capture-", StringComparison.Ordinal))
                            _ = CapturePhase(message.S("stage"));
                        if (message.S("stage") == "complete")
                            _qaFinished = true;
                        break;
                    case "host-eval-result":
                        if (_closing && message.S("id") == "close-save")
                            GetTree().Quit();
                        break;
                }
            }
            catch (Exception e) { ShowError(e.ToString()); }
        }
        if (_qa && !_fixtureOnly && !_qaSent && _clock > 3 && _browser.Alive)
        {
            _qaSent = true;
            var script = _testScript != "" ? System.IO.File.ReadAllText(_testScript) :
                "window.chrome.webview.postMessage({kind:'qa-result',ready:!!window.skyfront,diagnostics:window.skyfront?.diagnostics?.(),body:document.querySelector('#welcome')?.innerText,error:document.querySelector('#native-error')?.innerText,startup:document.querySelector('.startup-status')?.innerText});";
            _browser.Send(new
            {
                kind = "host-eval",
                id = "qa",
                script
            });
        }
        if (_qa && _receivedFrame && _clock > _firstFrame + 30 && (_testScript == "" || _qaFinished) && !_captured)
        {
            _captured = true;
            _ = CaptureAndQuit();
        }
        if (_qa && _clock > 100 && !_receivedFrame)
        {
            ShowError("Не получен первый нативный кадр: " + _browser.Error);
            GetTree().Quit(1);
        }
        if (_clock > 90 && !_receivedFrame && !_browser.Alive)
            ShowError("Интерфейс не запустился: " + _browser.Error);
        if (_closing && _clock > _closeDeadline)
            GetTree().Quit();
    }
    private void ShowError(string error)
    {
        _status.Visible = true;
        _status.Text = error;
        _status.Modulate = new Color("ffae90");
        if (_browser.Alive)
            _browser.Send(new
            {
                kind = "native-error",
                message = error
            });
        GD.PushError(error);
        // A fatal host/scene error cannot leave an automated run waiting for a
        // script in a closed WebView. Preserve the failure and exit nonzero.
        if (_qa && !_qaFailed)
        {
            _qaFailed = true;
            GD.Print("SKYFRONT_PARITY_NATIVE_FAILURE " + JsonSerializer.Serialize(new
            {
                passed = false,
                error,
                receivedFrame = _receivedFrame,
                scene = _scene.Diagnostics()
            }));
            GetTree().Quit(1);
        }
    }
    private async Task CapturePhase(string stage)
    {
        try
        {
            await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            if (_qaFailed || !IsInsideTree())
                return;
            var suffix = string.Concat(stage.Where(character => char.IsAsciiLetterOrDigit(character) || character == '-'));
            suffix = suffix[..Math.Min(suffix.Length, 80)];
            var destination = System.IO.Path.GetFullPath(_capture);
            var path = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(destination)!,
                System.IO.Path.GetFileNameWithoutExtension(destination) + "-" + suffix + ".png");
            var result = GetViewport().GetTexture().GetImage().SavePng(path);
            if (result != Error.Ok)
                throw new IOException("Native QA capture failed: " + result);
            var position = _scene.Camera.GlobalPosition;
            GD.Print("SKYFRONT_PARITY_CAPTURE " + JsonSerializer.Serialize(new
            {
                stage,
                path,
                scope = "Owned Godot viewport only; HTML interface is a separate window layer",
                camera = new { x = position.X, y = position.Y, z = position.Z, fov = _scene.Camera.Fov },
                scene = _scene.Diagnostics()
            }));
        }
        catch (Exception error) { ShowError(error.ToString()); }
    }
    private async Task CaptureAndQuit()
    {
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        if (_capture != "")
            GetViewport().GetTexture().GetImage().SavePng(_capture);
        var values = _frameTimes.Order().ToArray();
        GD.Print("SKYFRONT_PARITY_NATIVE_QA " + JsonSerializer.Serialize(new
        {
            receivedFrame = _receivedFrame,
            frames = _frames,
            p95ms = values.Length > 0 ? values[(int)((values.Length - 1) * .95)] : 0,
            maximumMs = values.LastOrDefault(),
            drawCalls = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame),
            primitives = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalPrimitivesInFrame),
            applyMs = _lastApplyMs,
            parseMs = _lastParseMs,
            scene = _scene.Diagnostics(),
            renderer = RenderingServer.GetCurrentRenderingMethod()
        }));
        GetTree().Quit();
    }
    public override void _Notification(int what)
    {
        if (what != NotificationWMCloseRequest)
            return;
        if (_qa || !_browser.Alive)
        {
            GetTree().Quit();
            return;
        }
        _closing = true;
        _closeDeadline = _clock + 5;
        _browser.Send(new
        {
            kind = "host-eval",
            id = "close-save",
            script = "window.skyfront?.save?.();"
        });
    }
    public override void _ExitTree()
    {
        _exiting = true;
        _browser.Dispose();
        _server.Dispose();
    }
}

using Godot;
using System.Text.Json;
using Skyfront.Client.Runtime;
using Skyfront.Client.Rendering;
using Skyfront.Client.UI;
using Skyfront.Client.Audio;

namespace Skyfront.Client;

public partial class App : Node3D
{
    private readonly RulesProcess _rules = new();
    private readonly CampaignWriter _writer = new();
    private TerrainView _terrain = null!;
    private BattleView _battle = null!;
    private CombatEffects _effects = null!;
    private RtsCamera _camera = null!;
    private NativeAudio _audio = null!;
    private WeatherView _weather = null!;
    private LandmarkView _landmarks = null!;
    private MapOverview _map = null!;
    private WorldEnvironment _environment = null!;
    private DirectionalLight3D _sun = null!;
    private ProceduralSkyMaterial _sky = null!;
    private Hud _hud = null!;
    private JsonDocument? _stateDoc, _worldDoc;
    private JsonElement State => _stateDoc?.RootElement ?? default;
    private JsonElement World => _worldDoc?.RootElement ?? default;
    private readonly HashSet<int> _army = new();
    private int _selected, _saveId;
    private bool _menu = true, _paused = true, _muted;
    private string _tool = "", _key = "";
    private Vector3? _roadStart;
    private readonly List<object> _waypoints = new();
    private Vector2 _press, _rightPress;
    private bool _drag, _right;
    private Node3D? _ghost;
    private MeshInstance3D _aimRing = null!;
    private MeshInstance3D _route = null!;
    private readonly ImmediateMesh _routeMesh = new();
    private double _clock;
    private bool _qa, _qaCaptured;
    private string _qaPath = "";
    private bool _qaFlow;
    private int _qaStage;
    private double _qaNext;
    private float _qaCredits;
    private bool _qaPaid;
    private double _worldReadyAt;
    private readonly List<double> _frameTimes = new();
    private double _autoSaveAt = 90, _quitAt;
    private bool _closing, _closingSaved, _saving;
    private float _skyDaylight = -1;
    public override void _Ready()
    {
        Name = "SkyfrontNative";
        _qa = OS.GetCmdlineUserArgs().Contains("--qa");
        _qaFlow = OS.GetCmdlineUserArgs().Contains("--qa-flow");
        _qaPath = OS.GetCmdlineUserArgs().FirstOrDefault(x => x.StartsWith("--capture="))?.Substring(10) ?? "";
        BuildLighting();
        _terrain = new TerrainView();
        AddChild(_terrain);
        _effects = new CombatEffects();
        AddChild(_effects);
        _battle = new BattleView { Terrain = _terrain, Effects = _effects };
        AddChild(_battle);
        _camera = new RtsCamera();
        AddChild(_camera);
        _audio = new NativeAudio();
        AddChild(_audio);
        _weather = new WeatherView();
        AddChild(_weather);
        if (_qa)
        {
            _muted = true;
            _audio.SetMuted(true);
            _weather.SetMuted(true);
        }
        _landmarks = new LandmarkView { Terrain = _terrain };
        AddChild(_landmarks);
        _aimRing = new MeshInstance3D { Mesh = new TorusMesh { InnerRadius = .97f, OuterRadius = 1, Rings = 64, RingSegments = 4 }, Visible = false, MaterialOverride = new StandardMaterial3D { AlbedoColor = new Color("d2b577"), ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded }, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        AddChild(_aimRing);
        _route = new MeshInstance3D { Mesh = _routeMesh };
        AddChild(_route);
        _hud = new Hud();
        AddChild(_hud);
        _hud.Command += UiCommand;
        _map = new MapOverview();
        _hud.AddChild(_map);
        _map.FocusRequested += point => _camera.Focus = new Vector3(point.X, 0, point.Y);
        GetWindow().FilesDropped += files => { if (files.Length == 1 && files[0].EndsWith(".json", StringComparison.OrdinalIgnoreCase)) LoadCampaign(files[0]); };
        _hud.ShowMenu(true);
        _hud.SetReady(false);
        try
        {
            _rules.Start();
            _rules.Send("pause", new
            {
                paused = true
            });
            var fixture = OS.GetCmdlineUserArgs().FirstOrDefault(x => x.StartsWith("--fixture="))?.Substring(10);
            if (_qa && fixture != null && System.IO.File.Exists(fixture))
                _rules.Send("load", new
                {
                    data = System.IO.File.ReadAllText(fixture)
                });
        }
        catch (Exception e) { _hud.ShowMessage("Не удалось запустить симуляцию: " + e.Message, true); GD.PushError(e.ToString()); }
        GetTree().AutoAcceptQuit = false;
        Engine.MaxFps = 60;
    }
    private void BuildLighting()
    {
        _sky = new ProceduralSkyMaterial
        {
            SkyTopColor = new Color("243e58"),
            SkyHorizonColor = new Color("a8a89b"),
            GroundBottomColor = new Color("202a25"),
            GroundHorizonColor = new Color("8e9384")
        };
        _environment = new WorldEnvironment
        {
            Environment = new Godot.Environment
            {
                BackgroundMode = Godot.Environment.BGMode.Sky,
                Sky = new Sky { SkyMaterial = _sky, RadianceSize = Sky.RadianceSizeEnum.Size128, ProcessMode = Sky.ProcessModeEnum.Incremental },
                AmbientLightSource = Godot.Environment.AmbientSource.Color,
                AmbientLightColor = new Color("a5b2c2"),
                AmbientLightEnergy = .45f,
                TonemapMode = Godot.Environment.ToneMapper.Filmic,
                FogEnabled = true,
                FogLightColor = new Color("64776f"),
                FogDensity = .00011f
            }
        };
        AddChild(_environment);
        _sun = new DirectionalLight3D
        {
            RotationDegrees = new Vector3(-26, -34, 0),
            LightColor = new Color("ffdbac"),
            LightEnergy = 1.1f,
            ShadowEnabled = true,
            DirectionalShadowMaxDistance = 1100,
            ShadowBias = .08f
        };
        AddChild(_sun);
    }
    public override void _Process(double delta)
    {
        _clock += delta;
        if (!_qa && !_menu && !_closing && _stateDoc != null && _clock > _autoSaveAt)
        {
            _autoSaveAt = _clock + 90;
            _saveId = _rules.Send("save");
        }
        if (_qa && _worldDoc != null && _clock > _worldReadyAt + 4 && _frameTimes.Count < 1800)
            _frameTimes.Add(delta * 1000);
        for (var i = 0; i < 8 && _rules.PollControl(out var line); i++)
            ControlMessage(line);
        var stateLine = _rules.TakeState();
        if (stateLine != null)
        {
            try
            {
                var next = JsonDocument.Parse(stateLine);
                var previous = _stateDoc;
                _stateDoc = next;
                _paused = State.B("paused");
                _battle.Paused = _paused;
                _effects.ProcessMode = _paused ? ProcessModeEnum.Disabled : ProcessModeEnum.Inherit;
                _battle.Apply(State);
                _army.RemoveWhere(id => _battle.Entity(id).ValueKind != JsonValueKind.Object);
                _battle.Select(_selected);
                _hud.UpdateState(State, _battle.Entity(_selected), _army.Count);
                _audio.SetPaused(_paused);
                _audio.Consume(State, _camera);
                _weather.UpdateState(State, _camera);
                _landmarks.UpdateState(State);
                _map.UpdateState(State, _camera);
                var daylight = Mathf.Max(0, (Mathf.Sin((((18.5f + State.F("time") / 50) % 24 - 6) / 24) * Mathf.Tau) + .18f) / 1.18f);
                _sun.LightEnergy = .32f + daylight * .9f;
                _sun.LightColor = new Color("c4d0e2").Lerp(new Color("ffdfb5"), daylight);
                _environment.Environment.AmbientLightEnergy = .32f + daylight * .32f;
                // Sky radiance is expensive on integrated GPUs. The sun remains smooth,
                // but the much slower sky gradient only invalidates when it changes visibly.
                if (Mathf.Abs(daylight - _skyDaylight) > .025f)
                {
                    _skyDaylight = daylight;
                    _sky.SkyTopColor = new Color("152633").Lerp(new Color("5685a0"), daylight);
                    _sky.SkyHorizonColor = new Color("57666d").Lerp(new Color("b3bdad"), daylight);
                }
                previous?.Dispose();
            }
            catch (Exception e) { GD.PushError(e.ToString()); _hud.ShowMessage(e.Message, true); }
        }
        if (_tool != "" && !_menu)
            UpdatePreview();
        _map.Visible = !_menu;
        _camera.InputEnabled = !_qa && !_menu && GetViewport().GuiGetFocusOwner() is not LineEdit and not SpinBox;
        if (_qaFlow && _worldDoc != null && _stateDoc != null && _qaStage == 0)
        {
            _qaStage = 1;
            _qaNext = _clock + 4;
            _qaCredits = State.P("sides").Items().First().F("credits");
            var hq = State.P("sideHQ").Items().First(x => x.I("side") == 0);
            _menu = false;
            _hud.ShowMenu(false);
            _rules.Send("pause", new
            {
                paused = false
            });
            _rules.Action("build", new
            {
                key = "housing",
                x = hq.F("x") - 40,
                z = hq.F("z") - 80,
                rotation = 0
            });
        }
        if (_qaFlow && _qaStage == 1 && _clock > _qaNext)
        {
            _qaPaid = State.P("sides").Items().First().F("credits") < _qaCredits && State.P("buildings").Items().Any(x => x.I("side") == 0 && x.S("key") == "housing");
            _saveId = _rules.Send("save");
            _qaStage = 2;
            _qaNext = _clock + 3;
        }
        if (_qa && _worldDoc != null && _clock > 24 && _clock > _worldReadyAt + 8 && (!_qaFlow || _qaStage == 2 && _clock > _qaNext) && !_qaCaptured)
        {
            _qaCaptured = true;
            _hud.ShowMenu(false);
            _ = CaptureAndQuit();
        }
        if (_clock > 60 && _worldDoc == null && !_rules.Alive)
            _hud.ShowMessage("Симуляция завершилась: " + _rules.Error, true);
        if (_saving && !_writer.Busy)
        {
            _saving = false;
            if (_writer.Error.Length == 0)
            {
                _closingSaved = true;
                _hud.ShowMessage("Кампания сохранена");
            }
            else
            {
                _closing = false;
                _hud.ShowMessage("Не удалось сохранить кампанию: " + _writer.Error, true);
            }
        }
        if (_closing && (_clock > _quitAt || _closingSaved && !_writer.Busy))
            GetTree().Quit();
    }
    private async Task CaptureAndQuit()
    {
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        if (_qaPath != "")
            GetViewport().GetTexture().GetImage().SavePng(_qaPath);
        var sortedFrames = _frameTimes.Order().ToArray();
        GD.Print("SKYFRONT_NATIVE_QA " + JsonSerializer.Serialize(new
        {
            ready = true,
            gameTime = State.F("time"),
            buildings = State.P("buildings").Items().Count(),
            groundUnits = State.P("groundUnits").Items().Count(),
            paidConstruction = _qaFlow ? _qaPaid : (bool?)null,
            saved = _qaFlow ? System.IO.File.Exists(SavePath()) : (bool?)null,
            renderer = RenderingServer.GetCurrentRenderingMethod(),
            drawCalls = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame),
            drawnObjects = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalObjectsInFrame),
            frames = sortedFrames.Length,
            frameP95ms = sortedFrames.Length > 0 ? sortedFrames[(int)((sortedFrames.Length - 1) * .95)] : 0,
            frameMaxMs = sortedFrames.LastOrDefault(),
            note = "Short native launch check; not a large-army performance guarantee"
        }));
        GetTree().Quit();
    }
    private void ControlMessage(string line)
    {
        try
        {
            using var d = JsonDocument.Parse(line);
            var e = d.RootElement;
            if (e.S("kind") == "world")
            {
                _worldDoc?.Dispose();
                _worldDoc = JsonDocument.Parse(line);
                _worldReadyAt = _clock;
                _battle.Clear();
                _effects.Reset();
                _army.Clear();
                _selected = 0;
                _terrain.ApplyWorld(World);
                _hud.SetCatalogs(World);
                _audio.ConfigureWorld(World);
                _landmarks.ApplyWorld(World);
                _map.ApplyWorld(World);
                _hud.SetReady(true);
                _hud.ShowMessage("Город готов. Постройте жильё и промышленность рядом с подъездной улицей.");
            }
            else if (e.S("kind") == "error")
                _hud.ShowMessage(e.S("message", "Команда не выполнена"), true);
            else if (e.S("kind") == "reply")
            {
                if (e.I("id") == _saveId && e.P("data").ValueKind == JsonValueKind.String)
                {
                    _writer.Save(SavePath(), e.S("data"));
                    _saving = true;
                    _hud.ShowMessage("Записываем кампанию…");
                }
            }
        }
        catch (Exception e) { GD.PushError(e.ToString()); _hud.ShowMessage(e.Message, true); }
    }
    private string SavePath() => ProjectSettings.GlobalizePath(_qa ? "user://qa/campaign-816.json" : "user://campaign-816.json");
    private void LoadCampaign(string path)
    {
        try
        {
            if (new System.IO.FileInfo(path).Length > 16_000_000)
            {
                _hud.ShowMessage("Сохранение слишком большое", true);
                return;
            }
            _rules.Send("load", new
            {
                data = System.IO.File.ReadAllText(path)
            });
            _menu = false;
            _hud.ShowMenu(false);
            CancelTool();
        }
        catch (Exception e) { _hud.ShowMessage(e.Message, true); }
    }
    private void UiCommand(string verb, string key)
    {
        switch (verb)
        {
            case "new":
                _rules.Send("new", new
                {
                    seed = (uint)System.DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    mode = key,
                    difficulty = "normal"
                });
                _rules.Send("pause", new
                {
                    paused = false
                });
                _menu = false;
                _hud.ShowMenu(false);
                CancelTool();
                break;
            case "menu":
                _menu = !_menu;
                _hud.ShowMenu(_menu);
                _rules.Send("pause", new
                {
                    paused = _menu
                });
                break;
            case "resume":
                _menu = false;
                _hud.ShowMenu(false);
                _rules.Send("pause", new
                {
                    paused = false
                });
                break;
            case "pause":
                _rules.Send("pause", new
                {
                    paused = !_paused
                });
                break;
            case "save":
                _saveId = _rules.Send("save");
                break;
            case "load":
                if (System.IO.File.Exists(SavePath()))
                    LoadCampaign(SavePath());
                else
                {
                    var dialog = new FileDialog { FileMode = FileDialog.FileModeEnum.OpenFile, Access = FileDialog.AccessEnum.Filesystem, UseNativeDialog = true, Title = "Открыть кампанию Небесного рубежа", Filters = new[] { "*.json ; Кампания" } };
                    _hud.AddChild(dialog);
                    dialog.FileSelected += path => { LoadCampaign(path); dialog.QueueFree(); };
                    dialog.Canceled += () => dialog.QueueFree();
                    dialog.PopupCentered(new Vector2I(800, 550));
                }
                break;
            case "sound":
                _muted = !_muted;
                _audio.SetMuted(_muted);
                _weather.SetMuted(_muted);
                break;
            case "focus":
                var target = State.P("sideHQ").Items().FirstOrDefault(x => key == "own" ? x.I("side") == 0 : x.I("side") != 0);
                if (target.ValueKind == JsonValueKind.Object)
                    _camera.Focus = new Vector3(target.F("x"), 0, target.F("z"));
                break;
            case "build":
                SetTool("build", key);
                break;
            case "road":
                SetTool("road", "");
                break;
            case "launch":
                SetTool("launch", key);
                break;
            case "produce":
                _rules.Action("factory-order", new
                {
                    key,
                    count = Math.Clamp(_hud.Count, 1, 100)
                });
                break;
            case "recruit":
                SetTool("deploy", key);
                break;
            case "army-target":
                _rules.Action("army-target", new
                {
                    key,
                    count = _hud.Count
                });
                break;
            case "army-target-stop":
                _rules.Action("army-target", new
                {
                    key,
                    count = 0
                });
                break;
            case "auto-defense":
                if (_army.Count > 0)
                    _rules.Action("auto-defense", new
                    {
                        ids = _army.ToArray(),
                        enabled = true
                    });
                else
                    _hud.ShowMessage("Сначала выделите бойцов или нажмите «Выбрать» во вкладке армии", true);
                break;
            case "repair":
            case "upgrade":
            case "demolish":
                if (_selected > 0)
                    _rules.Action(verb, new
                    {
                        id = _selected
                    });
                break;
            case "defense-attack":
            case "attack-recall":
                _rules.Action(verb);
                break;
            case "select-army":
                _army.Clear();
                foreach (var u in State.P("groundUnits").Items())
                    if (u.I("side") == 0)
                        _army.Add(u.I("id"));
                _hud.ShowMessage($"Выбрано бойцов и техники: {_army.Count}. ПКМ по земле — приказ.");
                break;
            case "stop":
            case "dig":
                _rules.Action("stance", new
                {
                    ids = _army.ToArray(),
                    command = verb
                });
                break;
        }
    }
    private void SetTool(string tool, string key)
    {
        CancelTool();
        _tool = tool;
        _key = key;
        _hud.SetTool(tool switch
        {
            "road" => "Дорога: выберите начало и конец · ПКМ отменить",
            "launch" => "Пуск: ЛКМ по цели · Shift+ЛКМ добавить точку маршрута · ПКМ отменить",
            "deploy" => "Выберите точку: после подготовки бойцы придут сюда",
            _ => "ЛКМ построить · ПКМ отменить"
        });
        if (tool == "build")
        {
            _ghost = ModelLibrary.BuildBuilding(key, 0);
            AddChild(_ghost);
        }
        _aimRing.Visible = tool is "launch" or "deploy";
    }
    private void CancelTool()
    {
        _tool = "";
        _key = "";
        _roadStart = null;
        _waypoints.Clear();
        _ghost?.QueueFree();
        _ghost = null;
        _aimRing.Visible = false;
        _route.Visible = false;
        _hud.SetTool("");
    }
    private void UpdatePreview()
    {
        var p = _camera.GroundPoint(GetViewport().GetMousePosition(), _terrain);
        if (_ghost != null)
            _ghost.Position = p;
        if (_aimRing.Visible)
        {
            _aimRing.Position = p + Vector3.Up * .6f;
            var r = _tool == "launch" ? World.P("catalogs").P("weapons").P(_key).F("radius", 25) : 18;
            _aimRing.Scale = new Vector3(r, 1, r);
        }
        if (_tool == "road" && _roadStart.HasValue)
            PreviewLine(_roadStart.Value, p);
        else if (_tool == "launch")
        {
            var source = State.P("buildings").Items().Where(x => x.I("side") == 0 && x.S("key") is "launcher" or "silo").OrderBy(x => x.Point().DistanceSquaredTo(p)).FirstOrDefault();
            if (source.ValueKind == JsonValueKind.Object)
                PreviewLine(source.Point(_terrain.GroundHeight(source.F("x"), source.F("z"))) + Vector3.Up * 3, p);
        }
    }
    private void PreviewLine(Vector3 a, Vector3 b)
    {
        _routeMesh.ClearSurfaces();
        _routeMesh.SurfaceBegin(Mesh.PrimitiveType.Lines);
        _routeMesh.SurfaceAddVertex(a + Vector3.Up);
        _routeMesh.SurfaceAddVertex(b + Vector3.Up);
        _routeMesh.SurfaceEnd();
        _route.MaterialOverride ??= new StandardMaterial3D { AlbedoColor = new Color("d0b47b"), ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded };
        _route.Visible = true;
    }
    public override void _UnhandledInput(InputEvent e)
    {
        if (_qa)
            return;
        if (e is InputEventKey k && k.Pressed && !k.Echo)
        {
            if (k.PhysicalKeycode == Key.Escape)
            {
                if (_tool != "")
                    CancelTool();
                else
                    UiCommand("menu", "");
            }
            if (k.PhysicalKeycode == Key.Space && !_menu)
                UiCommand("pause", "");
            if (k.PhysicalKeycode == Key.F5)
                UiCommand("save", "");
            if (k.PhysicalKeycode == Key.F9)
                UiCommand("load", "");
            if (k.PhysicalKeycode == Key.E)
                _hud.ShowCategory("arsenal");
            if (k.PhysicalKeycode == Key.F)
                _hud.ShowCategory("army");
        }
        if (_menu)
            return;
        if (e is InputEventMouseMotion motion && _right)
        {
            _camera.Yaw -= motion.Relative.X * .006f;
            _camera.Pitch = Mathf.Clamp(_camera.Pitch + motion.Relative.Y * .004f, .3f, 1.3f);
        }
        if (e is InputEventMouseMotion dragMotion && _drag && _tool == "")
            _hud.SelectionBox(_press, dragMotion.Position, dragMotion.Position.DistanceTo(_press) > 12);
        if (e is not InputEventMouseButton mb)
            return;
        if (mb.ButtonIndex == MouseButton.WheelUp && mb.Pressed)
            _camera.Zoom(.88f);
        if (mb.ButtonIndex == MouseButton.WheelDown && mb.Pressed)
            _camera.Zoom(1.14f);
        if (mb.ButtonIndex == MouseButton.Right)
        {
            if (mb.Pressed)
            {
                if (_tool != "")
                {
                    CancelTool();
                    return;
                }
                _right = true;
                _rightPress = mb.Position;
            }
            else
            {
                _right = false;
                if (mb.Position.DistanceTo(_rightPress) < 6 && _army.Count > 0)
                {
                    var p = _camera.GroundPoint(mb.Position, _terrain);
                    var hit = _battle.Entities.Where(x => x.I("side") != 0 && !(State.S("mode") == "coop" && x.I("side") == 2) && !_camera.IsPositionBehind(x.Point())).OrderBy(x => _camera.UnprojectPosition(x.Point()).DistanceSquaredTo(mb.Position)).FirstOrDefault();
                    if (hit.ValueKind == JsonValueKind.Object && _camera.UnprojectPosition(hit.Point()).DistanceTo(mb.Position) < 30)
                        _rules.Action("order", new
                        {
                            ids = _army.ToArray(),
                            aim = new
                            {
                                x = hit.F("x"),
                                z = hit.F("z"),
                                mode = "attack",
                                targetId = hit.I("id")
                            }
                        });
                    else
                        _rules.Action("order", new
                        {
                            ids = _army.ToArray(),
                            aim = new
                            {
                                x = p.X,
                                z = p.Z,
                                mode = mb.CtrlPressed ? "attackmove" : "move"
                            }
                        });
                }
            }
        }
        if (mb.ButtonIndex != MouseButton.Left)
            return;
        if (mb.Pressed)
        {
            _press = mb.Position;
            _drag = true;
            return;
        }
        if (!_drag)
            return;
        _drag = false;
        _hud.SelectionBox(Vector2.Zero, Vector2.Zero, false);
        var point = _camera.GroundPoint(mb.Position, _terrain);
        if (_tool == "build")
            _rules.Action("build", new
            {
                key = _key,
                x = point.X,
                z = point.Z,
                rotation = 0
            });
        else if (_tool == "road")
        {
            if (_roadStart.HasValue)
            {
                var a = _roadStart.Value;
                _rules.Action("road", new
                {
                    a = new
                    {
                        x = a.X,
                        z = a.Z
                    },
                    b = new
                    {
                        x = point.X,
                        z = point.Z
                    }
                });
                _roadStart = point;
            }
            else
                _roadStart = point;
        }
        else if (_tool == "launch")
        {
            if (mb.ShiftPressed && _waypoints.Count < 10)
                _waypoints.Add(new
                {
                    x = point.X,
                    z = point.Z
                });
            else
            {
                var payload = new Dictionary<string, object> { ["key"] = _key, ["count"] = Math.Clamp(_hud.Count, 1, 6), ["aim"] = new { x = point.X, z = point.Z, waypoints = _waypoints.ToArray() } };
                var site = _battle.Entity(_selected);
                if (site.I("side", -1) == 0 && site.S("key") is "launcher" or "silo")
                    payload["siteId"] = _selected;
                _rules.Action("launch", payload);
                _waypoints.Clear();
            }
        }
        else if (_tool == "deploy")
            _rules.Action("deploy", new
            {
                key = _key,
                count = Math.Clamp(_hud.Count, 1, 5),
                point = new
                {
                    x = point.X,
                    z = point.Z
                }
            });
        else
            SelectAt(mb.Position, mb.ShiftPressed);
    }
    private void SelectAt(Vector2 position, bool add)
    {
        if (!add)
            _army.Clear();
        if (position.DistanceTo(_press) > 12)
        {
            var rect = new Rect2(_press, position - _press).Abs();
            foreach (var u in State.P("groundUnits").Items())
                if (u.I("side") == 0 && !_camera.IsPositionBehind(u.Point()) && rect.HasPoint(_camera.UnprojectPosition(u.Point())))
                    _army.Add(u.I("id"));
        }
        else
        {
            var nearest = _battle.Entities.Where(x => !_camera.IsPositionBehind(x.Point())).Select(x => (Data: x, D: _camera.UnprojectPosition(x.Point()).DistanceTo(position))).Where(x => x.D < 38).OrderBy(x => x.D).FirstOrDefault();
            _selected = nearest.Data.ValueKind == JsonValueKind.Object ? nearest.Data.I("id") : 0;
            if (_selected != 0 && State.P("groundUnits").Items().Any(x => x.I("id") == _selected && x.I("side") == 0))
                _army.Add(_selected);
        }
        _battle.Select(_selected);
        _hud.UpdateState(State, _battle.Entity(_selected), _army.Count);
    }
    public override void _Notification(int what)
    {
        if (what != NotificationWMCloseRequest)
            return;
        if (_qa || _stateDoc == null || !_rules.Alive)
        {
            GetTree().Quit();
            return;
        }
        _closing = true;
        _closingSaved = false;
        _quitAt = _clock + 3;
        _rules.Send("pause", new
        {
            paused = true
        });
        _saveId = _rules.Send("save");
        _hud.ShowMessage("Сохраняем кампанию…");
    }
    public override void _ExitTree()
    {
        _rules.Dispose();
        _stateDoc?.Dispose();
        _worldDoc?.Dispose();
    }
}

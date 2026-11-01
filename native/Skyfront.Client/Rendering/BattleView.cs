using Godot;
using System.Text.Json;
using Skyfront.Client.Runtime;

namespace Skyfront.Client.Rendering;

public partial class BattleView : Node3D
{
    private sealed class Visual
    {
        public Node3D Node = null!;
        public Vector3 Target;
        public string Kind = "", Key = "";
        public int Side;
        public bool Falling;
        public bool BatchedInfantry;
        public bool BatchedVehicle;
        public int Paint;
        public float Yaw, Phase;
    }
    private readonly Dictionary<string, Visual> _visuals = new();
    private readonly Dictionary<int, JsonElement> _entities = new();
    private readonly HashSet<string> _live = new();
    private MeshInstance3D? _roads;
    private long _roadHash;
    private readonly TorusMesh _ringMesh = new() { InnerRadius = 8.4f, OuterRadius = 9, Rings = 24, RingSegments = 6 };
    private readonly StandardMaterial3D _ringMat = new() { AlbedoColor = new Color("e4c183"), ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded };
    private MeshInstance3D _selection = null!;
    private float _animationTime;
    private InfantryBatch _infantryBatch = null!;
    private VehicleBatch _vehicleBatch = null!;
    public TerrainView Terrain = null!;
    public CombatEffects Effects = null!;
    public bool Paused;
    public override void _Ready()
    {
        _infantryBatch = new InfantryBatch();
        AddChild(_infantryBatch);
        _vehicleBatch = new VehicleBatch();
        AddChild(_vehicleBatch);
        _selection = new MeshInstance3D { Mesh = _ringMesh, MaterialOverride = _ringMat, Visible = false, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        AddChild(_selection);
    }
    public void Clear()
    {
        foreach (var v in _visuals.Values)
            v.Node.QueueFree();
        _visuals.Clear();
        _entities.Clear();
        _roadHash = 0;
        _infantryBatch.Clear();
        _vehicleBatch.Clear();
        if (_roads != null)
        {
            _roads.QueueFree();
            _roads = null;
        }
        _selection.Visible = false;
    }
    public JsonElement Entity(int id) => _entities.TryGetValue(id, out var e) ? e : default;
    public IEnumerable<JsonElement> Entities => _entities.Values;
    public void Select(int id)
    {
        var e = Entity(id);
        _selection.Visible = e.ValueKind == JsonValueKind.Object;
        if (!_selection.Visible)
            return;
        _selection.Position = new Vector3(e.F("x"), Terrain.GroundHeight(e.F("x"), e.F("z")) + .5f, e.F("z"));
        _selection.Scale = Vector3.One * (e.P("progress").ValueKind == JsonValueKind.Number ? 2 : 1);
    }
    public void Apply(JsonElement state)
    {
        _live.Clear();
        _entities.Clear();
        var mode = state.S("mode");
        foreach (var list in new[] { "buildings", "groundUnits", "units", "serviceVehicles", "ammoVehicles", "ships", "warships", "ammoCrates", "trenches" })
        {
            foreach (var e in state.P(list).Items())
            {
                if (e.B("demolished") || e.B("removed") || (e.F("hp", 1) <= 0 && list != "buildings" && !(list == "units" && e.S("status") == "falling")))
                    continue;
                if (list == "units" && e.F("delay") > 0)
                    continue;
                var id = e.I("id");
                if (id != 0)
                    _entities[id] = e;
                var token = list + ":" + id;
                _live.Add(token);
                var key = e.S("key", list == "ammoVehicles" ? "supply" : list == "serviceVehicles" ? "medictruck" : list);
                var side = e.I("side");
                var paint = side == 0 || mode == "coop" && side == 2 ? 0 : 1;
                if (!_visuals.TryGetValue(token, out var v))
                {
                    var model = list switch
                    {
                        "buildings" => ModelLibrary.BuildBuilding(key, paint),
                        "groundUnits" => new Node3D(),
                        "units" => ModelLibrary.BuildAircraft(key, paint),
                        "ships" or "warships" => ModelLibrary.BuildShip(key, paint),
                        "trenches" => Trench(),
                        "ammoCrates" => Crate(),
                        _ => new Node3D()
                    };
                    bool batchedInfantry = list == "groundUnits" && IsInfantry(key);
                    bool batchedVehicle = list is "serviceVehicles" or "ammoVehicles" || list == "groundUnits" && !batchedInfantry;
                    if (batchedInfantry)
                        _infantryBatch.Prepare(key, paint);
                    if (batchedVehicle)
                        _vehicleBatch.Prepare(key, paint);
                    v = new Visual { Node = model, Kind = list, Key = key, Side = side, Paint = paint, BatchedInfantry = batchedInfantry, BatchedVehicle = batchedVehicle, Phase = id * .71f, Yaw = paint == 0 ? Mathf.Pi / 2 : -Mathf.Pi / 2 };
                    AddChild(model);
                    _visuals[token] = v;
                    model.Position = PositionOf(e, list);
                    v.Target = model.Position;
                }
                var target = PositionOf(e, list);
                var move = target - v.Target;
                if (list != "buildings" && list != "trenches" && move.LengthSquared() > .03f)
                    v.Yaw = Mathf.Atan2(move.X, move.Z);
                else if (list == "buildings" || list == "trenches")
                    v.Yaw = e.F("rotation", e.F("yaw"));
                v.Target = target;
                v.Falling = list == "units" && e.S("status") == "falling";
                if (list == "buildings")
                {
                    var progress = e.F("progress", 1);
                    v.Node.Scale = new Vector3(1, Mathf.Clamp(progress, .05f, 1) * (e.F("hp", 1) <= 0 ? .2f : 1), 1);
                }
                v.Node.Visible = !e.B("carried") && e.P("carrierId").ValueKind is not JsonValueKind.Number;
            }
        }
        foreach (var key in _visuals.Keys.Where(k => !_live.Contains(k)).ToArray())
        {
            _visuals[key].Node.QueueFree();
            _visuals.Remove(key);
        }
        BuildRoads(state.P("roads"));
        Effects.Consume(state.P("events"), Terrain);
    }
    private Vector3 PositionOf(JsonElement e, string list)
    {
        var x = e.F("x");
        var z = e.F("z");
        var y = list == "units" ? e.F("y", 35) : list is "ships" or "warships" ? -.5f : Terrain.GroundHeight(x, z);
        return new Vector3(x, y, z);
    }
    // Explicit original INFANTRY_TYPES; IFV and armored cars must remain vehicles.
    public static bool IsInfantry(string key) => key is "infantry" or "atrifle" or "machinegunner" or "sniper" or "assault" or "engineer" or "operator" or "mog" or "atgm" or "medic";
    private static Node3D Crate()
    {
        var root = new Node3D();
        root.AddChild(new MeshInstance3D { Mesh = new BoxMesh { Size = new Vector3(4, 2, 3) }, Position = Vector3.Up, MaterialOverride = new StandardMaterial3D { AlbedoColor = new Color("69704b") } });
        return root;
    }
    private static Node3D Trench()
    {
        var root = new Node3D();
        var soil = new StandardMaterial3D { AlbedoColor = new Color("5f533c"), Roughness = 1 };
        var dark = new StandardMaterial3D { AlbedoColor = new Color("292c24") };
        root.AddChild(new MeshInstance3D { Mesh = new BoxMesh { Size = new Vector3(18, .12f, 4.4f) }, Position = new Vector3(0, .15f, 0), MaterialOverride = dark });
        for (var i = 0; i < 6; i++)
            foreach (var z in new[] { -3f, 3f })
                root.AddChild(new MeshInstance3D { Mesh = new BoxMesh { Size = new Vector3(3.3f, 1.1f, 2) }, Position = new Vector3(i * 3 - 7.5f, .45f, z), MaterialOverride = soil });
        return root;
    }
    private void BuildRoads(JsonElement roads)
    {
        long hash = 17;
        foreach (var r in roads.Items())
            hash = unchecked(hash * 31 + r.I("id") * 7 + (r.F("hp") > 0 ? 1 : 0) + (r.B("removed") ? 123 : 0));
        if (_roads != null && hash == _roadHash)
            return;
        _roadHash = hash;
        if (_roads != null)
            _roads.QueueFree();
        var mesh = new ImmediateMesh();
        mesh.SurfaceBegin(Mesh.PrimitiveType.Triangles);
        foreach (var r in roads.Items())
        {
            if (r.B("removed"))
                continue;
            var a = new Vector3(r.F("ax"), 0, r.F("az"));
            var b = new Vector3(r.F("bx"), 0, r.F("bz"));
            var across = new Vector3(-(b - a).Z, 0, (b - a).X).Normalized() * 5;
            var points = new[] { a - across, a + across, b + across, a - across, b + across, b - across };
            foreach (var p0 in points)
            {
                var p = p0;
                p.Y = Terrain.GroundHeight(p.X, p.Z) + .22f;
                mesh.SurfaceSetNormal(Vector3.Up);
                mesh.SurfaceAddVertex(p);
            }
        }
        mesh.SurfaceEnd();
        _roads = new MeshInstance3D { Mesh = mesh, MaterialOverride = new StandardMaterial3D { AlbedoColor = new Color("333a39"), Roughness = .93f, CullMode = BaseMaterial3D.CullModeEnum.Disabled }, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        AddChild(_roads);
    }
    public override void _Process(double delta)
    {
        var mix = 1 - Mathf.Exp(-14 * Mathf.Min((float)delta, .1f));
        if (!Paused)
            _animationTime += (float)delta;
        _infantryBatch.BeginFrame();
        _vehicleBatch.BeginFrame();
        foreach (var v in _visuals.Values)
        {
            var moving = Mathf.Clamp(v.Node.Position.DistanceTo(v.Target) / 2, 0, 1);
            v.Node.Position = v.Kind is "buildings" or "trenches" ? v.Target : v.Node.Position.Lerp(v.Target, mix);
            v.Node.Rotation = new Vector3(0, Mathf.LerpAngle(v.Node.Rotation.Y, v.Yaw, mix), 0);
            if (v.Falling)
                v.Node.Rotation = new Vector3(.65f, v.Node.Rotation.Y, _animationTime * 3 + v.Phase);
            if (v.BatchedInfantry && v.Node.Visible)
                _infantryBatch.Add(v.Key, v.Paint, v.Node.Transform, _animationTime + v.Phase, Paused ? 0 : moving, false);
            if (v.BatchedVehicle && v.Node.Visible)
                _vehicleBatch.Add(v.Key, v.Paint, v.Node.Transform);
        }
        _infantryBatch.EndFrame();
        _vehicleBatch.EndFrame();
    }
}

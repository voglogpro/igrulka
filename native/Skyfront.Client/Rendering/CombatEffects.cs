using Godot;
using System.Text.Json;
using Skyfront.Client.Runtime;

namespace Skyfront.Client.Rendering;

public partial class CombatEffects : Node3D
{
    private sealed class Fx
    {
        public MeshInstance3D Mesh = null!;
        public Vector3 From, To, Velocity;
        public float Age, Life, Size;
        public int Kind;
        public float Arc;
        public StandardMaterial3D Material = null!;
        public bool Active;
    }
    private readonly List<Fx> _pool = new();
    private readonly HashSet<int> _seen = new();
    private readonly Queue<int> _seenOrder = new();
    private readonly RandomNumberGenerator _random = new();
    private readonly SphereMesh _sphere = new() { Radius = 1, Height = 2, RadialSegments = 8, Rings = 4 };
    private readonly QuadMesh _smokeQuad = new() { Size = new Vector2(2, 2) };
    private StandardMaterial3D _flame = null!, _smoke = null!, _tracer = null!;
    public override void _Ready()
    {
        _flame = Material(new Color(1, .33f, .035f), true);
        _smoke = Material(new Color(.13f, .145f, .15f, .7f), false);
        _smoke.AlbedoTexture = GD.Load<Texture2D>("res://Assets/effects/smoke.png");
        _smoke.BillboardMode = BaseMaterial3D.BillboardModeEnum.Enabled;
        _smoke.CullMode = BaseMaterial3D.CullModeEnum.Disabled;
        _smoke.DepthDrawMode = BaseMaterial3D.DepthDrawModeEnum.Disabled;
        _tracer = Material(new Color(1, .79f, .35f), true);
        for (var i = 0; i < 220; i++)
        {
            var mesh = new MeshInstance3D { Mesh = _sphere, Visible = false, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
            AddChild(mesh);
            _pool.Add(new Fx { Mesh = mesh, Material = (StandardMaterial3D)_smoke.Duplicate() });
        }
    }
    private static StandardMaterial3D Material(Color color, bool emission) => new()
    {
        AlbedoColor = color,
        ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        EmissionEnabled = emission,
        Emission = color,
        EmissionEnergyMultiplier = emission ? 2 : 0,
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        NoDepthTest = false
    };
    public void Reset()
    {
        _seen.Clear();
        _seenOrder.Clear();
        foreach (var f in _pool)
        {
            f.Active = false;
            f.Mesh.Visible = false;
        }
    }
    private Fx? Take(int kind, Vector3 from, Vector3 to, float size, float life)
    {
        var f = _pool.FirstOrDefault(x => !x.Active);
        if (f == null)
            return null;
        f.Active = true;
        f.Age = 0;
        f.Life = life;
        f.From = from;
        f.To = to;
        f.Size = size;
        f.Kind = kind;
        f.Arc = 0;
        f.Velocity = new Vector3(_random.RandfRange(-3, 3), _random.RandfRange(4, 11), _random.RandfRange(-3, 3));
        var source = kind == 2 ? _tracer : kind == 1 ? _smoke : _flame;
        f.Material.AlbedoColor = source.AlbedoColor;
        f.Material.EmissionEnabled = source.EmissionEnabled;
        f.Material.Emission = source.Emission;
        f.Material.EmissionEnergyMultiplier = source.EmissionEnergyMultiplier;
        f.Material.AlbedoTexture = source.AlbedoTexture;
        f.Material.BillboardMode = source.BillboardMode;
        f.Material.CullMode = source.CullMode;
        f.Material.DepthDrawMode = source.DepthDrawMode;
        f.Mesh.Mesh = kind == 1 ? _smokeQuad : _sphere;
        f.Mesh.Rotation = Vector3.Zero;
        f.Mesh.MaterialOverride = f.Material;
        f.Mesh.Position = from;
        f.Mesh.Scale = Vector3.One * Mathf.Max(.05f, size);
        f.Mesh.Visible = true;
        return f;
    }
    public void Explosion(Vector3 position, float radius)
    {
        radius = Mathf.Clamp(radius, 2, 32);
        Take(0, position, position, radius * .55f, .5f);
        for (var i = 0; i < 6; i++)
            Take(1, position + Vector3.Up * 2, position, radius * .4f, 5 + i * .4f);
        for (var i = 0; i < 7; i++)
            Take(0, position, position, 1, .7f + i * .08f);
    }
    public void Trace(Vector3 from, Vector3 to) => Take(2, from, to, .22f, .2f);
    public void Consume(JsonElement events, TerrainView terrain)
    {
        foreach (var e in events.Items())
        {
            var id = e.I("id");
            if (id == 0 || !_seen.Add(id))
                continue;
            _seenOrder.Enqueue(id);
            if (_seenOrder.Count > 2048)
                _seen.Remove(_seenOrder.Dequeue());
            var type = e.S("type");
            var p = e.Point();
            p.Y = e.F("y", terrain.GroundHeight(p.X, p.Z) + 1);
            if (type is "impact" or "crash" or "destroy" or "groundDestroyed" or "oilfire")
                p.Y = Mathf.Max(p.Y, terrain.GroundHeight(p.X, p.Z) + 1);
            if (type is "impact" or "crash" or "destroy" or "groundDestroyed" or "oilfire" ||
                (type == "intercept" && e.S("mode") != "fall"))
                Explosion(p, e.F("radius", e.F("r", 8)));
            else if (type == "hit")
            {
                Take(0, p, p, e.S("surface") == "armor" ? 1.8f : .8f, .2f);
                if (e.S("surface") is "wall" or "ground")
                    Take(1, p, p, 1.5f, 1.1f);
            }
            else if (type == "launch")
            {
                if (e.S("key") is "drone" or "heavy")
                    continue;
                Take(0, p, p, 2, .25f);
                Take(1, p, p, 4, 2.8f);
            }
            else if (type is "shot" or "navalShot")
            {
                var a = new Vector3(e.F("mx", p.X), e.F("my", p.Y), e.F("mz", p.Z));
                var b = e.P("to").ValueKind == JsonValueKind.Object ? e.P("to").Point() : new Vector3(e.F("tx", p.X + 8), e.F("ty", p.Y + 4), e.F("tz", p.Z));
                bool heavy = type == "navalShot" || e.S("key") is "cannon" or "sam" || e.S("shooter") == "mlrs";
                var tracer = Take(2, a, b, heavy ? .34f : .13f, heavy ? .4f : .16f);
                if (tracer != null && e.S("shooter") is "howitzer" or "mlrs")
                {
                    tracer.Arc = Mathf.Min(35, a.DistanceTo(b) * .12f);
                    tracer.Life = .65f;
                }
                Take(0, a, a, heavy ? 1.7f : .65f, .1f);
            }
        }
    }
    public override void _Process(double delta)
    {
        var dt = Mathf.Min((float)delta, .1f);
        foreach (var f in _pool)
        {
            if (!f.Active)
                continue;
            f.Age += dt;
            if (f.Age >= f.Life)
            {
                f.Active = false;
                f.Mesh.Visible = false;
                continue;
            }
            var t = f.Age / f.Life;
            var color = f.Material.AlbedoColor;
            color.A = f.Kind == 1 ? .65f * (1 - t) * Mathf.Min(1, t * 8) : Mathf.Min(1, (1 - t) * 5);
            f.Material.AlbedoColor = color;
            if (f.Kind == 2)
            {
                var a = f.From.Lerp(f.To, t);
                float segment = Mathf.Min(.12f, 16 / Mathf.Max(1, f.From.DistanceTo(f.To)));
                float end = Mathf.Min(1, t + segment);
                var b = f.From.Lerp(f.To, end);
                a.Y += f.Arc * 4 * t * (1 - t);
                b.Y += f.Arc * 4 * end * (1 - end);
                f.Mesh.Position = (a + b) / 2;
                f.Mesh.Scale = new Vector3(f.Size, f.Size, Mathf.Max(.5f, a.DistanceTo(b) / 2));
                if (a.DistanceSquaredTo(b) > .001f)
                {
                    var direction = (b - a).Normalized();
                    f.Mesh.LookAt(b, Mathf.Abs(direction.Dot(Vector3.Up)) > .98f ? Vector3.Right : Vector3.Up);
                }
            }
            else
            {
                f.Mesh.Position = f.From + f.Velocity * f.Age;
                var s = f.Size * (f.Kind == 1 ? .5f + t * 2 : Mathf.Sin(t * Mathf.Pi));
                f.Mesh.Scale = Vector3.One * Mathf.Max(.05f, s);
                if (f.Kind == 0 && f.Size <= 1.1f)
                    f.Velocity.Y -= 12 * dt;
            }
        }
    }
}

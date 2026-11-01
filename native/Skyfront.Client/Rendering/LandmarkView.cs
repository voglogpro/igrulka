using Godot;
using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Skyfront.Client.Rendering;

/// <summary>Map landmarks only. Capture, ownership and materialized cities remain simulation-owned.</summary>
public partial class LandmarkView : Node3D
{
    public TerrainView Terrain { get; set; } = null!;
    private Node3D? _world;
    private sealed class Site
    {
        public required Node3D Root, Structures;
        public required Label3D Label;
        public required MeshInstance3D Banner;
        public string Name = "";
        public int Owner = -99;
    }
    private readonly Dictionary<string, Site> _depots = new(), _settlements = new();
    private static readonly BoxMesh Cube = new() { Size = Vector3.One };
    private static readonly StandardMaterial3D Neutral = Paint("8c9585"), Own = Paint("8ab9bd"), Enemy = Paint("c17b65"), Road = Paint("51564c"), Crate = Paint("79735a"), Pad = Paint("777b6a");
    private static StandardMaterial3D Paint(string hex) => new() { AlbedoColor = new Color(hex), Roughness = .95f };
    private static string S(JsonElement e, string k, string fallback = "") => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) ? v.ValueKind == JsonValueKind.String ? v.GetString() ?? fallback : v.ToString() : fallback;
    private static float N(JsonElement e, string k, float fallback = 0) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetSingle(out float n) ? n : fallback;
    private static JsonElement G(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) ? v : default;
    private static bool True(JsonElement e, string key) => G(e, key).ValueKind == JsonValueKind.True;
    private float Height(float x, float z) => Terrain?.GroundHeight(x, z) ?? 0;
    private static MeshInstance3D Box(Node3D parent, Vector3 pos, Vector3 scale, Material material)
    {
        var n = new MeshInstance3D { Mesh = Cube, Position = pos, Scale = scale, MaterialOverride = material };
        parent.AddChild(n);
        return n;
    }
    private static Label3D Label(Node3D parent, string text, float y)
    {
        var label = new Label3D { Text = text, Position = new(0, y, 0), FontSize = 30, PixelSize = .14f, Modulate = new Color("c4c9b9"), OutlineSize = 5, Billboard = BaseMaterial3D.BillboardModeEnum.Enabled, VisibilityRangeEnd = 850, VisibilityRangeEndMargin = 70 };
        parent.AddChild(label);
        return label;
    }
    private void Ring(Node3D parent, float x, float z, float radius, Color color)
    {
        var mesh = new ImmediateMesh();
        var material = new StandardMaterial3D { AlbedoColor = color, ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded, Roughness = 1 };
        mesh.SurfaceBegin(Mesh.PrimitiveType.Lines, material);
        const int count = 72;
        for (int i = 0; i < count; i++)
            for (int edge = 0; edge < 2; edge++)
            {
                float angle = Mathf.Tau * (i + edge) / count;
                float px = Mathf.Cos(angle) * radius, pz = Mathf.Sin(angle) * radius;
                mesh.SurfaceAddVertex(new(px, Height(x + px, z + pz) - Height(x, z) + .45f, pz));
            }
        mesh.SurfaceEnd();
        parent.AddChild(new MeshInstance3D { Mesh = mesh, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
    }
    private static void NeutralizeAccent(Node root)
    {
        if (root is MeshInstance3D mesh && mesh.MaterialOverride is StandardMaterial3D material && material.AlbedoColor.ToHtml(false) == "83b9c6")
            mesh.MaterialOverride = Neutral;
        foreach (var child in root.GetChildren())
            NeutralizeAccent(child);
    }
    public void ApplyWorld(JsonElement world)
    {
        if (_world != null)
        {
            RemoveChild(_world);
            _world.QueueFree();
        }
        _depots.Clear();
        _settlements.Clear();
        _world = new Node3D { Name = "StrategicLandmarks" };
        AddChild(_world);
        var definitions = G(world, "depots");
        if (definitions.ValueKind == JsonValueKind.Array)
            foreach (var def in definitions.EnumerateArray())
                CreateDepot(def);
        definitions = G(world, "settlements");
        if (definitions.ValueKind == JsonValueKind.Array)
            foreach (var def in definitions.EnumerateArray())
                CreateSettlement(def);
        definitions = G(world, "oilFields");
        if (definitions.ValueKind == JsonValueKind.Array)
            foreach (var def in definitions.EnumerateArray())
            {
                float x = N(def, "x"), z = N(def, "z");
                var root = new Node3D { Name = "OilField_" + S(def, "id"), Position = new(x, Height(x, z), z) };
                _world.AddChild(root);
                Ring(root, x, z, N(def, "r", 22), new Color("8d8053"));
                var label = Label(root, "НЕФТЬ", 3);
                label.Modulate = new Color("c5ad72");
                label.FontSize = 23;
                label.VisibilityRangeEnd = 650;
            }
    }
    private Site CreateSite(JsonElement def, string type)
    {
        string id = S(def, "id"), name = S(def, "name", id);
        float x = N(def, "x"), z = N(def, "z");
        var root = new Node3D { Name = type + "_" + id, Position = new(x, Height(x, z), z) };
        _world!.AddChild(root);
        var structures = new Node3D { Name = "NeutralStructures" };
        root.AddChild(structures);
        var banner = Box(root, new(0, .65f, 20), new(16, .3f, 2), Neutral);
        var label = Label(root, name, 37);
        return new Site { Root = root, Structures = structures, Banner = banner, Label = label, Name = name };
    }
    private void CreateDepot(JsonElement def)
    {
        var site = CreateSite(def, "Depot");
        _depots[S(def, "id")] = site;
        var model = ModelLibrary.BuildBuilding("warehouse", 0);
        NeutralizeAccent(model);
        site.Structures.AddChild(model);
        Box(site.Structures, new(0, .5f, 22), new(43, 1, 15), Pad);
        for (int row = 0; row < 2; row++)
            for (int i = 0; i < 3; i++)
                Box(site.Structures, new(14 + i * 3, 2 + row * 2.7f, 22), new(2.7f, 2.6f, 3.5f), Crate);
        Box(site.Structures, new(-13, 2, 22), new(8, 3, 7), Road);
        site.Banner.Position = new(0, 12, 15.6f);
        site.Banner.Scale = new(25, .7f, .15f);
        Ring(site.Root, site.Root.Position.X, site.Root.Position.Z, N(def, "radius", 64), new Color("798474"));
    }
    private void CreateSettlement(JsonElement def)
    {
        var site = CreateSite(def, "Settlement");
        _settlements[S(def, "id")] = site;
        site.Label.Position = new(0, 42, 0);
        float facing = -Mathf.Sign(site.Root.Position.Z);
        if (facing == 0)
            facing = 1;
        // Exact original settlementLayout offsets, rotations and approach stub.
        AddStructure(site, "housing", -42, 0, Mathf.Pi / 2);
        AddStructure(site, "industry", 42, 0, -Mathf.Pi / 2);
        if (N(def, "variant") != 0)
            AddStructure(site, "housing", 0, -58 * facing, facing > 0 ? 0 : Mathf.Pi);
        RoadSegment(site, 0, 78 * facing, 0, -35 * facing);
        RoadSegment(site, 0, 0, -26.5f, 0);
        RoadSegment(site, 0, 0, 25, 0);
        if (N(def, "variant") != 0)
            RoadSegment(site, 0, -35 * facing, 0, -42.5f * facing);
    }
    private void AddStructure(Site site, string key, float x, float z, float rotation)
    {
        var model = ModelLibrary.BuildBuilding(key, 0);
        NeutralizeAccent(model);
        model.Position = new(x, Height(site.Root.Position.X + x, site.Root.Position.Z + z) - site.Root.Position.Y, z);
        model.Rotation = new(0, rotation, 0);
        site.Structures.AddChild(model);
    }
    private void RoadSegment(Site site, float ax, float az, float bx, float bz)
    {
        float dx = bx - ax, dz = bz - az, x = (ax + bx) / 2, z = (az + bz) / 2;
        var road = Box(site.Structures, new(x, Height(site.Root.Position.X + x, site.Root.Position.Z + z) - site.Root.Position.Y + .16f, z), new(7, .3f, Mathf.Sqrt(dx * dx + dz * dz)), Road);
        road.Rotation = new(0, Mathf.Atan2(dx, dz), 0);
    }
    public void UpdateState(JsonElement state)
    {
        bool coop = S(state, "mode") == "coop";
        UpdateSites(G(state, "districts"), _depots, false, coop);
        UpdateSites(G(state, "settlements"), _settlements, true, coop);
    }
    private static void UpdateSites(JsonElement values, Dictionary<string, Site> sites, bool settlements, bool coop)
    {
        if (values.ValueKind != JsonValueKind.Array)
            return;
        foreach (var value in values.EnumerateArray())
            if (sites.TryGetValue(S(value, "id"), out var site))
            {
                int owner = G(value, "owner").ValueKind == JsonValueKind.Number ? (int)N(value, "owner") : -1;
                var paint = owner < 0 ? Neutral : owner == 0 || (coop && owner == 2) ? Own : Enemy;
                if (site.Owner != owner)
                {
                    site.Owner = owner;
                    site.Banner.MaterialOverride = paint;
                    site.Label.Modulate = paint.AlbedoColor;
                }
                if (settlements)
                    site.Structures.Visible = !True(value, "materialized");
                float control = Mathf.Abs(N(value, "control"));
                string capture = control > 0 && control < .999f ? $" · {Mathf.RoundToInt(control * 100)}%" : "";
                string contested = True(value, "contested") ? " · БОЙ" : "";
                float hp = N(value, "hp", 360);
                string damage = !settlements && hp < 359 ? $" · {Mathf.RoundToInt(hp)} HP" : "";
                site.Label.Text = site.Name + capture + contested + damage;
            }
    }
}

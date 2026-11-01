using Godot;
using System.Text.Json;
using Skyfront.Client.Runtime;

namespace Skyfront.Client.Parity;

/// <summary>
/// Native art override for the explicitly bound source ground only. Geometry,
/// transforms, collision/picking and the authoritative state are never changed.
/// One material and six shared 1K textures cover the complete original ground.
/// </summary>
public sealed class TerrainPresentation
{
    private readonly Dictionary<GeometryInstance3D, Material?> _originals = new();
    private ShaderMaterial? _groundMaterial, _excavationMaterial;
    private float _wetness;
    public bool Enabled { get; } = !OS.GetCmdlineUserArgs().Contains("--baseline-graphics");

    public void Apply(JsonElement frame, IEnumerable<GeometryInstance3D> terrainParts)
    {
        if (!Enabled) return;
        var weather = frame.P("visualBindings").P("weather");
        if (weather.ValueKind == JsonValueKind.Object)
        {
            var kind = weather.S("kind", "clear");
            var amount = Mathf.Clamp(weather.F("amount"), 0, 1);
            SetWetness(kind is "rain" or "storm" ? amount : 0);
        }
        foreach (var part in terrainParts)
        {
            if (!GodotObject.IsInstanceValid(part)) continue;
            var material = GroundMaterial();
            // ApplyObject can replace its original material after a resource delta.
            // Remember that new original, rather than restoring a stale variant.
            if (part.MaterialOverride != material)
                _originals[part] = part.MaterialOverride;
            part.MaterialOverride = material;
        }
        foreach (var part in _originals.Keys.Where(part => !GodotObject.IsInstanceValid(part)).ToArray())
            _originals.Remove(part);
    }

    public Material CreateExcavationMaterial()
    {
        if (_excavationMaterial != null) return _excavationMaterial;
        _excavationMaterial = (ShaderMaterial)GroundMaterial().Duplicate();
        _excavationMaterial.SetShaderParameter("trench_mask_enabled", false);
        _excavationMaterial.SetShaderParameter("use_mesh_uv", true);
        _excavationMaterial.SetShaderParameter("earth_tint", new Vector3(.74f, .78f, .78f));
        return _excavationMaterial;
    }

    public void SetTrenchMask(Texture2D index, Texture2D mask, Vector2 atlasSize,
        float tileWorld = 32, int tilePixels = 128, Vector2? indexOffset = null)
    {
        if (!Enabled) return;
        if (atlasSize.X <= 0 || atlasSize.Y <= 0 || tileWorld <= 0 || tilePixels <= 0)
            throw new ArgumentOutOfRangeException(nameof(atlasSize), "Invalid visual trench atlas dimensions");
        var material = GroundMaterial();
        material.SetShaderParameter("trench_index", index);
        material.SetShaderParameter("trench_mask", mask);
        material.SetShaderParameter("trench_atlas_size", atlasSize);
        material.SetShaderParameter("trench_tile_world", tileWorld);
        material.SetShaderParameter("trench_tile_pixels", (float)tilePixels);
        material.SetShaderParameter("trench_index_offset", indexOffset ?? new Vector2(256, 256));
        material.SetShaderParameter("trench_mask_enabled", true);
    }

    public void ClearTrenchMask()
    {
        _groundMaterial?.SetShaderParameter("trench_mask_enabled", false);
    }

    public void Reset()
    {
        foreach (var (part, original) in _originals)
            if (GodotObject.IsInstanceValid(part)) part.MaterialOverride = original;
        _originals.Clear();
        ClearTrenchMask();
        SetWetness(0);
    }

    private void SetWetness(float value)
    {
        if (Mathf.IsEqualApprox(_wetness, value)) return;
        _wetness = value;
        _groundMaterial?.SetShaderParameter("wetness", value);
        _excavationMaterial?.SetShaderParameter("wetness", value);
    }

    private ShaderMaterial GroundMaterial()
    {
        if (_groundMaterial != null) return _groundMaterial;
        var material = new ShaderMaterial { Shader = GD.Load<Shader>("res://Parity/terrain-pbr.gdshader") };
        foreach (var (parameter, file) in new[]
        {
            ("mud_albedo", "brown_mud_diff_1k.jpg"), ("mud_normal", "brown_mud_nor_gl_1k.jpg"),
            ("mud_arm", "brown_mud_arm_1k.jpg"), ("dirt_albedo", "dirt_diff_1k.jpg"),
            ("dirt_normal", "dirt_nor_gl_1k.jpg"), ("dirt_arm", "dirt_arm_1k.jpg")
        })
            material.SetShaderParameter(parameter, GD.Load<Texture2D>("res://Assets/terrain/" + file));
        material.SetShaderParameter("wetness", _wetness);
        _groundMaterial = material;
        return material;
    }
}

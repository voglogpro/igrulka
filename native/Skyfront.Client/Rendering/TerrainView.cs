using Godot;
using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Skyfront.Client.Rendering;

/// <summary>Visual heightfield only. Gameplay heights remain owned by the simulation.</summary>
public partial class TerrainView : Node3D
{
    private int _cols, _rows;
    private float _step = 24, _originX, _originZ, _waterLevel;
    private float[] _heights = Array.Empty<float>();
    private bool[] _wet = Array.Empty<bool>();
    private Node3D? _world;
    private const int ChunkCells = 32;
    private ImageTexture? _groundNoise;

    public void ApplyWorld(JsonElement world)
    {
        if (_world != null)
        {
            RemoveChild(_world);
            _world.QueueFree();
        }
        _world = new Node3D { Name = "WorldGeometry" };
        AddChild(_world);
        _waterLevel = Number(world, "waterLevel", 0);
        float width = 4800, depth = 4000;
        if (world.TryGetProperty("field", out var field))
        {
            width = Number(field, "x", width);
            depth = Number(field, "z", depth);
        }
        if (world.TryGetProperty("map", out var map))
        {
            width = Number(map, "width", width);
            depth = Number(map, "depth", depth);
        }
        _cols = _rows = 0;
        _heights = Array.Empty<float>();
        _wet = Array.Empty<bool>();
        if (world.TryGetProperty("terrain", out var terrain) || world.TryGetProperty("heightGrid", out terrain))
        {
            _cols = (int)Number(terrain, "cols", Number(terrain, "columns", 0));
            _rows = (int)Number(terrain, "rows", 0);
            _step = Math.Max(0.01f, Number(terrain, "step", 24));
            _originX = Number(terrain, "originX", -width / 2);
            _originZ = Number(terrain, "originZ", -depth / 2);
            if (_cols >= 2 && _rows >= 2 && (long)_cols * _rows <= 2_000_000 &&
                (terrain.TryGetProperty("heights", out var heights) || terrain.TryGetProperty("values", out heights)) && heights.ValueKind == JsonValueKind.Array &&
                heights.GetArrayLength() == _cols * _rows)
            {
                _heights = new float[_cols * _rows];
                int index = 0;
                foreach (var height in heights.EnumerateArray())
                    _heights[index++] = height.TryGetSingle(out var value) && float.IsFinite(value) ? value : _waterLevel - 10;
                _wet = new bool[_heights.Length];
                if (terrain.TryGetProperty("water", out var water) && water.ValueKind == JsonValueKind.Array && water.GetArrayLength() == _wet.Length)
                {
                    index = 0;
                    foreach (var sample in water.EnumerateArray())
                        _wet[index++] = sample.ValueKind == JsonValueKind.True || (sample.ValueKind == JsonValueKind.Number && sample.GetInt32() != 0);
                }
                else
                    for (int i = 0; i < _wet.Length; i++)
                        _wet[i] = _heights[i] < _waterLevel;
            }
        }
        if (_heights.Length > 0)
            BuildTerrain();
        BuildWater(width, depth);
        if (world.TryGetProperty("trees", out var trees) && trees.ValueKind == JsonValueKind.Array)
            BuildTrees(trees);
    }

    public float GroundHeight(float x, float z)
    {
        if (_heights.Length == 0)
            return _waterLevel;
        float gx = Mathf.Clamp((x - _originX) / _step, 0, _cols - 1);
        float gz = Mathf.Clamp((z - _originZ) / _step, 0, _rows - 1);
        int ix = Math.Min((int)gx, _cols - 2), iz = Math.Min((int)gz, _rows - 2);
        return Mathf.Lerp(Mathf.Lerp(Height(ix, iz), Height(ix + 1, iz), gx - ix),
            Mathf.Lerp(Height(ix, iz + 1), Height(ix + 1, iz + 1), gx - ix), gz - iz);
    }

    private float Height(int x, int z) => _heights[Math.Clamp(z, 0, _rows - 1) * _cols + Math.Clamp(x, 0, _cols - 1)];

    private void BuildTerrain()
    {
        var material = new ShaderMaterial { Shader = GD.Load<Shader>("res://Shaders/terrain.gdshader") };
        _groundNoise ??= CreateGroundNoise();
        material.SetShaderParameter("ground_noise_map", _groundNoise);
        for (int startZ = 0; startZ < _rows - 1; startZ += ChunkCells)
            for (int startX = 0; startX < _cols - 1; startX += ChunkCells)
            {
                int cellsX = Math.Min(ChunkCells, _cols - 1 - startX);
                int cellsZ = Math.Min(ChunkCells, _rows - 1 - startZ);
                int stride = cellsX + 1;
                var vertices = new Vector3[stride * (cellsZ + 1)];
                var normals = new Vector3[vertices.Length];
                var colors = new Color[vertices.Length];
                var indices = new int[cellsX * cellsZ * 6];
                for (int z = 0; z <= cellsZ; z++)
                    for (int x = 0; x <= cellsX; x++)
                    {
                        int gx = startX + x, gz = startZ + z, i = z * stride + x;
                        float h = Height(gx, gz);
                        vertices[i] = new Vector3(_originX + gx * _step, h, _originZ + gz * _step);
                        normals[i] = new Vector3(Height(gx - 1, gz) - Height(gx + 1, gz), 2 * _step,
                            Height(gx, gz - 1) - Height(gx, gz + 1)).Normalized();
                        float variation = MathF.Sin(gx * 0.47f + gz * 0.19f) * MathF.Cos(gz * 0.37f) * 0.013f;
                        bool shore = NearWater(gx, gz) && h < _waterLevel + 5;
                        Color baseColor = _wet[gz * _cols + gx] ? new Color(0.19f, 0.23f, 0.17f) :
                            shore ? new Color(0.37f, 0.34f, 0.23f) :
                            normals[i].Y < 0.8f ? new Color(0.29f, 0.30f, 0.25f) : new Color(0.20f, 0.285f, 0.135f);
                        colors[i] = new Color(baseColor.R + variation, baseColor.G + variation, baseColor.B + variation);
                    }
                int next = 0;
                for (int z = 0; z < cellsZ; z++)
                    for (int x = 0; x < cellsX; x++)
                    {
                        int a = z * stride + x, b = a + 1, c = a + stride, d = c + 1;
                        // Godot front faces use clockwise winding.
                        indices[next++] = a;
                        indices[next++] = b;
                        indices[next++] = c;
                        indices[next++] = b;
                        indices[next++] = d;
                        indices[next++] = c;
                    }
                var arrays = new Godot.Collections.Array();
                arrays.Resize((int)Mesh.ArrayType.Max);
                arrays[(int)Mesh.ArrayType.Vertex] = vertices;
                arrays[(int)Mesh.ArrayType.Normal] = normals;
                arrays[(int)Mesh.ArrayType.Color] = colors;
                arrays[(int)Mesh.ArrayType.Index] = indices;
                var mesh = new ArrayMesh();
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
                _world!.AddChild(new MeshInstance3D { Mesh = mesh, MaterialOverride = material, Name = $"Terrain_{startX}_{startZ}" });
            }
    }

    private bool NearWater(int x, int z)
    {
        for (int dz = -1; dz <= 1; dz++)
            for (int dx = -1; dx <= 1; dx++)
                if (_wet[Math.Clamp(z + dz, 0, _rows - 1) * _cols + Math.Clamp(x + dx, 0, _cols - 1)])
                    return true;
        return false;
    }

    private static ImageTexture CreateGroundNoise()
    {
        // Periodic value noise and its finite differences are baked once, never per frame.
        // R = scalar noise; G/B = signed small-step slopes packed into [0,1].
        const int size = 128;
        const float cells = 32;
        var pixels = new byte[size * size * 3];
        for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float px = (float)x / size * cells, pz = (float)y / size * cells;
                float value = PeriodicNoise(px, pz);
                float dx = PeriodicNoise(px + .1705f, pz) - value;
                float dz = PeriodicNoise(px, pz + .1705f) - value;
                int offset = (y * size + x) * 3;
                pixels[offset] = Pack(value);
                pixels[offset + 1] = Pack(dx * .5f + .5f);
                pixels[offset + 2] = Pack(dz * .5f + .5f);
            }
        var image = Image.CreateFromData(size, size, false, Image.Format.Rgb8, pixels);
        image.GenerateMipmaps();
        return ImageTexture.CreateFromImage(image);
    }

    private static byte Pack(float value) => (byte)Math.Clamp((int)MathF.Round(value * 255), 0, 255);

    private static float PeriodicNoise(float x, float z)
    {
        int ix = (int)MathF.Floor(x), iz = (int)MathF.Floor(z);
        float fx = x - ix, fz = z - iz;
        fx = fx * fx * (3 - 2 * fx);
        fz = fz * fz * (3 - 2 * fz);
        return Mathf.Lerp(Mathf.Lerp(NoiseHash(ix, iz), NoiseHash(ix + 1, iz), fx),
            Mathf.Lerp(NoiseHash(ix, iz + 1), NoiseHash(ix + 1, iz + 1), fx), fz);
    }

    private static float NoiseHash(int x, int z)
    {
        unchecked
        {
            uint hash = (uint)(x & 31) * 374761393u + (uint)(z & 31) * 668265263u + 81671u;
            hash = (hash ^ (hash >> 13)) * 1274126177u;
            return ((hash ^ (hash >> 16)) & 0x00ffffffu) / 16777215f;
        }
    }

    private void BuildWater(float width, float depth)
    {
        var shader = GD.Load<Shader>("res://Shaders/water.gdshader");
        var material = new ShaderMaterial { Shader = shader };
        material.SetShaderParameter("water_level", _waterLevel);
        if (_heights.Length > 0)
        {
            // A small float texture supplies exact simulation coastal heights, independent of screen depth.
            byte[] pixels = new byte[_heights.Length * sizeof(float)];
            Buffer.BlockCopy(_heights, 0, pixels, 0, pixels.Length);
            var image = Image.CreateFromData(_cols, _rows, false, Image.Format.Rf, pixels);
            material.SetShaderParameter("height_map", ImageTexture.CreateFromImage(image));
            material.SetShaderParameter("terrain_origin", new Vector2(_originX, _originZ));
            material.SetShaderParameter("terrain_size", new Vector2((_cols - 1) * _step, (_rows - 1) * _step));
            material.SetShaderParameter("has_height_map", true);
        }
        _world!.AddChild(new MeshInstance3D
        {
            Name = "Sea",
            Mesh = new PlaneMesh { Size = new Vector2(width, depth) },
            Position = new Vector3(0, _waterLevel, 0),
            MaterialOverride = material,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off
        });
    }

    private void BuildTrees(JsonElement trees)
    {
        var groups = new Dictionary<Vector2I, List<Transform3D>>();
        int accepted = 0;
        foreach (var tree in trees.EnumerateArray())
        {
            float x = Number(tree, "x", 0), z = Number(tree, "z", 0);
            if (_heights.Length == 0 || x < _originX || z < _originZ ||
                x > _originX + (_cols - 1) * _step || z > _originZ + (_rows - 1) * _step)
                continue;
            float height = GroundHeight(x, z);
            if (height < _waterLevel + 1)
                continue;
            if (accepted++ >= 4000)
                break;
            float scale = Mathf.Clamp(Number(tree, "scale", 1), 0.25f, 4);
            var key = new Vector2I(Mathf.FloorToInt(x / 384), Mathf.FloorToInt(z / 384));
            if (!groups.TryGetValue(key, out var list))
                groups[key] = list = new List<Transform3D>();
            float rotation = MathF.Sin(x * 3.1f + z * 1.7f) * Mathf.Pi;
            list.Add(new Transform3D(new Basis(Vector3.Up, rotation).Scaled(Vector3.One * scale), new Vector3(x, height, z)));
        }
        var bark = new StandardMaterial3D { AlbedoColor = new Color(0.24f, 0.20f, 0.14f), Roughness = 1 };
        var foliage = new StandardMaterial3D { AlbedoColor = new Color(0.17f, 0.25f, 0.13f), Roughness = 1 };
        var trunk = new CylinderMesh { TopRadius = 0.8f, BottomRadius = 1.3f, Height = 11, RadialSegments = 5, Material = bark };
        var crown = new CylinderMesh { TopRadius = 0, BottomRadius = 7, Height = 18, RadialSegments = 7, Material = foliage };
        foreach (var group in groups)
        {
            AddTreeBatch(group.Value, trunk, 5.5f, "Trunks");
            AddTreeBatch(group.Value, crown, 16, "Crowns");
        }
    }

    private void AddTreeBatch(List<Transform3D> transforms, Mesh mesh, float offset, string name)
    {
        var batch = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = mesh, InstanceCount = transforms.Count };
        Vector3 sectorOrigin = Vector3.Zero;
        foreach (var transform in transforms)
            sectorOrigin += transform.Origin;
        sectorOrigin /= transforms.Count;
        for (int i = 0; i < transforms.Count; i++)
        {
            var transform = transforms[i];
            transform.Origin += transform.Basis * new Vector3(0, offset, 0) - sectorOrigin;
            batch.SetInstanceTransform(i, transform);
        }
        _world!.AddChild(new MultiMeshInstance3D { Name = name, Position = sectorOrigin, Multimesh = batch, VisibilityRangeEnd = 2800, VisibilityRangeEndMargin = 150 });
    }

    private static float Number(JsonElement element, string name, float fallback) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) &&
        value.TryGetSingle(out var number) && float.IsFinite(number) ? number : fallback;
}

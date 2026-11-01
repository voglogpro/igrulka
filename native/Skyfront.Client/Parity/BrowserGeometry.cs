using Godot;
using System.Text.Json;
using Skyfront.Client.Runtime;

namespace Skyfront.Client.Parity;

internal sealed class BrowserAttribute
{
    public string Identity = "";
    public int ItemSize, Count, Version;
    public bool Instanced;
    public float[] Values = Array.Empty<float>();
    public static BrowserAttribute Read(JsonElement value)
    {
        var bytes = Convert.FromBase64String(value.S("data"));
        var result = new BrowserAttribute { Identity = value.S("identity"), ItemSize = value.I("itemSize", 1), Count = value.I("count"), Version = value.I("version"), Instanced = value.B("instanced") };
        var type = value.S("type", "f32");
        var width = type is "u8" or "i8" ? 1 : type is "u16" or "i16" ? 2 : type == "f64" ? 8 : 4;
        if (bytes.Length % width != 0)
            throw new InvalidDataException("Misaligned geometry attribute");
        result.Values = new float[bytes.Length / width];
        var normalized = value.B("normalized");
        if (type == "f32")
            Buffer.BlockCopy(bytes, 0, result.Values, 0, bytes.Length);
        else
        for (var i = 0; i < result.Values.Length; i++)
            result.Values[i] = type switch
            {
                "u8" => normalized ? bytes[i] / 255f : bytes[i],
                "i8" => normalized ? Math.Max(-1, (sbyte)bytes[i] / 127f) : (sbyte)bytes[i],
                "u16" => normalized ? BitConverter.ToUInt16(bytes, i * 2) / 65535f : BitConverter.ToUInt16(bytes, i * 2),
                "i16" => normalized ? Math.Max(-1, BitConverter.ToInt16(bytes, i * 2) / 32767f) : BitConverter.ToInt16(bytes, i * 2),
                "u32" => BitConverter.ToUInt32(bytes, i * 4),
                "i32" => BitConverter.ToInt32(bytes, i * 4),
                "f64" => (float)BitConverter.ToDouble(bytes, i * 8),
                _ => throw new InvalidDataException("Unknown geometry attribute: " + type)
            };
        if (result.ItemSize <= 0 || result.Count < 0 || (long)result.Count * result.ItemSize > result.Values.Length)
            throw new InvalidDataException("Invalid attribute size");
        return result;
    }
    public float At(int index, int component = 0, float fallback = 0) => index >= 0 && index * ItemSize + component < Values.Length ? Values[index * ItemSize + component] : fallback;
    public bool Matches(JsonElement value) => value.ValueKind == JsonValueKind.Object && Identity == value.S("identity") && Version == value.I("version") && Count == value.I("count");
}

internal sealed class BrowserGeometry
{
    public readonly Dictionary<string, BrowserAttribute> Attributes = new();
    public readonly List<(int Start, int Count, int Material)> Groups = new();
    private readonly Dictionary<(string, int, int, bool, bool), ArrayMesh> _meshes = new();
    public int Revision;
    private int[]? _index;
    private int _indexVersion = int.MinValue, _indexCount = -1;
    private string _indexIdentity = "";
    public void Update(JsonElement value)
    {
        var meshChanged = false;
        foreach (var property in value.P("attributes").ValueKind == JsonValueKind.Object ? value.P("attributes").EnumerateObject() : Enumerable.Empty<JsonProperty>())
        {
            if (Attributes.TryGetValue(property.Name, out var previous) && previous.Matches(property.Value))
                continue;
            var attribute = BrowserAttribute.Read(property.Value);
            Attributes[property.Name] = attribute;
            if (!attribute.Instanced)
                meshChanged = true;
        }
        if (value.TryGetProperty("index", out var rawIndex))
        {
            if (rawIndex.ValueKind == JsonValueKind.Null)
            {
                if (_index != null)
                {
                    _index = null;
                    _indexVersion = int.MinValue;
                    _indexCount = -1;
                    _indexIdentity = "";
                    meshChanged = true;
                }
            }
            else if (_indexIdentity != rawIndex.S("identity") || _indexVersion != rawIndex.I("version") || _indexCount != rawIndex.I("count"))
            {
                var bytes = Convert.FromBase64String(rawIndex.S("data"));
                var indexType = rawIndex.S("type");
                var width = indexType switch { "u8" => 1, "u16" => 2, "u32" => 4, _ => throw new InvalidDataException("Invalid index component type: " + indexType) };
                if (bytes.Length % width != 0) throw new InvalidDataException("Misaligned geometry index");
                _index = new int[bytes.Length / width];
                for (var i = 0; i < _index.Length; i++)
                    _index[i] = width switch { 1 => bytes[i], 2 => BitConverter.ToUInt16(bytes, i * 2), _ => checked((int)BitConverter.ToUInt32(bytes, i * 4)) };
                _indexVersion = rawIndex.I("version");
                _indexCount = rawIndex.I("count");
                _indexIdentity = rawIndex.S("identity");
                meshChanged = true;
            }
        }
        if (value.TryGetProperty("groups", out var groups))
        {
            var next = groups.Items().Select(group => (group.I("start"), group.I("count"), group.I("materialIndex"))).ToArray();
            if (!Groups.SequenceEqual(next))
            {
                Groups.Clear();
                Groups.AddRange(next);
                meshChanged = true;
            }
        }
        if (meshChanged)
        {
            _meshes.Clear();
            Revision++;
        }
    }
    public BrowserAttribute? Attribute(string name) => Attributes.GetValueOrDefault(name);
    public int ElementCount => _index?.Length ?? Attribute("position")?.Count ?? 0;
    public ArrayMesh Mesh(string primitive, int start, int count, bool weather, bool vertexColors)
    {
        count = Math.Clamp(count, 0, Math.Max(0, ElementCount - start));
        var key = (primitive, start, count, weather, vertexColors);
        if (_meshes.TryGetValue(key, out var cached))
            return cached;
        var position = Attribute("position") ?? throw new InvalidDataException("Geometry has no positions");
        var vertices = new Vector3[position.Count];
        for (var i = 0; i < vertices.Length; i++)
            vertices[i] = new Vector3(position.At(i), position.At(i, 1), position.At(i, 2));
        var arrays = new Godot.Collections.Array();
        arrays.Resize((int)Godot.Mesh.ArrayType.Max);
        arrays[(int)Godot.Mesh.ArrayType.Vertex] = vertices;
        var normals = Attribute("normal");
        if (normals != null && normals.Count == vertices.Length)
        {
            var data = new Vector3[vertices.Length];
            for (var i = 0; i < data.Length; i++)
                data[i] = new Vector3(normals.At(i), normals.At(i, 1), normals.At(i, 2));
            arrays[(int)Godot.Mesh.ArrayType.Normal] = data;
        }
        var tangent = Attribute("tangent");
        if (tangent != null && tangent.Count == vertices.Length && tangent.ItemSize == 4)
            arrays[(int)Godot.Mesh.ArrayType.Tangent] = tangent.Values;
        var uv = Attribute("uv");
        if (uv != null && uv.Count == vertices.Length)
        {
            var data = new Vector2[vertices.Length];
            for (var i = 0; i < data.Length; i++)
                data[i] = new Vector2(uv.At(i), uv.At(i, 1));
            arrays[(int)Godot.Mesh.ArrayType.TexUV] = data;
        }
        var color = Attribute("color");
        if (vertexColors && color != null && !color.Instanced && color.Count == vertices.Length)
        {
            var data = new Color[vertices.Length];
            for (var i = 0; i < data.Length; i++)
                data[i] = new Color(color.At(i), color.At(i, 1), color.At(i, 2), color.ItemSize > 3 ? color.At(i, 3) : 1);
            arrays[(int)Godot.Mesh.ArrayType.Color] = data;
        }
        if (weather && Attribute("aSeed") is BrowserAttribute seeds)
        {
            var density = Attribute("aDensity");
            var ends = Attribute("aEnd");
            var colors = new Color[vertices.Length];
            var coords = new Vector2[vertices.Length];
            for (var i = 0; i < vertices.Length; i++)
            {
                colors[i] = new Color(seeds.At(i), seeds.At(i, 1), seeds.At(i, 2), density?.At(i) ?? 0);
                coords[i] = new Vector2(ends?.At(i) ?? 0, 0);
            }
            arrays[(int)Godot.Mesh.ArrayType.Color] = colors;
            arrays[(int)Godot.Mesh.ArrayType.TexUV] = coords;
        }
        var indices = new int[count];
        for (var i = 0; i < count; i++)
            indices[i] = _index == null ? start + i : _index[start + i];
        var mode = primitive switch
        {
            "line" => Godot.Mesh.PrimitiveType.LineStrip,
            "segments" => Godot.Mesh.PrimitiveType.Lines,
            "points" => Godot.Mesh.PrimitiveType.Points,
            _ => Godot.Mesh.PrimitiveType.Triangles
        };
        if (mode == Godot.Mesh.PrimitiveType.Triangles)
            for (var i = 0; i + 2 < indices.Length; i += 3)
                (indices[i + 1], indices[i + 2]) = (indices[i + 2], indices[i + 1]);
        arrays[(int)Godot.Mesh.ArrayType.Index] = indices;
        var mesh = new ArrayMesh();
        if (vertices.Length > 0 && count > 0)
            mesh.AddSurfaceFromArrays(mode, arrays);
        _meshes[key] = mesh;
        return mesh;
    }
}

internal static class BrowserValues
{
    public static string Id(JsonElement value) => value.ValueKind == JsonValueKind.String ? value.GetString()! : value.ToString();
    public static float[] Floats(JsonElement value) => value.Items().Select(x => x.ValueKind == JsonValueKind.Number && x.TryGetSingle(out var f) ? f : 0).ToArray();
    public static Transform3D Transform(JsonElement value) => Transform(Floats(value));
    public static Transform3D Transform(float[] m, int offset = 0) => m.Length < offset + 16 ? Transform3D.Identity : new Transform3D(new Basis(new Vector3(m[offset], m[offset + 1], m[offset + 2]), new Vector3(m[offset + 4], m[offset + 5], m[offset + 6]), new Vector3(m[offset + 8], m[offset + 9], m[offset + 10])), new Vector3(m[offset + 12], m[offset + 13], m[offset + 14]));
    public static Color Color(JsonElement value, Color fallback)
    {
        var a = Floats(value);
        return a.Length >= 3 ? new Color(a[0], a[1], a[2], a.Length > 3 ? a[3] : 1) : fallback;
    }
    public static Vector3 Vector(JsonElement value, Vector3 fallback)
    {
        var a = Floats(value);
        return a.Length >= 3 ? new Vector3(a[0], a[1], a[2]) : fallback;
    }
}

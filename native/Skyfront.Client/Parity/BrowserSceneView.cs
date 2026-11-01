using Godot;
using System.Text.Json;
using Skyfront.Client.Runtime;

namespace Skyfront.Client.Parity;

/// <summary>
/// Renders the original browser CPU scene graph. This class has no gameplay rules,
/// substitute models, orders, menus or independent simulation clock.
/// </summary>
public partial class BrowserSceneView : Node3D
{
    private sealed class SceneObject
    {
        public Node3D Root = null!;
        public string Signature = "", Geometry = "", Type = "";
        public readonly List<GeometryInstance3D> Parts = new();
        public BrowserAttribute? Matrices, Colors;
        public BrowserAttribute? UploadedAlpha, UploadedTint;
        public int UploadedCount = -1;
        public float[] InstanceBuffer = Array.Empty<float>();
        public JsonElement Descriptor;
        public BrowserInstanceSectors? Sectors;
    }
    private readonly Dictionary<string, BrowserGeometry> _geometries = new();
    private readonly Dictionary<string, BrowserMaterial> _materials = new();
    private readonly Dictionary<string, BrowserTexture> _textures = new();
    private readonly Dictionary<string, SceneObject> _objects = new();
    private readonly Dictionary<string, Light3D> _lights = new();
    private readonly HashSet<string> _visible = new();
    private readonly HashSet<string> _dirtyGeometries = new(), _dirtyMaterials = new();
    private WorldEnvironment _worldEnvironment = null!;
    private Node3D _scene = null!;
    private int _frames;
    private long _lastSequence;
    private readonly TerrainPresentation _terrain = new();
    private TrenchPresentation _trenches = null!;
    private string _terrainId = "";
    private int _trenchMaskRevision = -1;
    private string[] _sourceTrenchIds = Array.Empty<string>();
    public Camera3D Camera { get; private set; } = null!;

    public override void _Ready()
    {
        _scene = new Node3D { Name = "OriginalBrowserScene" };
        AddChild(_scene);
        Camera = new Camera3D { Name = "OriginalBrowserCamera", Current = true, Near = 2, Far = 9000, Fov = 45 };
        AddChild(Camera);
        _worldEnvironment = new WorldEnvironment { Environment = new Godot.Environment { BackgroundMode = Godot.Environment.BGMode.Color, BackgroundColor = new Color("253749"), AmbientLightSource = Godot.Environment.AmbientSource.Color, AmbientLightColor = new Color("9eaed3"), AmbientLightEnergy = .6f, ReflectedLightSource = Godot.Environment.ReflectionSource.Disabled, TonemapMode = Godot.Environment.ToneMapper.Aces } };
        AddChild(_worldEnvironment);
        _trenches = new TrenchPresentation { Name = "NativeExcavatedTrenches" };
        AddChild(_trenches);
        if (_terrain.Enabled) _trenches.SetEarthMaterial(_terrain.CreateExcavationMaterial());
    }
    public void Reset()
    {
        _terrain.Reset();
        _trenches?.Reset();
        _terrainId = "";
        _sourceTrenchIds = Array.Empty<string>();
        _trenchMaskRevision = -1;
        foreach (var item in _objects.Values)
        {
            _scene.RemoveChild(item.Root);
            item.Root.QueueFree();
        }
        foreach (var light in _lights.Values)
        {
            _scene.RemoveChild(light);
            light.QueueFree();
        }
        _objects.Clear();
        _geometries.Clear();
        _materials.Clear();
        _textures.Clear();
        _lights.Clear();
        _visible.Clear();
        _frames = 0;
    }
    public object Diagnostics() => new { frames = _frames, sequence = _lastSequence, objects = _objects.Count, visible = _visible.Count, geometries = _geometries.Count, materials = _materials.Count, textures = _textures.Count, lights = _lights.Count, instanceSectors = _objects.Values.Sum(o => o.Sectors?.SectorCount ?? 0), sectorInstances = _objects.Values.Sum(o => o.Sectors?.InstanceCount ?? 0), terrainObjectId = _terrainId, terrainGeometryId = _objects.TryGetValue(_terrainId, out var terrainObject) ? terrainObject.Geometry : "", sourceTrenchIds = _sourceTrenchIds, enhancedTerrain = _terrain.Enabled && _terrainId.Length > 0, trenches = _trenches?.Diagnostics() };

    public void Apply(JsonElement message)
    {
        if (message.S("kind") != "scene" || message.I("protocol") != 1)
            throw new InvalidDataException("Unsupported browser scene protocol");
        if (message.B("reset"))
            Reset();
        _dirtyGeometries.Clear();
        _dirtyMaterials.Clear();
        var definitions = message.P("definitions");
        ReadTextures(definitions.P("textures"));
        ReadGeometries(definitions.P("geometries"));
        ReadMaterials(definitions.P("materials"));
        var frame = message.P("frame");
        ReadTextures(frame.P("textureUpdates"));
        ReadGeometries(frame.P("geometryUpdates"));
        ReadMaterials(frame.P("materialUpdates"));
        if (frame.TryGetProperty("camera", out var camera))
        {
            Camera.Transform = BrowserValues.Transform(camera.P("matrix"));
            Camera.Fov = camera.F("fov", 45);
            Camera.Near = Math.Max(.01f, camera.F("near", 2));
            Camera.Far = camera.F("far", 9000);
            Camera.KeepAspect = Camera3D.KeepAspectEnum.Height;
        }
        ApplyEnvironment(frame.P("environment"));
        ApplyLights(frame.P("lights"));
        var applied = new HashSet<string>();
        foreach (var data in frame.P("objects").Items())
        {
            var id = BrowserValues.Id(data.P("id"));
            _visible.Add(id);
            ApplyObject(id, data);
            applied.Add(id);
        }
        // Scene packets contain object deltas. A static object remains present until
        // explicitly removed; resource changes can arrive without an object delta.
        if (_dirtyGeometries.Count > 0 || _dirtyMaterials.Count > 0)
            foreach (var (id, item) in _objects)
                if (!applied.Contains(id) && (_dirtyGeometries.Contains(item.Geometry) || item.Descriptor.P("materials").Items().Any(m => _dirtyMaterials.Contains(BrowserValues.Id(m)))))
                    ApplyObject(id, item.Descriptor);
        foreach (var raw in frame.P("removed").Items())
        {
            var id = BrowserValues.Id(raw);
            _visible.Remove(id);
            if (_objects.Remove(id, out var removed))
            {
                _scene.RemoveChild(removed.Root);
                removed.Root.QueueFree();
            }
        }
        ApplyPresentation(frame);
        _frames++;
        _lastSequence = message.P("seq").TryGetInt64(out var sequence) ? sequence : _lastSequence + 1;
    }
    private void ApplyPresentation(JsonElement frame)
    {
        var bindings = frame.P("visualBindings");
        if (bindings.P("terrain").ValueKind == JsonValueKind.Object)
            _terrainId = bindings.P("terrain").S("objectId");
        if (bindings.P("trenches").ValueKind == JsonValueKind.Array)
            _sourceTrenchIds = bindings.P("trenches").Items().Select(value => BrowserValues.Id(value.P("id"))).ToArray();
        if (!_terrain.Enabled) return;
        _trenches.Apply(bindings);
        if (_trenchMaskRevision != _trenches.MaskRevision)
        {
            _trenchMaskRevision = _trenches.MaskRevision;
            if (_trenches.HasCutouts && _trenches.IndexTexture != null && _trenches.MaskTexture != null)
                _terrain.SetTrenchMask(_trenches.IndexTexture, _trenches.MaskTexture, _trenches.AtlasSize, tilePixels: _trenches.TilePixels);
            else _terrain.ClearTrenchMask();
        }
        foreach (var id in _trenches.HiddenPoolIds)
            if (_objects.TryGetValue(id, out var original)) original.Root.Visible = false;
        var parts = _objects.TryGetValue(_terrainId, out var ground)
            ? (IEnumerable<GeometryInstance3D>)ground.Parts : Array.Empty<GeometryInstance3D>();
        _terrain.Apply(frame, parts);
        WarAtmosphere.ApplyLighting(_worldEnvironment.Environment, _lights, frame, _terrain.Enabled);
    }
    private void ReadGeometries(JsonElement list)
    {
        foreach (var descriptor in list.Items())
        {
            var id = BrowserValues.Id(descriptor.P("id"));
            if (!_geometries.TryGetValue(id, out var geometry))
                _geometries[id] = geometry = new BrowserGeometry();
            geometry.Update(descriptor);
            _dirtyGeometries.Add(id);
        }
    }
    private void ReadTextures(JsonElement list)
    {
        var changed = new HashSet<string>();
        foreach (var descriptor in list.Items())
        {
            var id = BrowserValues.Id(descriptor.P("id"));
            if (!_textures.TryGetValue(id, out var texture))
                _textures[id] = texture = new BrowserTexture();
            texture.Update(descriptor);
            changed.Add(id);
        }
        if (changed.Count > 0)
        foreach (var (id, material) in _materials)
            if (material.ReferencesTextures(changed))
            {
                material.RefreshTextures(_textures);
                _dirtyMaterials.Add(id);
            }
    }
    private void ReadMaterials(JsonElement list)
    {
        foreach (var descriptor in list.Items())
        {
            var id = BrowserValues.Id(descriptor.P("id"));
            if (!_materials.TryGetValue(id, out var material))
                _materials[id] = material = new BrowserMaterial();
            material.Update(descriptor, _textures);
            _dirtyMaterials.Add(id);
        }
    }
    private void ApplyObject(string id, JsonElement data)
    {
        var geometryId = BrowserValues.Id(data.P("geometry"));
        if (!_geometries.TryGetValue(geometryId, out var geometry))
            throw new InvalidDataException("Object references missing geometry " + geometryId);
        var materialIds = data.P("materials").Items().Select(BrowserValues.Id).ToArray();
        if (materialIds.Length == 0)
            throw new InvalidDataException("Object has no material " + id);
        foreach (var materialId in materialIds)
        if (!_materials.ContainsKey(materialId))
            throw new InvalidDataException("Object references missing material " + materialId);
        var type = data.S("type", "mesh");
        var start = data.P("drawRange").I("start");
        var count = data.P("drawRange").I("count", geometry.ElementCount);
        count = Math.Min(count, Math.Max(0, geometry.ElementCount - start));
        var signature = $"{geometryId}:{geometry.Revision}:{type}:{start}:{count}:" + string.Join('/', materialIds.Select(m => m + ":" + _materials[m].Material.GetInstanceId() + ":" + _materials[m].VertexColors));
        if (!_objects.TryGetValue(id, out var item))
        {
            item = new SceneObject { Root = new Node3D { Name = "BrowserObject_" + id }, Geometry = geometryId, Type = type };
            _objects[id] = item;
            _scene.AddChild(item.Root);
        }
        if (item.Signature != signature)
        {
            item.Sectors?.Clear(); item.Sectors = null;
            foreach (var part in item.Parts)
            {
                item.Root.RemoveChild(part);
                part.QueueFree();
            }
            item.Parts.Clear();
            item.Signature = signature;
            item.Geometry = geometryId;
            item.Type = type;
            item.UploadedCount = -1;
            var groups = materialIds.Length > 1 && geometry.Groups.Count > 0 ? geometry.Groups : new List<(int Start, int Count, int Material)> { (start, count, 0) };
            foreach (var group in groups)
            {
                var from = Math.Max(start, group.Start);
                var until = Math.Min(start + count, group.Start + group.Count);
                if (until <= from)
                    continue;
                var materialId = materialIds[Math.Clamp(group.Material, 0, materialIds.Length - 1)];
                var material = _materials[materialId];
                var mesh = geometry.Mesh(type, from, until - from, material.Type == "weather", material.VertexColors);
                GeometryInstance3D node;
                if (type == "instanced")
                {
                    var multi = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, UseCustomData = true, Mesh = mesh };
                    node = new MultiMeshInstance3D { Multimesh = multi, MaterialOverride = material.Material };
                }
                else
                    node = new MeshInstance3D { Mesh = mesh, MaterialOverride = material.Material };
                node.CastShadow = data.B("castShadow") ? GeometryInstance3D.ShadowCastingSetting.On : GeometryInstance3D.ShadowCastingSetting.Off;
                node.SetMeta("browser_material", materialId);
                if (!data.B("frustumCulled") || material.Type == "weather")
                    node.CustomAabb = new Aabb(new Vector3(-20000, -20000, -20000), new Vector3(40000, 40000, 40000));
                item.Root.AddChild(node);
                item.Parts.Add(node);
            }
        }
        item.Root.Transform = BrowserValues.Transform(data.P("matrix"));
        item.Root.Visible = true;
        item.Descriptor = data.Clone();
        if (type == "instanced")
            ApplyInstances(item, geometry, data.P("instances"), materialIds.All(id => _materials[id].Type is "standard" or "basic"));
        foreach (var part in item.Parts)
        {
            part.CastShadow = data.B("castShadow") ? GeometryInstance3D.ShadowCastingSetting.On : GeometryInstance3D.ShadowCastingSetting.Off;
            var material = _materials[part.GetMeta("browser_material").AsString()].ForObject(data.B("receiveShadow"), data.I("renderOrder"));
            if (part is MeshInstance3D single)
                single.MaterialOverride = material;
            else
                ((MultiMeshInstance3D)part).MaterialOverride = material;
            var materialType = _materials[part.GetMeta("browser_material").AsString()].Type;
            var uncullableSource = !data.B("frustumCulled") || materialType == "weather";
            part.CustomAabb = item.Sectors == null && uncullableSource
                ? new Aabb(new Vector3(-20000, -20000, -20000), new Vector3(40000, 40000, 40000))
                : new Aabb();
        }
        item.Sectors?.SynchronizeAppearance();
    }
    private static void ApplyInstances(SceneObject item, BrowserGeometry geometry, JsonElement data, bool plainMaterial)
    {
        var rawMatrix = data.P("matrix");
        var rawColor = data.P("color");
        var count = data.I("count");
        var matrixChanged = rawMatrix.ValueKind == JsonValueKind.Object && (item.Matrices == null || !item.Matrices.Matches(rawMatrix));
        var colorChanged = rawColor.ValueKind == JsonValueKind.Object && (item.Colors == null || !item.Colors.Matches(rawColor));
        if (matrixChanged)
        {
            item.Matrices = BrowserAttribute.Read(rawMatrix);
        }
        if (colorChanged)
        {
            item.Colors = BrowserAttribute.Read(rawColor);
        }
        if (rawColor.ValueKind == JsonValueKind.Null && item.Colors != null)
        {
            item.Colors = null;
            colorChanged = true;
        }
        var alpha = geometry.Attribute("aOpacity");
        var tint = geometry.Attribute("aTint");
        var dirty = matrixChanged || colorChanged || item.UploadedCount < 0 || !ReferenceEquals(item.UploadedAlpha, alpha) || !ReferenceEquals(item.UploadedTint, tint);
        var matrices = item.Matrices;
        if (matrices == null)
            throw new InvalidDataException("Instanced object has no matrices");
        var capacity = matrices.Count;
        count = Math.Clamp(count, 0, capacity);
        if (dirty)
        {
            if (item.InstanceBuffer.Length != capacity * 20)
                item.InstanceBuffer = new float[capacity * 20];
            for (var i = 0; i < capacity; i++)
            {
                var m = matrices.Values;
                var o = i * 16;
                var p = i * 20;
                item.InstanceBuffer[p] = m[o];
                item.InstanceBuffer[p + 1] = m[o + 4];
                item.InstanceBuffer[p + 2] = m[o + 8];
                item.InstanceBuffer[p + 3] = m[o + 12];
                item.InstanceBuffer[p + 4] = m[o + 1];
                item.InstanceBuffer[p + 5] = m[o + 5];
                item.InstanceBuffer[p + 6] = m[o + 9];
                item.InstanceBuffer[p + 7] = m[o + 13];
                item.InstanceBuffer[p + 8] = m[o + 2];
                item.InstanceBuffer[p + 9] = m[o + 6];
                item.InstanceBuffer[p + 10] = m[o + 10];
                item.InstanceBuffer[p + 11] = m[o + 14];
                for (var c = 0; c < 3; c++)
                    item.InstanceBuffer[p + 12 + c] = item.Colors?.At(i, c, 1) ?? 1;
                item.InstanceBuffer[p + 15] = item.Colors is { ItemSize: > 3 } ? item.Colors.At(i, 3, 1) : 1;
                for (var c = 0; c < 3; c++)
                    item.InstanceBuffer[p + 16 + c] = tint?.At(i, c, 1) ?? 1;
                item.InstanceBuffer[p + 19] = alpha?.At(i, 0, 1) ?? 1;
            }
            item.UploadedAlpha = alpha;
            item.UploadedTint = tint;
        }
        if (plainMaterial && count >= 512)
        {
            item.Sectors ??= new BrowserInstanceSectors();
            item.Sectors.Update(item.Parts.Cast<MultiMeshInstance3D>(), matrices, item.InstanceBuffer, count, item.Root.Transform, dirty);
            item.UploadedCount = count;
            return;
        }
        var returningToAggregate = item.Sectors != null;
        if (returningToAggregate) { item.Sectors!.Clear(); item.Sectors = null; }
        foreach (var part in item.Parts.Cast<MultiMeshInstance3D>())
        {
            if (part.Multimesh.InstanceCount != capacity)
                part.Multimesh.InstanceCount = capacity;
            if ((dirty || returningToAggregate) && capacity > 0)
                part.Multimesh.Buffer = item.InstanceBuffer;
            part.Multimesh.VisibleInstanceCount = count;
        }
        item.UploadedCount = count;
    }
    private void ApplyEnvironment(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object)
            return;
        var environment = _worldEnvironment.Environment;
        environment.BackgroundColor = BrowserValues.Color(value.P("background"), new Color(.02f, .03f, .04f)).LinearToSrgb();
        environment.TonemapExposure = value.F("exposure", 1);
        var fog = value.P("fog");
        environment.FogEnabled = fog.ValueKind == JsonValueKind.Object && fog.F("density") > 0;
        if (environment.FogEnabled)
        {
            environment.FogLightColor = BrowserValues.Color(fog.P("color"), new Color(.2f, .25f, .3f)).LinearToSrgb();
            environment.FogDensity = fog.F("density");
        }
    }
    private void ApplyLights(JsonElement list)
    {
        if (list.ValueKind != JsonValueKind.Array)
            return;
        var live = new HashSet<string>();
        var ambient = new Color(0, 0, 0);
        var ambientEnergy = 0f;
        foreach (var value in list.Items())
        {
            var id = BrowserValues.Id(value.P("id"));
            var type = value.S("type");
            var color = BrowserValues.Color(value.P("color"), Colors.White);
            var intensity = value.F("intensity", 1);
            if (type is "ambient" or "hemisphere")
            {
                if (type == "hemisphere")
                    color = color.Lerp(BrowserValues.Color(value.P("groundColor"), color), .25f);
                ambient += color * intensity;
                ambientEnergy += intensity;
                continue;
            }
            live.Add(id);
            if (!_lights.TryGetValue(id, out var light))
            {
                // The source Three renderer uses one orthographic shadow camera,
                // not Godot's default four frustum splits. Preserve that coverage
                // model instead of drawing the original scenery four times.
                light = type == "point" ? new OmniLight3D() : new DirectionalLight3D
                {
                    DirectionalShadowMode = DirectionalLight3D.ShadowMode.Orthogonal,
                    DirectionalShadowMaxDistance = 1100,
                    DirectionalShadowBlendSplits = false
                };
                _lights[id] = light;
                _scene.AddChild(light);
            }
            light.Transform = BrowserValues.Transform(value.P("matrix"));
            light.LightColor = color.LinearToSrgb();
            light.LightEnergy = intensity;
            light.ShadowEnabled = value.B("castShadow");
            if (light is OmniLight3D omni)
            {
                omni.OmniRange = Math.Max(1, value.F("distance", 500));
                omni.OmniAttenuation = Math.Max(.01f, value.F("decay", 2));
            }
            else if (value.P("target").ValueKind == JsonValueKind.Array)
            {
                var target = BrowserValues.Vector(value.P("target"), Vector3.Zero);
                if (target.DistanceSquaredTo(light.Position) > .0001f)
                    light.LookAt(target, Math.Abs((target - light.Position).Normalized().Dot(Vector3.Up)) > .99f ? Vector3.Forward : Vector3.Up);
            }
        }
        foreach (var id in _lights.Keys.Where(id => !live.Contains(id)).ToArray())
        {
            _scene.RemoveChild(_lights[id]);
            _lights[id].QueueFree();
            _lights.Remove(id);
        }
        if (ambientEnergy > 0)
        {
            _worldEnvironment.Environment.AmbientLightColor = (ambient / ambientEnergy).LinearToSrgb();
            _worldEnvironment.Environment.AmbientLightEnergy = ambientEnergy;
        }
    }
}

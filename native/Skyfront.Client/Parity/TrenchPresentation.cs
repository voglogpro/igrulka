using Godot;
using System.Text.Json;
using Skyfront.Client.Runtime;

namespace Skyfront.Client.Parity;

/// <summary>
/// Native excavation and revetment art driven only by original fortification records.
/// Does not alter cover, pathfinding, targeting, the save state or unit count.
/// </summary>
public partial class TrenchPresentation : Node3D
{
    private sealed class Batch
    {
        public Node3D Root = null!;
        public readonly List<MultiMeshInstance3D> Parts = new();
        public MultiMeshInstance3D? Earth;
        public TrenchGeometry.Pose[] Poses = Array.Empty<TrenchGeometry.Pose>();
    }
    private const float SectorSize = 512;
    private readonly Dictionary<TrenchGeometry.GroupKey, Batch> _batches = new();
    private readonly Dictionary<(int Level, bool Connector, bool RampStart, bool RampEnd, float WidthScale), (ArrayMesh Earth, ArrayMesh Wood, ArrayMesh Bags)> _meshes = new();
    private readonly HashSet<string> _hiddenPools = new();
    private readonly HashSet<string> _sectionPools = new(), _linkPools = new();
    private readonly HashSet<string> _sectionIds = new(), _linkIds = new();
    private List<TrenchGeometry.Pose> _sectionPoses = new(), _linkPoses = new();
    private readonly TrenchCutoutAtlas _atlas = new();
    private List<TrenchGeometry.Pose> _sectionMask = new(), _linkMask = new();
    private Material _earthMaterial = new StandardMaterial3D { AlbedoColor = new Color("454035"), Roughness = .98f };
    private readonly StandardMaterial3D _woodMaterial = new() { AlbedoColor = new Color("4c4435"), Roughness = .92f };
    private readonly StandardMaterial3D _bagMaterial = new() { AlbedoColor = new Color("69644f"), Roughness = .95f };
    private ImageTexture? _indexTexture, _maskTexture;
    private int _sectionCount, _linkPieceCount, _changedGroups, _reusedGroups;
    public Texture2D? IndexTexture => _indexTexture;
    public Texture2D? MaskTexture => _maskTexture;
    public Vector2 AtlasSize => new(_atlas.Size, _atlas.Size);
    public int TilePixels => _atlas.TilePixels;
    public bool HasCutouts => _atlas.TileCount > 0;
    public int MaskRevision { get; private set; }
    public IReadOnlySet<string> HiddenPoolIds => _hiddenPools;
    public void SetEarthMaterial(Material material)
    {
        _earthMaterial = material;
        foreach (var batch in _batches.Values)
            if (batch.Earth != null) batch.Earth.MaterialOverride = material;
    }
    public void Reset()
    {
        foreach (var batch in _batches.Values)
        {
            RemoveChild(batch.Root); batch.Root.QueueFree();
        }
        _batches.Clear(); _hiddenPools.Clear(); _sectionPools.Clear(); _linkPools.Clear(); _sectionMask.Clear(); _linkMask.Clear();
        _sectionIds.Clear(); _linkIds.Clear(); _changedGroups = 0; _reusedGroups = 0;
        _sectionPoses.Clear(); _linkPoses.Clear(); _sectionCount = 0; _linkPieceCount = 0;
        _atlas.Build(Array.Empty<TrenchGeometry.Pose>());
        MaskRevision++;
    }
    private static TrenchGeometry.Pose Read(JsonElement value)
    {
        var pose = new TrenchGeometry.Pose(BrowserValues.Id(value.P("id")), value.F("x"), value.F("z"), value.F("y"), value.F("yaw"), value.F("roll"), value.F("stretch", 1), Math.Clamp(value.I("level"), 0, 5), Math.Clamp(value.F("progress"), 0, 1), value.B("connector"), value.F("widthScale", 1), value.B("rampStart"), value.B("rampEnd"));
        if (pose.Id.Length == 0 || !float.IsFinite(pose.X) || !float.IsFinite(pose.Z) || !float.IsFinite(pose.Y) || !float.IsFinite(pose.Yaw) || !float.IsFinite(pose.Roll) || !float.IsFinite(pose.Stretch) || !float.IsFinite(pose.WidthScale) || pose.Stretch <= 0 || pose.WidthScale <= 0 || MathF.Cos(pose.Roll) <= .001f)
            throw new InvalidDataException("Invalid presentation trench pose");
        return pose;
    }
    public void Apply(JsonElement visualBindings)
    {
        _changedGroups = 0; _reusedGroups = 0;
        if (visualBindings.ValueKind != JsonValueKind.Object) return;
        var hasSections = visualBindings.TryGetProperty("trenches", out var raw);
        var hasLinks = visualBindings.TryGetProperty("trenchLinks", out var rawLinks);
        if (!hasSections && !hasLinks) return;
        if (hasSections)
        {
            _sectionPoses = raw.Items().Select(Read).ToList();
            if (_sectionPoses.Any(p => p.Connector)) throw new InvalidDataException("Section snapshot cannot contain connector poses");
            if (visualBindings.TryGetProperty("trenchPools", out var sectionPools))
            {
                _sectionPools.Clear();
                // Preserve the original covered dugout and concrete fort pools.
                foreach (var pool in sectionPools.Items().Take(3)) _sectionPools.Add(BrowserValues.Id(pool));
            }
        }
        if (hasLinks)
        {
            _linkPoses = rawLinks.Items().Select(Read).ToList();
            if (_linkPoses.Any(p => !p.Connector)) throw new InvalidDataException("Native link snapshot requires connector poses");
            if (visualBindings.TryGetProperty("trenchLinkPools", out var linkPools))
            {
                _linkPools.Clear();
                foreach (var pool in linkPools.Items()) _linkPools.Add(BrowserValues.Id(pool));
            }
        }
        // Independent source revisions keep a section's digging animation from
        // grouping or packing the unchanged multi-thousand-piece connector layer.
        IEnumerable<TrenchGeometry.Pose> poses = hasSections && hasLinks ? _sectionPoses.Concat(_linkPoses) : hasSections ? _sectionPoses : _linkPoses;
        _hiddenPools.Clear();
        _hiddenPools.UnionWith(_sectionPools); _hiddenPools.UnionWith(_linkPools);
        if (hasSections)
        {
            _sectionIds.Clear();
            foreach (var pose in _sectionPoses)
                if (!_sectionIds.Add(pose.Id) || (!hasLinks && _linkIds.Contains(pose.Id))) throw new InvalidDataException("Duplicate native trench binding " + pose.Id);
        }
        if (hasLinks)
        {
            _linkIds.Clear();
            foreach (var pose in _linkPoses)
                if (!_linkIds.Add(pose.Id) || _sectionIds.Contains(pose.Id)) throw new InvalidDataException("Duplicate native link binding " + pose.Id);
        }
        _sectionCount = _sectionPoses.Count; _linkPieceCount = _linkPoses.Count;
        var active = new HashSet<TrenchGeometry.GroupKey>();
        foreach (var group in poses.Where(p => p.Progress > 0).GroupBy(TrenchGeometry.BatchKey))
        {
            active.Add(group.Key);
            if (!_batches.TryGetValue(group.Key, out var batch))
            {
                batch = BuildBatch(group.Key.Level, group.Key.Connector, group.Key.RampStart, group.Key.RampEnd, group.Key.WidthScale);
                batch.Root.Name = $"{(group.Key.Connector ? "TrenchLinks" : "Trenches")}_{group.Key.Level}_{group.Key.RampStart}_{group.Key.RampEnd}_{group.Key.X}_{group.Key.Z}";
                _batches.Add(group.Key, batch); AddChild(batch.Root);
            }
            if (TrenchGeometry.SamePoses(group, batch.Poses)) { _reusedGroups++; continue; }
            _changedGroups++;
            var origin = new Vector3(group.Key.X * SectorSize, 0, group.Key.Z * SectorSize);
            batch.Root.Position = origin;
            var values = group.ToArray();
            batch.Poses = values;
            var buffer = new float[values.Length * 12];
            var transforms = new Transform3D[values.Length];
            for (var index = 0; index < values.Length; index++)
            {
                var pose = values[index];
                var c = MathF.Cos(pose.Yaw); var s = MathF.Sin(pose.Yaw);
                var cr = MathF.Cos(pose.Roll); var sr = MathF.Sin(pose.Roll);
                // Keep digging vertical in world space. A rotated local-Y axis would shift the floor sideways
                // by depth*sin(roll), separating it from CPU picking and the soldier presentation floor.
                var basis = new Basis(new Vector3(c * cr * pose.Stretch, sr * pose.Stretch, -s * cr * pose.Stretch),
                    new Vector3(0, cr * TrenchGeometry.Smooth(0, .75f, pose.Progress), 0), new Vector3(s * pose.WidthScale, 0, c * pose.WidthScale));
                var transform = new Transform3D(basis, new Vector3(pose.X, pose.Y, pose.Z) - origin);
                transforms[index] = transform;
                var at = index * 12; var b = transform.Basis;
                buffer[at] = b.X.X; buffer[at + 1] = b.Y.X; buffer[at + 2] = b.Z.X; buffer[at + 3] = transform.Origin.X;
                buffer[at + 4] = b.X.Y; buffer[at + 5] = b.Y.Y; buffer[at + 6] = b.Z.Y; buffer[at + 7] = transform.Origin.Y;
                buffer[at + 8] = b.X.Z; buffer[at + 9] = b.Y.Z; buffer[at + 10] = b.Z.Z; buffer[at + 11] = transform.Origin.Z;
            }
            foreach (var part in batch.Parts)
            {
                var multi = part.Multimesh;
                if (multi.InstanceCount != values.Length) multi.InstanceCount = values.Length;
                var meshBounds = multi.Mesh.GetAabb(); var bounds = new Aabb(); var hasBounds = false;
                foreach (var transform in transforms)
                {
                    var transformed = transform * meshBounds;
                    bounds = hasBounds ? bounds.Merge(transformed) : transformed; hasBounds = true;
                }
                multi.CustomAabb = bounds;
                multi.Buffer = buffer; multi.VisibleInstanceCount = values.Length;
            }
        }
        foreach (var key in _batches.Keys.Where(key => (key.Connector ? hasLinks : hasSections) && !active.Contains(key)).ToArray())
        {
            var batch = _batches[key]; RemoveChild(batch.Root); batch.Root.QueueFree(); _batches.Remove(key);
        }
        // Digging changes depth through a cheap instance transform. It does not upload the entire mask every frame.
        var maskChanged = false;
        if (hasSections) maskChanged |= UpdateMask(ref _sectionMask, _sectionPoses);
        if (hasLinks) maskChanged |= UpdateMask(ref _linkMask, _linkPoses);
        if (!maskChanged) return;
        _atlas.Build(_sectionMask.Concat(_linkMask).ToList());
        using var indexImage = Image.CreateFromData(TrenchCutoutAtlas.IndexSize, TrenchCutoutAtlas.IndexSize, false, Image.Format.Rg8, _atlas.Index);
        using var maskImage = Image.CreateFromData(_atlas.Size, _atlas.Size, false, Image.Format.R8, _atlas.Mask);
        if (_indexTexture == null) _indexTexture = ImageTexture.CreateFromImage(indexImage); else _indexTexture.Update(indexImage);
        if (_maskTexture == null || _maskTexture.GetWidth() != _atlas.Size) _maskTexture = ImageTexture.CreateFromImage(maskImage); else _maskTexture.Update(maskImage);
        MaskRevision++;
    }
    private static bool UpdateMask(ref List<TrenchGeometry.Pose> previous, List<TrenchGeometry.Pose> current)
    {
        var next = current.Where(p => p.Progress > 0).Select(p => p with { Y = 0, Stretch = p.Stretch * MathF.Cos(p.Roll), Roll = 0, Level = 0, Progress = 1, RampStart = false, RampEnd = false }).OrderBy(p => p.Id, StringComparer.Ordinal).ToList();
        if (previous.SequenceEqual(next)) return false;
        previous = next;
        return true;
    }
    private Batch BuildBatch(int level, bool connector, bool rampStart, bool rampEnd, float widthScale)
    {
        var batch = new Batch { Root = new Node3D() };
        var meshKey = (level, connector, rampStart, rampEnd, widthScale);
        if (!_meshes.TryGetValue(meshKey, out var meshes))
        {
            var geometry = TrenchGeometry.Build(level, connector, rampStart, rampEnd, widthScale);
            meshes = (Mesh(geometry.Earth), Mesh(geometry.Wood), Mesh(geometry.Sandbags));
            _meshes.Add(meshKey, meshes);
        }
        void Add(ArrayMesh mesh, Material material, bool earth = false)
        {
            if (mesh.GetSurfaceCount() == 0) return;
            var multi = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = mesh };
            var view = new MultiMeshInstance3D { Multimesh = multi, MaterialOverride = material, CastShadow = GeometryInstance3D.ShadowCastingSetting.On };
            batch.Root.AddChild(view); batch.Parts.Add(view); if (earth) batch.Earth = view;
        }
        Add(meshes.Earth, _earthMaterial, true); Add(meshes.Wood, _woodMaterial); Add(meshes.Bags, _bagMaterial);
        return batch;
    }
    private static ArrayMesh Mesh(TrenchGeometry.Surface surface)
    {
        var mesh = new ArrayMesh(); if (surface.Vertices.Count == 0) return mesh;
        var arrays = new Godot.Collections.Array(); arrays.Resize((int)Godot.Mesh.ArrayType.Max);
        arrays[(int)Godot.Mesh.ArrayType.Vertex] = surface.Vertices.Select(v => new Vector3(v.X, v.Y, v.Z)).ToArray();
        arrays[(int)Godot.Mesh.ArrayType.Normal] = surface.Normals.Select(v => new Vector3(v.X, v.Y, v.Z)).ToArray();
        arrays[(int)Godot.Mesh.ArrayType.TexUV] = surface.Uvs.Select(v => new Vector2(v.X, v.Y)).ToArray();
        mesh.AddSurfaceFromArrays(Godot.Mesh.PrimitiveType.Triangles, arrays);
        return mesh;
    }
    public object Diagnostics() => new { sections = _sectionCount, linkPieces = _linkPieceCount, batches = _batches.Count, changedGroups = _changedGroups, reusedGroups = _reusedGroups, drawParts = _batches.Values.Sum(b => b.Parts.Count), geometryVariants = _meshes.Count, maskRevision = MaskRevision, atlasSize = _atlas.Size, tilePixels = _atlas.TilePixels, occupiedTiles = _atlas.TileCount, cacheHits = _atlas.CacheHits, dirtyTiles = _atlas.DirtyTiles, rasterizedTexels = _atlas.RasterizedTexels, maskBytes = _atlas.Mask.Length + _atlas.Index.Length, maximumDepth = TrenchGeometry.FullDepth };
}

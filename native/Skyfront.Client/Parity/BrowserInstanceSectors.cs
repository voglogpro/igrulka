using Godot;

namespace Skyfront.Client.Parity;

/// <summary>
/// Spatial draw groups for original plain instanced meshes. No instances or
/// geometry are discarded; only the GPU culling granularity changes.
/// </summary>
internal sealed class BrowserInstanceSectors
{
    private const float SectorSize = 512;
    private sealed class Partition
    {
        public readonly List<int> Indices = new();
        public Vector3 Origin;
    }
    private sealed class Sector
    {
        public MultiMeshInstance3D Node = null!;
        public float[] Buffer = Array.Empty<float>();
        public int Capacity;
    }
    private sealed class Part
    {
        public MultiMeshInstance3D Source = null!;
        public readonly Dictionary<Vector2I, Sector> Sectors = new();
    }
    private readonly Dictionary<Vector2I, Partition> _partitions = new();
    private readonly Dictionary<MultiMeshInstance3D, Part> _parts = new();
    private BrowserAttribute? _matrices;
    private Transform3D _rootWorld;
    private int _count = -1;
    public int Rebuilds { get; private set; }
    public int InstanceCount => Math.Max(0, _count);
    public int SectorCount => _partitions.Values.Count(p => p.Indices.Count > 0);

    public void Clear()
    {
        foreach (var part in _parts.Values)
            foreach (var sector in part.Sectors.Values)
            {
                part.Source.RemoveChild(sector.Node);
                sector.Node.QueueFree();
            }
        _parts.Clear(); _partitions.Clear(); _matrices = null; _count = -1;
    }

    public void Update(IEnumerable<MultiMeshInstance3D> sources, BrowserAttribute matrices, float[] originalBuffer, int count, Transform3D rootWorld, bool payloadChanged)
    {
        var repartition = !ReferenceEquals(_matrices, matrices) || count != _count || rootWorld != _rootWorld;
        if (repartition)
        {
            foreach (var partition in _partitions.Values) partition.Indices.Clear();
            for (var index = 0; index < count; index++)
            {
                var local = BrowserValues.Transform(matrices.Values, index * 16);
                var world = rootWorld * local.Origin;
                var key = new Vector2I(Mathf.FloorToInt(world.X / SectorSize), Mathf.FloorToInt(world.Z / SectorSize));
                if (!_partitions.TryGetValue(key, out var partition)) _partitions[key] = partition = new Partition();
                if (partition.Indices.Count == 0) partition.Origin = local.Origin;
                partition.Indices.Add(index);
            }
            _matrices = matrices; _rootWorld = rootWorld; _count = count; Rebuilds++;
        }
        foreach (var source in sources)
        {
            if (!_parts.TryGetValue(source, out var part)) _parts[source] = part = new Part { Source = source };
            // The original aggregate must not draw in addition to its exact sectors.
            if (source.Multimesh.VisibleInstanceCount != 0) source.Multimesh.VisibleInstanceCount = 0;
            if (source.Multimesh.InstanceCount != 0) source.Multimesh.InstanceCount = 0;
            source.CustomAabb = new Aabb();
            var mesh = source.Multimesh.Mesh;
            var meshBounds = mesh.GetAabb();
            foreach (var (key, partition) in _partitions)
            {
                if (partition.Indices.Count == 0)
                {
                    if (part.Sectors.TryGetValue(key, out var hidden)) hidden.Node.Visible = false;
                    continue;
                }
                var created = false;
                if (!part.Sectors.TryGetValue(key, out var sector))
                {
                    var multimesh = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, UseCustomData = true, Mesh = mesh };
                    sector = new Sector { Node = new MultiMeshInstance3D { Name = $"OriginalSector_{key.X}_{key.Y}", Multimesh = multimesh } };
                    part.Sectors[key] = sector; source.AddChild(sector.Node); created = true;
                }
                sector.Node.Visible = true; sector.Node.Position = partition.Origin;
                if (repartition || payloadChanged || created)
                {
                    var indices = partition.Indices;
                    if (sector.Capacity < indices.Count)
                    {
                        sector.Capacity = 16;
                        while (sector.Capacity < indices.Count) sector.Capacity *= 2;
                        sector.Buffer = new float[sector.Capacity * 20];
                        sector.Node.Multimesh.InstanceCount = sector.Capacity;
                    }
                    var bounds = new Aabb(); var hasBounds = false;
                    for (var i = 0; i < indices.Count; i++)
                    {
                        var original = indices[i]; var from = original * 20; var to = i * 20;
                        Array.Copy(originalBuffer, from, sector.Buffer, to, 20);
                        sector.Buffer[to + 3] -= partition.Origin.X;
                        sector.Buffer[to + 7] -= partition.Origin.Y;
                        sector.Buffer[to + 11] -= partition.Origin.Z;
                        if (repartition || created)
                        {
                            var transform = BrowserValues.Transform(matrices.Values, original * 16); transform.Origin -= partition.Origin;
                            var transformed = transform * meshBounds;
                            bounds = hasBounds ? bounds.Merge(transformed) : transformed; hasBounds = true;
                        }
                    }
                    // Explicit tight local bounds avoid GPU readback/recalculation and
                    // allow each source sector to be culled in view and shadow passes.
                    if (repartition || created) sector.Node.Multimesh.CustomAabb = bounds;
                    sector.Node.Multimesh.Buffer = sector.Buffer;
                    sector.Node.Multimesh.VisibleInstanceCount = indices.Count;
                }
            }
        }
    }

    public void SynchronizeAppearance()
    {
        foreach (var part in _parts.Values)
            foreach (var sector in part.Sectors.Values)
            {
                sector.Node.MaterialOverride = part.Source.MaterialOverride;
                sector.Node.CastShadow = part.Source.CastShadow;
                sector.Node.Layers = part.Source.Layers;
            }
    }
}

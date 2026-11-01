namespace Skyfront.Client.Parity;

/// <summary>Sparse world tiles keep excavation sampling O(1), independent of the number of trenches.</summary>
internal sealed class TrenchCutoutAtlas
{
    public const int TileWorld = 32, IndexSize = 512, IndexOffset = IndexSize / 2;
    public int TilePixels { get; private set; } = 128;
    public byte[] Index { get; private set; } = Array.Empty<byte>();
    public byte[] Mask { get; private set; } = Array.Empty<byte>();
    public int Size { get; private set; } = 128;
    public int TileCount { get; private set; }
    public int RasterizedTexels { get; private set; }
    public int CacheHits { get; private set; }
    public int DirtyTiles { get; private set; }
    private sealed record CachedTile(int Pixels, TrenchGeometry.Pose[] Poses, byte[] Data);
    private readonly Dictionary<(int X, int Z), CachedTile> _cache = new();
    public void Build(IReadOnlyList<TrenchGeometry.Pose> poses)
    {
        var tiles = new SortedDictionary<(int X, int Z), List<TrenchGeometry.Pose>>();
        foreach (var pose in poses)
        {
            if (!(pose.Progress > 0)) continue;
            var c = Math.Abs(MathF.Cos(pose.Yaw)); var s = Math.Abs(MathF.Sin(pose.Yaw));
            var horizontalStretch = pose.Stretch * MathF.Cos(pose.Roll);
            // Include the distance-field collar at every supported density, so
            // bilinear samples on a world-tile seam do not meet an uninitialised tile.
            const float padding = 2.5f;
            var ex = TrenchGeometry.HalfLength * horizontalStretch * c + TrenchGeometry.HalfWidth * pose.WidthScale * s + padding;
            var ez = TrenchGeometry.HalfLength * horizontalStretch * s + TrenchGeometry.HalfWidth * pose.WidthScale * c + padding;
            for (var z = (int)Math.Floor((pose.Z - ez) / TileWorld); z <= (int)Math.Floor((pose.Z + ez) / TileWorld); z++)
                for (var x = (int)Math.Floor((pose.X - ex) / TileWorld); x <= (int)Math.Floor((pose.X + ex) / TileWorld); x++)
                {
                    if (x < -IndexOffset || x >= IndexOffset || z < -IndexOffset || z >= IndexOffset)
                        throw new InvalidDataException("Trench lies beyond the visual mask world bounds");
                    if (!tiles.TryGetValue((x, z), out var entries)) tiles[(x, z)] = entries = new List<TrenchGeometry.Pose>();
                    entries.Add(pose);
                }
        }
        TileCount = tiles.Count;
        TilePixels = 128;
        Size = TilePixels;
        while ((Size / TilePixels) * (Size / TilePixels) < TileCount) Size *= 2;
        while (Size > 4096 && TilePixels > 32)
        {
            TilePixels /= 2;
            Size = TilePixels;
            while ((Size / TilePixels) * (Size / TilePixels) < TileCount) Size *= 2;
        }
        if (Size > 4096) throw new InvalidDataException("Trench cutout atlas exceeds the bounded source-shaped world layout");
        if (Index.Length != IndexSize * IndexSize * 2) Index = new byte[IndexSize * IndexSize * 2]; else Array.Clear(Index);
        if (Mask.Length != Size * Size) Mask = new byte[Size * Size]; else Array.Clear(Mask);
        RasterizedTexels = 0; CacheHits = 0; DirtyTiles = 0;
        foreach (var removed in _cache.Keys.Where(key => !tiles.ContainsKey(key)).ToArray()) _cache.Remove(removed);
        var slot = 0; var columns = Size / TilePixels;
        foreach (var (key, entries) in tiles)
        {
            var index = ((key.Z + IndexOffset) * IndexSize + key.X + IndexOffset) * 2;
            var encoded = slot + 1;
            Index[index] = (byte)(encoded & 255); Index[index + 1] = (byte)(encoded >> 8);
            var ox = slot % columns * TilePixels; var oz = slot / columns * TilePixels;
            if (_cache.TryGetValue(key, out var cached) && cached.Pixels == TilePixels && SameShapes(cached.Poses, entries))
                CacheHits++;
            else
            {
                cached = new CachedTile(TilePixels, entries.ToArray(), RasterTile(key, entries));
                _cache[key] = cached; DirtyTiles++;
            }
            // A newly inserted world tile may move packed slots. Repack the
            // cached rows; do not reevaluate unchanged shape distance fields.
            for (var row = 0; row < TilePixels; row++)
                Buffer.BlockCopy(cached.Data, row * TilePixels, Mask, (oz + row) * Size + ox, TilePixels);
            slot++;
        }
    }
    private static bool SameShapes(TrenchGeometry.Pose[] previous, List<TrenchGeometry.Pose> current)
    {
        if (previous.Length != current.Count) return false;
        for (var i = 0; i < previous.Length; i++) if (previous[i] != current[i]) return false;
        return true;
    }
    private byte[] RasterTile((int X, int Z) key, List<TrenchGeometry.Pose> entries)
    {
        var data = new byte[TilePixels * TilePixels];
            // Visit only each capsule's tile-local bounding box. Trigonometry belongs outside the pixel loops.
            // A widely dispersed army must not rasterize the empty remainder of every occupied tile repeatedly.
            foreach (var pose in entries)
            {
                var c = MathF.Cos(pose.Yaw); var s = MathF.Sin(pose.Yaw);
                var horizontalStretch = pose.Stretch * MathF.Cos(pose.Roll);
                var step = (float)TileWorld / TilePixels;
                var distanceRange = step * 1.5f;
                var padding = distanceRange + step;
                var ex = TrenchGeometry.HalfLength * horizontalStretch * Math.Abs(c) + TrenchGeometry.HalfWidth * pose.WidthScale * Math.Abs(s) + padding;
                var ez = TrenchGeometry.HalfLength * horizontalStretch * Math.Abs(s) + TrenchGeometry.HalfWidth * pose.WidthScale * Math.Abs(c) + padding;
                var startX = Math.Clamp((int)MathF.Floor((pose.X - ex - key.X * TileWorld) / step), 0, TilePixels - 1);
                var endX = Math.Clamp((int)MathF.Ceiling((pose.X + ex - key.X * TileWorld) / step), 0, TilePixels - 1);
                var startZ = Math.Clamp((int)MathF.Floor((pose.Z - ez - key.Z * TileWorld) / step), 0, TilePixels - 1);
                var endZ = Math.Clamp((int)MathF.Ceiling((pose.Z + ez - key.Z * TileWorld) / step), 0, TilePixels - 1);
                for (var py = startZ; py <= endZ; py++)
                    for (var px = startX; px <= endX; px++)
                {
                    var dx = key.X * TileWorld + (px + .5f) * step - pose.X;
                    var dz = key.Z * TileWorld + (py + .5f) * step - pose.Z;
                    var along = (dx * c - dz * s) / horizontalStretch;
                    var across = (dx * s + dz * c) / pose.WidthScale;
                    float distance;
                    if (pose.Connector)
                    {
                        var ax = (TrenchGeometry.HalfLength - Math.Abs(along)) * horizontalStretch;
                        var az = (TrenchGeometry.HalfWidth - Math.Abs(across)) * pose.WidthScale;
                        distance = ax >= 0 && az >= 0 ? Math.Min(ax, az) : -MathF.Sqrt(MathF.Pow(Math.Min(0, ax), 2) + MathF.Pow(Math.Min(0, az), 2));
                    }
                    else
                        distance = (TrenchGeometry.HalfWidth - TrenchGeometry.Distance(along, across)) * Math.Min(horizontalStretch, pose.WidthScale);
                    // Preserve the exact sign at texel centres; interpolation
                    // reconstructs a stable boundary instead of binary stair steps.
                    var signed = (int)MathF.Round(Math.Clamp(distance / distanceRange, -1, 1) * 127);
                    var coverage = (byte)Math.Clamp((distance > 0 ? 128 : 127) + signed, 0, 255);
                    var pixel = py * TilePixels + px;
                    data[pixel] = Math.Max(data[pixel], coverage);
                    RasterizedTexels++;
                }
            }
        return data;
    }
    // Mirrors the shader's nearest virtual tile lookup; useful for CPU-only boundary checks.
    public bool Sample(float x, float z)
    {
        if (Index.Length == 0) return false;
        var tx = (int)MathF.Floor(x / TileWorld); var tz = (int)MathF.Floor(z / TileWorld);
        if (tx < -IndexOffset || tx >= IndexOffset || tz < -IndexOffset || tz >= IndexOffset) return false;
        var at = ((tz + IndexOffset) * IndexSize + tx + IndexOffset) * 2;
        var encoded = Index[at] + (Index[at + 1] << 8); if (encoded == 0) return false;
        var slot = encoded - 1; var cols = Size / TilePixels;
        var px = Math.Clamp((int)((x / TileWorld - MathF.Floor(x / TileWorld)) * TilePixels), 0, TilePixels - 1);
        var pz = Math.Clamp((int)((z / TileWorld - MathF.Floor(z / TileWorld)) * TilePixels), 0, TilePixels - 1);
        return Mask[(slot / cols * TilePixels + pz) * Size + slot % cols * TilePixels + px] > 127;
    }
    public bool SampleLinear(float x, float z)
    {
        if (Index.Length == 0) return false;
        var tx = (int)MathF.Floor(x / TileWorld); var tz = (int)MathF.Floor(z / TileWorld);
        if (tx < -IndexOffset || tx >= IndexOffset || tz < -IndexOffset || tz >= IndexOffset) return false;
        var at = ((tz + IndexOffset) * IndexSize + tx + IndexOffset) * 2;
        var encoded = Index[at] + (Index[at + 1] << 8); if (encoded == 0) return false;
        var slot = encoded - 1; var columns = Size / TilePixels;
        var fx = Math.Clamp((x / TileWorld - MathF.Floor(x / TileWorld)) * TilePixels - .5f, 0, TilePixels - 1);
        var fz = Math.Clamp((z / TileWorld - MathF.Floor(z / TileWorld)) * TilePixels - .5f, 0, TilePixels - 1);
        var px = (int)MathF.Floor(fx); var pz = (int)MathF.Floor(fz);
        var nx = Math.Min(px + 1, TilePixels - 1); var nz = Math.Min(pz + 1, TilePixels - 1);
        var ox = slot % columns * TilePixels; var oz = slot / columns * TilePixels;
        float Pixel(int xx, int zz) => Mask[(oz + zz) * Size + ox + xx];
        var a = Pixel(px, pz) * (1 - (fx - px)) + Pixel(nx, pz) * (fx - px);
        var b = Pixel(px, nz) * (1 - (fx - px)) + Pixel(nx, nz) * (fx - px);
        return a * (1 - (fz - pz)) + b * (fz - pz) > 127.5f;
    }
}

namespace Skyfront.Client.Parity;

/// <summary>Sparse world tiles keep excavation sampling O(1), independent of the number of trenches.</summary>
internal sealed class TrenchCutoutAtlas
{
    public const int TileWorld = 32, TilePixels = 128, IndexSize = 512, IndexOffset = IndexSize / 2;
    public byte[] Index { get; private set; } = Array.Empty<byte>();
    public byte[] Mask { get; private set; } = Array.Empty<byte>();
    public int Size { get; private set; } = TilePixels;
    public int TileCount { get; private set; }
    public int RasterizedTexels { get; private set; }
    public void Build(IReadOnlyList<TrenchGeometry.Pose> poses)
    {
        var tiles = new SortedDictionary<(int X, int Z), List<TrenchGeometry.Pose>>();
        foreach (var pose in poses)
        {
            if (!(pose.Progress > 0)) continue;
            var c = Math.Abs(MathF.Cos(pose.Yaw)); var s = Math.Abs(MathF.Sin(pose.Yaw));
            var horizontalStretch = pose.Stretch * MathF.Cos(pose.Roll);
            var ex = TrenchGeometry.HalfLength * horizontalStretch * c + TrenchGeometry.HalfWidth * s;
            var ez = TrenchGeometry.HalfLength * horizontalStretch * s + TrenchGeometry.HalfWidth * c;
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
        Size = TilePixels;
        while ((Size / TilePixels) * (Size / TilePixels) < TileCount) Size *= 2;
        if (Size > 4096) throw new InvalidDataException("Trench cutout atlas exceeds the explicit 16 MiB graphics budget");
        Index = new byte[IndexSize * IndexSize * 2]; Mask = new byte[Size * Size]; RasterizedTexels = 0;
        var slot = 0; var columns = Size / TilePixels;
        foreach (var (key, entries) in tiles)
        {
            var index = ((key.Z + IndexOffset) * IndexSize + key.X + IndexOffset) * 2;
            var encoded = slot + 1;
            Index[index] = (byte)(encoded & 255); Index[index + 1] = (byte)(encoded >> 8);
            var ox = slot % columns * TilePixels; var oz = slot / columns * TilePixels;
            // Visit only each capsule's tile-local bounding box. Trigonometry belongs outside the pixel loops.
            // A widely dispersed army must not rasterize the empty remainder of every occupied tile repeatedly.
            foreach (var pose in entries)
            {
                var c = MathF.Cos(pose.Yaw); var s = MathF.Sin(pose.Yaw);
                var horizontalStretch = pose.Stretch * MathF.Cos(pose.Roll);
                var ex = TrenchGeometry.HalfLength * horizontalStretch * Math.Abs(c) + TrenchGeometry.HalfWidth * Math.Abs(s);
                var ez = TrenchGeometry.HalfLength * horizontalStretch * Math.Abs(s) + TrenchGeometry.HalfWidth * Math.Abs(c);
                var step = (float)TileWorld / TilePixels;
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
                    var across = dx * s + dz * c;
                    var endDistance = Math.Max(0, Math.Abs(along) - TrenchGeometry.HalfCore);
                    if (endDistance * endDistance + across * across < TrenchGeometry.HalfWidth * TrenchGeometry.HalfWidth)
                        Mask[(oz + py) * Size + ox + px] = 255;
                    RasterizedTexels++;
                }
            }
            slot++;
        }
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
}

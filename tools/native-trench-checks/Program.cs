using System.Numerics;
using Skyfront.Client.Parity;

var checks = 0;
void Check(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException(name);
    checks++;
}
Check(Math.Abs(TrenchGeometry.Depth(0, 0) - 1.55f) < .00001f, "full-depth floor");
Check(TrenchGeometry.Depth(0, 0, 0) == 0, "unbuilt floor stays level");
Check(TrenchGeometry.Depth(9, 0) == 0 && TrenchGeometry.Depth(0, 2.2f) == 0, "continuous ground joins");
Check(TrenchGeometry.Depth(8, 0) > 0 && TrenchGeometry.Depth(8, 0) < TrenchGeometry.Depth(7, 0), "end ramp rises toward exit");
Check(TrenchGeometry.Depth(0, 2) > 0 && TrenchGeometry.Depth(0, 2) < TrenchGeometry.Depth(0, 1), "sloped side wall");
var slope = new TrenchGeometry.Pose("slope", 0, 0, 0, 0, .3f, 1 / MathF.Cos(.3f), 2, 1);
Check(Math.Abs(TrenchGeometry.Local(slope, 6, 0).X - 6) < .00001f, "inclined source stretch preserves horizontal footprint");
for (var level = 0; level <= 5; level++)
{
    var section = TrenchGeometry.Build(level);
    foreach (var surface in new[] { section.Earth, section.Wood, section.Sandbags })
    {
        Check(surface.Vertices.Count == surface.Normals.Count && surface.Vertices.Count == surface.Uvs.Count && surface.Vertices.Count % 3 == 0, "complete vertex channels");
        Check(surface.Vertices.All(v => float.IsFinite(v.X + v.Y + v.Z)), "finite trench mesh");
        for (var i = 0; i < surface.Vertices.Count; i += 3)
        {
            var cross = Vector3.Cross(surface.Vertices[i + 1] - surface.Vertices[i], surface.Vertices[i + 2] - surface.Vertices[i]);
            if (Vector3.Dot(cross, surface.Normals[i]) >= 0) throw new InvalidOperationException("Godot clockwise winding");
        }
    }
    Check(section.Earth.Vertices.Min(v => v.Y) <= -1.54f, "actual below-ground geometry");
    Check(section.Earth.Vertices.All(v => Math.Abs(v.X) <= 9.76f), "eighteen metre cutout plus bounded three-quarter-metre overlap geometry");
}
var atlas = new TrenchCutoutAtlas();
var poses = new[] {
    new TrenchGeometry.Pose("negative-boundary", -32, -32, 0, 0, 0, 1, 2, 1),
    new TrenchGeometry.Pose("rotated", 112, 49, 0, MathF.PI / 3, 0, 1.1f, 4, 1),
    new TrenchGeometry.Pose("distant", 3500, -2700, 0, -.7f, 0, 1, 1, 1),
};
atlas.Build(poses);
Check(atlas.TileCount >= 3 && atlas.Size <= 512, "sparse far apart trenches do not allocate a whole-map texture");
foreach (var pose in poses)
{
    Check(atlas.Sample(pose.X, pose.Z), "cutout at trench center");
    Check(!atlas.Sample(pose.X + 20, pose.Z + 20), "terrain retained outside trench");
}
foreach (var pose in poses)
    for (var i = -10; i <= 10; i++)
        for (var j = -5; j <= 5; j++)
        {
            // Read at world pixel centres: the GPU and CPU must agree on negative tile boundaries and rotation.
            var x = MathF.Floor((pose.X + i) * 4) / 4 + .125f;
            var z = MathF.Floor((pose.Z + j) * 4) / 4 + .125f;
            Check(atlas.Sample(x, z) == poses.Any(p => TrenchGeometry.Contains(p, x, z)), "atlas matches exact capsule at raster sample centre");
        }
Check(!atlas.Sample(0, 0) && !atlas.Sample(-8200, 0), "unoccupied and out-of-world tiles stay closed");
var full = Enumerable.Range(0, 240).Select(i => new TrenchGeometry.Pose(i.ToString(), -3900 + i % 30 * 256 + 31.9f, -3500 + i / 30 * 256 + 31.9f, 0, .5f, 0, 1, 3, 1)).ToArray();
var timer = System.Diagnostics.Stopwatch.StartNew();
atlas.Build(full);
timer.Stop();
var fullAtlas = new { milliseconds = timer.Elapsed.TotalMilliseconds, tileCount = atlas.TileCount, size = atlas.Size, bytes = atlas.Mask.Length + atlas.Index.Length, rasterizedTexels = atlas.RasterizedTexels };
Check(atlas.Size <= 4096 && atlas.Mask.Length <= 16 * 1024 * 1024, "240 dispersed sections fit explicit atlas budget");
Check(full.All(p => atlas.Sample(p.X, p.Z)), "all 240 sections represented without hidden caps");
atlas.Build(Array.Empty<TrenchGeometry.Pose>());
Check(atlas.TileCount == 0 && !atlas.Sample(-32, -32), "removed trenches close original holes");
var sectionChecks = checks;
Check(Math.Abs(TrenchGeometry.Depth(-9, 0, 1, true) - TrenchGeometry.FullDepth) < .00001f && Math.Abs(TrenchGeometry.Depth(9, 0, 1, true) - TrenchGeometry.FullDepth) < .00001f, "internal connector has full depth at both open ends");
Check(TrenchGeometry.Depth(-9, 0, 1, true, true) == 0 && TrenchGeometry.Depth(9, 0, 1, true, false, true) == 0, "source section rim joins outer link ramps without a depth step");
Check(Math.Abs(TrenchGeometry.Depth(9, 0, 1, true, true) - TrenchGeometry.Depth(-9, 0, 1, true)) < .00001f, "entry piece meets internal piece at the same depth");
Check(Math.Abs(TrenchGeometry.Depth(9, 0, 1, true) - TrenchGeometry.Depth(-9, 0, 1, true, false, true)) < .00001f, "internal piece meets exit piece at the same depth");
Check(TrenchGeometry.Depth(0, 0, 0, true) == 0 && TrenchGeometry.Depth(0, 2.2f, 1, true) == 0, "connector progress and side boundaries retain solid ground");
Check(TrenchGeometry.Depth(-8, 0, 1, true, true) > 0 && TrenchGeometry.Depth(-8, 0, 1, true, true) < TrenchGeometry.Depth(-4, 0, 1, true, true), "outer connector ramp descends monotonically");
foreach (var variant in new[] { (Start: false, End: false), (Start: true, End: false), (Start: false, End: true), (Start: true, End: true) })
{
    var geometry = TrenchGeometry.Build(2, true, variant.Start, variant.End);
    foreach (var surface in new[] { geometry.Earth, geometry.Wood, geometry.Sandbags })
    {
        Check(surface.Vertices.Count == surface.Normals.Count && surface.Vertices.Count == surface.Uvs.Count && surface.Vertices.Count % 3 == 0, "connector vertex channels are complete");
        Check(surface.Vertices.All(v => float.IsFinite(v.X + v.Y + v.Z)), "connector vertices are finite");
        for (var i = 0; i < surface.Vertices.Count; i += 3)
            if (Vector3.Dot(Vector3.Cross(surface.Vertices[i + 1] - surface.Vertices[i], surface.Vertices[i + 2] - surface.Vertices[i]), surface.Normals[i]) >= 0)
                throw new InvalidOperationException("Connector Godot clockwise winding");
    }
    Check(geometry.Earth.Vertices.Min(v => v.Y) <= -1.54f, "connector has an excavated floor");
    Check(Enumerable.Range(0, geometry.Earth.Vertices.Count / 3).All(i =>
        !Enumerable.Range(0, 3).All(j => Math.Abs(geometry.Earth.Vertices[i * 3 + j].X - 9.75f) < .00001f) &&
        !Enumerable.Range(0, 3).All(j => Math.Abs(geometry.Earth.Vertices[i * 3 + j].X + 9.75f) < .00001f)), "connector earth does not close either endpoint with a wall");
}
var connectorTriangleCounts = new List<int>();
foreach (var widthScale in new[] { 1f, .45f })
{
    var geometry = TrenchGeometry.Build(2, true, false, false, widthScale);
    var worldOverlap = geometry.Earth.Vertices.Max(v => Math.Abs(v.Z)) * widthScale - TrenchGeometry.HalfWidth * widthScale;
    Check(worldOverlap >= .749f, "both source link widths retain at least 0.75m world-space overlap geometry");
    Check(geometry.Earth.Vertices.Where(v => Math.Abs(v.X) <= 9 && Math.Abs(v.Z) <= 1.55f).All(v => Math.Abs(v.Y + TrenchGeometry.FullDepth) < .00001f), "connector mesh knots keep the central floor at the analytical depth");
    foreach (var variant in new[] { (Start: false, End: false), (Start: true, End: false), (Start: false, End: true), (Start: true, End: true) })
    {
        var mesh = TrenchGeometry.Build(2, true, variant.Start, variant.End, widthScale);
        var triangles = (mesh.Earth.Vertices.Count + mesh.Wood.Vertices.Count + mesh.Sandbags.Vertices.Count) / 3;
        connectorTriangleCounts.Add(triangles);
        Check(triangles <= 900, "connector template stays within the 900 triangle budget per six metre piece");
    }
}
var connectorPoses = new[] {
    new TrenchGeometry.Pose("link-entry", 0, 0, 0, 0, 0, 1f / 3, 2, 1, true, 1, true),
    new TrenchGeometry.Pose("link-exit", 6, 0, 0, 0, 0, 1f / 3, 2, 1, true, .45f, false, true),
    new TrenchGeometry.Pose("link-rotated", -31.9f, 31.9f, 2, .73f, .22f, .4f / MathF.Cos(.22f), 2, 1, true, .45f),
};
atlas.Build(connectorPoses);
Check(atlas.Sample(2.875f, .125f) && atlas.Sample(3.125f, .125f), "adjacent connector pieces leave no solid seam");
Check(atlas.Sample(5.875f, .875f) && !atlas.Sample(5.875f, 1.125f), "narrow connector mask uses its actual width");
Check(TrenchGeometry.Contains(connectorPoses[0], 2.8f, 1.5f), "connector footprint keeps its full rectangular width near an endpoint");
Check(!TrenchGeometry.Contains(connectorPoses[0], 3.1f, 0), "connector does not cut terrain beyond its source endpoint");
foreach (var pose in connectorPoses)
    for (var i = -5; i <= 5; i++)
        for (var j = -3; j <= 3; j++)
        {
            var x = MathF.Floor((pose.X + i) * 4) / 4 + .125f;
            var z = MathF.Floor((pose.Z + j) * 4) / 4 + .125f;
            Check(atlas.Sample(x, z) == connectorPoses.Any(p => TrenchGeometry.Contains(p, x, z)), "connector atlas matches rotated, narrow and negative-grid footprints");
        }
atlas.Build(Array.Empty<TrenchGeometry.Pose>());
Check(!atlas.Sample(3.125f, .125f), "removed connector closes its old cutout");
var graphNodes = Enumerable.Range(0, 240).Select(i => new TrenchGeometry.Pose("node-" + i, -1140 + i % 20 * 120, -660 + i / 20 * 120, 0, 0, 0, 1, 2, 1)).ToArray();
var graphLinks = new List<(int A, int B)>();
for (var i = 0; i < graphNodes.Length; i++)
{
    if (i % 20 < 19) graphLinks.Add((i, i + 1));
    if (i / 20 < 11) graphLinks.Add((i, i + 20));
}
for (var i = 0; graphLinks.Count < 480 && i < graphNodes.Length; i++)
    if (i % 20 < 19 && i / 20 < 11) graphLinks.Add((i, i + 21));
var graphPoses = graphNodes.ToList();
foreach (var link in graphLinks)
{
    var a = graphNodes[link.A]; var b = graphNodes[link.B];
    var dx = b.X - a.X; var dz = b.Z - a.Z; var length = MathF.Sqrt(dx * dx + dz * dz);
    Check(length <= 180, "conservative art stress link respects the 180 metre upper span bound");
    var count = (int)Math.Ceiling(length / 6);
    for (var part = 0; part < count; part++)
    {
        var t = (part + .5f) / count;
        graphPoses.Add(new TrenchGeometry.Pose($"link-{link.A}-{link.B}-{part}", a.X + dx * t, a.Z + dz * t, 0, -MathF.Atan2(dz, dx), 0, length / count / 18, 2, 1, true, part % 5 == 0 ? .45f : 1, part == 0, part == count - 1));
    }
}
timer.Restart(); atlas.Build(graphPoses); timer.Stop();
var graphAtlas = new { milliseconds = timer.Elapsed.TotalMilliseconds, sections = graphNodes.Length, links = graphLinks.Count, pieces = graphPoses.Count - graphNodes.Length, tileCount = atlas.TileCount, tilePixels = atlas.TilePixels, size = atlas.Size, bytes = atlas.Mask.Length + atlas.Index.Length, rasterizedTexels = atlas.RasterizedTexels };
Check(graphLinks.Count == 480 && graphNodes.Length == 240, "conservative art stress uses the complete bounded section/link counts");
Check(atlas.Size <= 4096 && atlas.Mask.Length <= 16 * 1024 * 1024 && atlas.TilePixels is 64 or 32, "adaptive texel density fits conservative art stress within the same memory budget");
Check(graphNodes.All(p => atlas.SampleLinear(p.X, p.Z)), "all conservative art stress sections retain an interpolated opening");
foreach (var pose in graphPoses.Where(p => p.Connector).Where((_, i) => i % 37 == 0))
    Check(atlas.SampleLinear(pose.X, pose.Z), "coarser signed-distance sampling preserves connector centers");
Dictionary<(int X, int Z), byte[]> WorldTiles(TrenchCutoutAtlas source)
{
    var result = new Dictionary<(int X, int Z), byte[]>();
    var columns = source.Size / source.TilePixels;
    for (var z = 0; z < TrenchCutoutAtlas.IndexSize; z++)
        for (var x = 0; x < TrenchCutoutAtlas.IndexSize; x++)
        {
            var index = (z * TrenchCutoutAtlas.IndexSize + x) * 2;
            var slot = source.Index[index] + (source.Index[index + 1] << 8) - 1;
            if (slot < 0) continue;
            var pixels = new byte[source.TilePixels * source.TilePixels];
            var ox = slot % columns * source.TilePixels; var oz = slot / columns * source.TilePixels;
            for (var row = 0; row < source.TilePixels; row++)
                Buffer.BlockCopy(source.Mask, (oz + row) * source.Size + ox, pixels, row * source.TilePixels, source.TilePixels);
            result[(x - TrenchCutoutAtlas.IndexOffset, z - TrenchCutoutAtlas.IndexOffset)] = pixels;
        }
    return result;
}
var originalIndex = atlas.Index.ToArray(); var originalMask = atlas.Mask.ToArray();
timer.Restart(); atlas.Build(graphPoses); timer.Stop();
var repeatedAtlas = new { milliseconds = timer.Elapsed.TotalMilliseconds, cacheHits = atlas.CacheHits, dirtyTiles = atlas.DirtyTiles, rasterizedTexels = atlas.RasterizedTexels };
Check(atlas.CacheHits == atlas.TileCount && atlas.DirtyTiles == 0 && atlas.RasterizedTexels == 0, "unchanged dense layout reuses every raster tile");
Check(originalIndex.SequenceEqual(atlas.Index) && originalMask.SequenceEqual(atlas.Mask), "unchanged layout preserves exact mask and page table bytes");
var beforeTiles = WorldTiles(atlas);
var beforeGroups = graphPoses.GroupBy(TrenchGeometry.BatchKey).ToDictionary(group => group.Key, group => group.ToArray());
var sectionProgressOnly = graphPoses.ToArray(); sectionProgressOnly[0] = sectionProgressOnly[0] with { Progress = .5f };
var changedGroupKeys = sectionProgressOnly.GroupBy(TrenchGeometry.BatchKey).Where(group => !beforeGroups.TryGetValue(group.Key, out var previous) || !TrenchGeometry.SamePoses(group, previous)).Select(group => group.Key).ToArray();
var groupCacheCheck = new { changedGroups = changedGroupKeys.Length, changedConnectorGroups = changedGroupKeys.Count(key => key.Connector), reusedGroups = beforeGroups.Count - changedGroupKeys.Length };
Check(changedGroupKeys.Length == 1 && changedGroupKeys.All(key => !key.Connector), "one section progress edit leaves all connector group buffers reusable");
var modified = graphPoses.ToArray(); var changedIndex = graphNodes.Length + 40; var changed = modified[changedIndex];
modified[changedIndex] = changed with { X = changed.X + .75f };
timer.Restart(); atlas.Build(modified); timer.Stop();
var singlePieceUpdate = new { milliseconds = timer.Elapsed.TotalMilliseconds, cacheHits = atlas.CacheHits, dirtyTiles = atlas.DirtyTiles, rasterizedTexels = atlas.RasterizedTexels };
Check(atlas.DirtyTiles <= 8 && atlas.CacheHits > atlas.TileCount * .95 && atlas.RasterizedTexels < graphAtlas.rasterizedTexels / 20, "single moved piece only rasterizes its small dirty tile neighbourhood");
var afterTiles = WorldTiles(atlas); var unaffected = 0;
foreach (var (key, pixels) in beforeTiles)
{
    var centerX = (key.X + .5f) * TrenchCutoutAtlas.TileWorld; var centerZ = (key.Z + .5f) * TrenchCutoutAtlas.TileWorld;
    if (Math.Abs(centerX - changed.X) < 64 && Math.Abs(centerZ - changed.Z) < 64) continue;
    Check(afterTiles.TryGetValue(key, out var current) && pixels.SequenceEqual(current), "a local edit preserves exact signed-distance bytes in every distant world tile");
    unaffected++;
}
Check(unaffected > atlas.TileCount * .9, "local update byte comparison covers the great majority of packed tiles");
var added = modified.Append(new TrenchGeometry.Pose("extra-art-stress-section", -1500, -850, 0, .4f, 0, 1, 2, 1)).ToArray();
timer.Restart(); atlas.Build(added); timer.Stop();
var singleSectionAdded = new { milliseconds = timer.Elapsed.TotalMilliseconds, cacheHits = atlas.CacheHits, dirtyTiles = atlas.DirtyTiles, rasterizedTexels = atlas.RasterizedTexels };
Check(atlas.DirtyTiles <= 8 && atlas.CacheHits > atlas.TileCount * .95 && atlas.RasterizedTexels < graphAtlas.rasterizedTexels / 20, "one extra conservative art section does not rerasterize the complete layout");
Check(atlas.SampleLinear(-1500, -850), "newly inserted section appears after cached layout repacking");
atlas.Build(new[] { new TrenchGeometry.Pose("tile-crossing", 32, 0, 0, 0, 0, 1, 2, 1, true, .45f) });
Check(atlas.SampleLinear(31.99f, 0) && atlas.SampleLinear(32.01f, 0), "bilinear SDF remains open across a world tile boundary");
Check(!atlas.SampleLinear(32, 1.3f), "bilinear SDF preserves ground beside a narrow connector");
Check(atlas.Mask.Any(value => value > 0 && value < 127) && atlas.Mask.Any(value => value > 128 && value < 255), "cutouts carry signed distance rather than a binary mask");
Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { passed = true, checks, sectionChecks, connectorChecks = checks - sectionChecks, connectorTriangleCounts, groupCacheCheck, fullAtlas, graphAtlas, repeatedAtlas, singlePieceUpdate, singleSectionAdded, graphStress = "Conservative count/span art upper bound only; not a valid source gameplay graph (lateral/topology constraints are not applied)", scope = "CPU geometry, floor ramps, open connector seams, clockwise winding and adaptive cached signed-distance cutouts; no GPU or gameplay claim" }));

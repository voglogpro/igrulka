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
    Check(section.Earth.Vertices.All(v => Math.Abs(v.X) <= 9.26f), "eighteen metre section plus quarter-metre seam collar");
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
Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { passed = true, checks, fullAtlas, scope = "CPU geometry, floor ramps, clockwise winding and sparse cutout addressing; no GPU or gameplay claim" }));

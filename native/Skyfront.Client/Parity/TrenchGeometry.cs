using System.Numerics;

namespace Skyfront.Client.Parity;

/// <summary>Presentation geometry only. Authoritative cover, navigation and unit heights stay in the original game.</summary>
internal static class TrenchGeometry
{
    public const float HalfCore = 6.8f, HalfWidth = 2.2f, HalfLength = 9f, FullDepth = 1.55f;
    public readonly record struct Pose(string Id, float X, float Z, float Y, float Yaw, float Roll, float Stretch, int Level, float Progress);
    public sealed class Surface
    {
        public readonly List<Vector3> Vertices = new(), Normals = new();
        public readonly List<Vector2> Uvs = new();
        public void Triangle(Vector3 a, Vector3 b, Vector3 c, Vector3 facing)
        {
            // Godot's front face is clockwise when viewed from the outward normal.
            if (Vector3.Dot(Vector3.Cross(b - a, c - a), facing) > 0) (b, c) = (c, b);
            var cross = Vector3.Cross(c - a, b - a);
            if (cross.LengthSquared() < 0.00000001f) return;
            var normal = Vector3.Normalize(cross);
            foreach (var v in new[] { a, b, c })
            {
                Vertices.Add(v); Normals.Add(normal); Uvs.Add(new Vector2(v.X, v.Z));
            }
        }
        public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 facing)
        {
            Triangle(a, b, c, facing); Triangle(a, c, d, facing);
        }
    }
    public sealed class Section
    {
        public readonly Surface Earth = new(), Wood = new(), Sandbags = new();
    }
    public static float Smooth(float low, float high, float value)
    {
        var t = Math.Clamp((value - low) / (high - low), 0, 1);
        return t * t * (3 - 2 * t);
    }
    public static float Distance(float along, float across) => MathF.Sqrt(MathF.Pow(Math.Max(0, Math.Abs(along) - HalfCore), 2) + across * across);
    public static float Depth(float along, float across, float progress = 1) =>
        FullDepth * Smooth(0, .75f, progress) * Smooth(0, 2.8f, HalfLength - Math.Abs(along)) * Smooth(0, .65f, HalfWidth - Distance(along, across));
    public static Vector2 Local(Pose pose, float x, float z)
    {
        var c = MathF.Cos(pose.Yaw); var s = MathF.Sin(pose.Yaw);
        var horizontalStretch = pose.Stretch * MathF.Cos(pose.Roll);
        return new Vector2(((x - pose.X) * c - (z - pose.Z) * s) / Math.Max(.001f, horizontalStretch), (x - pose.X) * s + (z - pose.Z) * c);
    }
    public static bool Contains(Pose pose, float x, float z)
    {
        var local = Local(pose, x, z);
        return pose.Progress > 0 && Distance(local.X, local.Y) < HalfWidth;
    }
    private static float Width(float x)
    {
        // A quarter-metre collar covers raster/triangle edge differences at the cut without enlarging its actual footprint.
        const float collar = .25f;
        var width = HalfWidth + collar;
        return Math.Abs(x) <= HalfCore ? width : MathF.Sqrt(Math.Max(0, width * width - MathF.Pow(Math.Abs(x) - HalfCore, 2)));
    }
    private static void Box(Surface surface, Vector3 center, Vector3 size)
    {
        var lo = center - size / 2; var hi = center + size / 2;
        var a = new Vector3(lo.X, lo.Y, lo.Z); var b = new Vector3(hi.X, lo.Y, lo.Z);
        var c = new Vector3(hi.X, lo.Y, hi.Z); var d = new Vector3(lo.X, lo.Y, hi.Z);
        var e = new Vector3(lo.X, hi.Y, lo.Z); var f = new Vector3(hi.X, hi.Y, lo.Z);
        var g = new Vector3(hi.X, hi.Y, hi.Z); var h = new Vector3(lo.X, hi.Y, hi.Z);
        surface.Quad(e, f, g, h, Vector3.UnitY);
        surface.Quad(a, d, c, b, -Vector3.UnitY);
        surface.Quad(a, b, f, e, -Vector3.UnitZ);
        surface.Quad(d, h, g, c, Vector3.UnitZ);
        surface.Quad(a, e, h, d, -Vector3.UnitX);
        surface.Quad(b, c, g, f, Vector3.UnitX);
    }
    public static Section Build(int level)
    {
        var section = new Section();
        // Dense only on the actual eighteen-metre excavation. The surrounding map stays coarse.
        const int samples = 48;
        const float outerHalfLength = HalfLength + .25f;
        float[] bands = { -1, -.88f, -.71f, -.45f, 0, .45f, .71f, .88f, 1 };
        for (var i = 0; i < samples; i++)
        {
            var ax = -outerHalfLength + 2 * outerHalfLength * i / samples;
            var bx = -outerHalfLength + 2 * outerHalfLength * (i + 1) / samples;
            var aw = Width(ax); var bw = Width(bx);
            for (var j = 0; j < bands.Length - 1; j++)
            {
                Vector3 Point(float x, float z) => new(x, -Depth(x, z), z);
                section.Earth.Quad(Point(ax, aw * bands[j]), Point(bx, bw * bands[j]), Point(bx, bw * bands[j + 1]), Point(ax, aw * bands[j + 1]), Vector3.UnitY);
            }
        }
        // Broken, tapered spoil ridges flank the cut; neither end is capped, leaving the entrance ramps open.
        for (var side = -1; side <= 1; side += 2)
        {
            for (var i = 0; i < 19; i++)
            {
                var x = -7.7f + i * .85f;
                var endFade = Smooth(0, 1.8f, HalfLength - Math.Abs(x));
                var inner = side * (HalfWidth - .05f); var outer = side * (HalfWidth + 1.15f);
                var crest = side * (HalfWidth + .4f + MathF.Sin(i * 1.91f) * .09f);
                var h = (.28f + (i % 4) * .06f) * endFade;
                var a = new Vector3(x - .46f, -.035f, inner); var b = new Vector3(x + .46f, -.035f, inner);
                var c = new Vector3(x + .4f, h, crest); var d = new Vector3(x - .4f, h * .9f, crest);
                section.Earth.Quad(a, b, c, d, Vector3.UnitY);
                section.Earth.Quad(d, c, new Vector3(x + .5f, -.04f, outer), new Vector3(x - .5f, -.04f, outer), Vector3.UnitY);
                if (level >= 2 && i % 6 != 2)
                {
                    Box(section.Sandbags, new Vector3(x, .39f * endFade, side * (HalfWidth + .15f)), new Vector3(.78f, .23f, .42f));
                    if (level >= 3 && i % 3 == 0) Box(section.Sandbags, new Vector3(x + .1f, .6f * endFade, side * (HalfWidth + .15f)), new Vector3(.7f, .2f, .39f));
                }
            }
            // Low retaining planks and vertical posts follow the deep wall, not the original flat ground.
            for (var row = 0; row < 4; row++)
                Box(section.Wood, new Vector3(0, -1.3f + row * .31f, side * 1.58f), new Vector3(11.6f, .19f, .1f));
            for (var i = 0; i < 6; i++)
                Box(section.Wood, new Vector3(-5.3f + i * 2.12f, -.77f, side * 1.48f), new Vector3(.16f, 1.48f, .2f));
        }
        // Duckboards leave drainage visible beneath; each end rises into the smooth entrance cut.
        for (var i = 0; i < 24; i++)
        {
            var x = -5.75f + i * .5f;
            Box(section.Wood, new Vector3(x, -FullDepth + .025f, 0), new Vector3(.17f, .05f, 2.4f));
        }
        return section;
    }
}

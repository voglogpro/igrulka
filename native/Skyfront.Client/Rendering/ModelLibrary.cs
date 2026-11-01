using Godot;
using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;

namespace Skyfront.Client.Rendering;

/// <summary>Original native models. Y up, +Z forward, game-world units. Meshes and paint are shared.</summary>
public static class ModelLibrary
{
    private static readonly Dictionary<string, StandardMaterial3D> Paints = new();
    private static readonly BoxMesh Box = new() { Size = Vector3.One };
    private static readonly CylinderMesh Cylinder = new() { TopRadius = 1, BottomRadius = 1, Height = 1, RadialSegments = 12, Rings = 1 };
    private static readonly SphereMesh Sphere = new() { Radius = 1, Height = 2, RadialSegments = 12, Rings = 6 };
    private static readonly PrismMesh Roof = new() { Size = Vector3.One };
    private static readonly Dictionary<string, PackedScene> Imported = new();
    private static readonly StandardMaterial3D VehicleVertexPaint = new() { AlbedoColor = Colors.White, VertexColorUseAsAlbedo = true, Roughness = .82f };
    private sealed class InfantryRig
    {
        public required Node3D LeftLeg, RightLeg, LeftArm, RightArm, UpperBody, Rifle;
    }
    private static readonly ConditionalWeakTable<Node3D, InfantryRig> InfantryRigs = new();
    private static Color Olive(int side) => side % 2 == 0 ? new Color("626b42") : new Color("545b50");
    private static Color Mark(int side) => side % 2 == 0 ? new Color("83b9c6") : new Color("c56953");
    private static StandardMaterial3D Mat(Color color, bool metal = false)
    {
        string key = color.ToHtml() + metal;
        if (!Paints.TryGetValue(key, out var material))
        {
            material = new StandardMaterial3D { AlbedoColor = color, Roughness = metal ? .56f : .88f, Metallic = metal ? .35f : 0 };
            Paints[key] = material;
        }
        return material;
    }
    private static MeshInstance3D Piece(Node3D parent, Mesh mesh, Vector3 p, Vector3 size, Color color, Vector3 rotation = default, bool metal = false)
    {
        var part = new MeshInstance3D { Mesh = mesh, Position = p, Scale = size, Rotation = rotation, MaterialOverride = Mat(color, metal) };
        parent.AddChild(part);
        return part;
    }
    private static void B(Node3D n, float x, float y, float z, float w, float h, float d, Color c, Vector3 r = default) => Piece(n, Box, new(x, y, z), new(w, h, d), c, r);
    private static void C(Node3D n, float x, float y, float z, float radius, float h, Color c, Vector3 r = default) => Piece(n, Cylinder, new(x, y, z), new(radius, h, radius), c, r, true);
    private static readonly Color Rubber = new("202522"), Steel = new("4c5557"), Glass = new("314c56"), Concrete = new("8b897a"), Sand = new("c4b79a"), RoofRed = new("75483b");
    private static Node3D Root(string name) => new() { Name = name };
    private static void Windows(Node3D n, float w, float h, float d, int floors, int bays)
    {
        // Window ribbons use a handful of shared boxes, visible from an RTS camera.
        for (int f = 0; f < floors; f++)
            for (int j = 0; j < bays; j++)
            {
                float x = (j - (bays - 1) * .5f) * (w / (bays + 1));
                float y = 2.8f + f * (h - 3) / Math.Max(1, floors);
                B(n, x, y, d * .501f, 1.8f, 1.7f, .12f, Glass);
                B(n, x, y, -d * .501f, 1.8f, 1.7f, .12f, Glass);
            }
    }
    private static void Stripe(Node3D n, int side, float width, float z, float y = 2) => B(n, 0, y, z, width, .65f, .12f, Mark(side));
    private static bool Has(string key, params string[] words)
    {
        foreach (var w in words)
            if (key.Contains(w, StringComparison.OrdinalIgnoreCase))
                return true;
        return false;
    }

    public static Node3D BuildBuilding(string key, int side) => CollapseBuilding(BuildBuildingParts(key, side));

    private static Node3D CollapseBuilding(Node3D root)
    {
        // Building parts are static. Keep every original primitive and its complete local
        // transform, but issue one instanced draw per shared mesh/material/shadow group.
        var groups = new Dictionary<(Mesh Mesh, Material? Material, GeometryInstance3D.ShadowCastingSetting Shadow, uint Layers), List<Transform3D>>();
        void Collect(Node parent, Transform3D relative)
        {
            foreach (var child in parent.GetChildren())
            {
                Transform3D transform = child is Node3D spatial ? relative * spatial.Transform : relative;
                if (child is MeshInstance3D part && part.Mesh != null)
                {
                    var key = (part.Mesh, part.MaterialOverride, part.CastShadow, part.Layers);
                    if (!groups.TryGetValue(key, out var transforms))
                        groups[key] = transforms = new List<Transform3D>();
                    transforms.Add(transform);
                }
                Collect(child, transform);
            }
        }
        Collect(root, Transform3D.Identity);
        // These nodes have not entered the scene tree, so release them immediately.
        // The returned root retains its identity, transform, visibility and caller scaling.
        foreach (var child in root.GetChildren())
        {
            root.RemoveChild(child);
            child.Free();
        }
        int index = 0;
        foreach (var (key, transforms) in groups)
        {
            var instances = new MultiMesh
            {
                TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
                Mesh = key.Mesh,
                InstanceCount = transforms.Count
            };
            for (int i = 0; i < transforms.Count; i++)
                instances.SetInstanceTransform(i, transforms[i]);
            root.AddChild(new MultiMeshInstance3D
            {
                Name = $"StaticBuildingBatch{index++}",
                Multimesh = instances,
                MaterialOverride = key.Material,
                CastShadow = key.Shadow,
                Layers = key.Layers
            });
        }
        return root;
    }

    private static Node3D BuildBuildingParts(string key, int side)
    {
        key = key.ToLowerInvariant();
        var n = Root(key);
        Color paint = Olive(side);
        if (Has(key, "hq", "headquarter"))
        {
            Color wall = new("414b3c"), roof = new("303a34"), trim = new("737b60");
            B(n, 0, .6f, 0, 54, 1.2f, 52, new Color("66695b"));
            B(n, -5, 7.2f, -3, 34, 13, 29, wall);
            B(n, -5, 1.8f, -3, 35, 2, 30, Steel);
            B(n, -5, 14.2f, -3, 36, 1.4f, 31, roof);
            for (int i = 0; i < 10; i++)
                B(n, -21 + i * 3.5f, 15, -3, .55f, .7f, 30, trim);
            for (int i = 0; i < 5; i++)
            {
                float x = -18 + i * 6.3f;
                B(n, x, 8.3f, 11.6f, 4, 2.6f, .2f, Glass);
                B(n, x, 8.3f, -17.6f, 4, 2.6f, .2f, Glass);
                B(n, x, 6.6f, 11.9f, 4.6f, .45f, .9f, trim);
                B(n, x, 7, 12.1f, .45f, 12, .5f, trim);
            }
            B(n, -4, 4.2f, 11.8f, 5.3f, 6.3f, .35f, Rubber);
            B(n, -4, 8, 13, 9, .6f, 4, roof);
            B(n, -4, 1.8f, 15, 9, 2.4f, 5, Concrete);
            B(n, -4, 1, 18, 11, 1, 3, Concrete);
            B(n, 20, 4.2f, -8, 10, 7, 17, wall);
            B(n, 20, 8, -8, 11, .8f, 18, roof);
            for (int i = 0; i < 6; i++)
                B(n, 20, 5, -14 + i * 2, 10.2f, .5f, .7f, trim);
            C(n, 22, 11, -12, .7f, 6, Steel);
            C(n, 17, 9.2f, -4, 1.6f, 1.8f, Steel);
            B(n, -13, 16, -8, 8, 2, 8, Steel);
            B(n, -13, 17.3f, -8, 6, .6f, 6, trim);
            B(n, -13, 23, -8, .5f, 13, .5f, Steel);
            B(n, -13, 26, -8, 10, .35f, .4f, Steel);
            B(n, -13, 23, -8, 6, .3f, .3f, Steel);
            B(n, 10, 22, -10, .35f, 14, .35f, Steel);
            B(n, 13, 26, -10, 6, 3, .12f, Mark(side));
            foreach (int sign in new[] { -1, 1 })
            {
                for (int i = 0; i < 5; i++)
                {
                    B(n, sign * 25, 3, -22 + i * 10, .4f, 5, .4f, Steel);
                    B(n, sign * 25, 3, -17 + i * 10, .18f, 2.8f, 10, trim);
                }
                for (int i = 0; i < 4; i++)
                {
                    B(n, sign * (9 + i * 4.2f), 1.3f, 23, 4.1f, 2.2f, 2.7f, Sand);
                    B(n, sign * (11 + i * 4), 2.9f, 23, 3.8f, 1.1f, 2.5f, new Color("94896b"));
                }
            }
            Stripe(n, side, 8, 12.3f, 11);
            return n;
        }
        if (Has(key, "silo"))
        {
            B(n, 0, .7f, 0, 31, 1.4f, 31, Concrete);
            C(n, 0, 1.5f, 0, 11, 1, Steel);
            C(n, 0, 2.2f, 0, 10, .5f, paint);
            B(n, 0, 2.6f, 0, .5f, .2f, 18, Concrete);
            B(n, 0, 2.6f, 0, 18, .2f, .5f, Concrete);
            B(n, -11, 4, -10, 8, 7, 8, Concrete);
            B(n, -11, 8, -10, 9, .7f, 9, Steel);
            for (int i = -1; i <= 1; i += 2)
                B(n, i * 12, 1.1f, 12, 1, 2, 1, Sand);
            Stripe(n, side, 5, 14, 1.6f);
            return n;
        }
        if (Has(key, "sam", "launcher", "atgun", "coastgun", "gun"))
        {
            B(n, 0, .6f, 0, 19, 1.2f, 19, Concrete);
            C(n, 0, 1.8f, 0, 5, 2.4f, Steel);
            var turret = Root("Turret");
            turret.Position = new(0, 3.1f, 0);
            n.AddChild(turret);
            if (Has(key, "sam", "launcher"))
            {
                for (int x = -1; x <= 1; x++)
                {
                    B(turret, x * 3, 3, 0, 2.4f, 3, 13, paint, new(-.35f, 0, 0));
                    B(turret, x * 3, 5.25f, 5.6f, 1.8f, 1.8f, .15f, Rubber, new(-.35f, 0, 0));
                }
                B(turret, 0, .5f, 0, 10, 1, 7, paint);
            }
            else
            {
                B(turret, 0, 2, 0, 9, 4, 7, paint);
                C(turret, 0, 2.4f, 8, .6f, 13, Steel, new(Mathf.Pi / 2, 0, 0));
            }
            Stripe(n, side, 5, 7.1f, 1.3f);
            return n;
        }
        if (Has(key, "oilwell"))
        {
            B(n, 0, .5f, 0, 27, 1, 22, Concrete);
            B(n, 0, 2, 0, 7, 3, 9, paint);
            foreach (int sign in new[] { -1, 1 })
                B(n, sign * 2.5f, 7, 0, .8f, 12, .8f, Steel, new(0, 0, sign * .22f));
            B(n, 0, 13, 0, 2, 1, 20, Steel, new(.16f, 0, 0));
            B(n, 0, 10, 8, 1, 7, 1, RoofRed);
            B(n, 0, 6, -7, 4, 5, 3, Steel);
            return n;
        }
        if (Has(key, "oiltank", "refinery", "power"))
        {
            B(n, 0, .6f, 0, 36, 1.2f, 31, Concrete);
            if (Has(key, "oiltank", "refinery"))
            {
                for (int i = -1; i <= 1; i += 2)
                {
                    C(n, i * 8, 7, 0, 6.5f, 13, Sand);
                    C(n, i * 8, 13.7f, 0, 6.7f, .6f, Steel);
                    C(n, i * 8, 2, 0, 6.6f, .4f, Steel);
                }
                B(n, 0, 2, 10, 30, .7f, .7f, RoofRed);
            }
            if (Has(key, "power", "refinery"))
            {
                B(n, 0, 4, -7, 24, 7, 11, paint);
                for (int i = -1; i <= 1; i += 2)
                {
                    C(n, i * 7, 17, -7, 2.4f, 25, Concrete);
                    C(n, i * 7, 28, -7, 2.5f, 2, RoofRed);
                }
                for (int i = 0; i < 3; i++)
                    B(n, -7 + i * 7, 8, 6, 4, 6, 5, Steel);
            }
            return n;
        }
        if (Has(key, "radar"))
        {
            B(n, 0, 3, 0, 16, 6, 13, Sand);
            B(n, 0, 11, 0, 2, 17, 2, Steel);
            Piece(n, Sphere, new(0, 21, 0), new(9, 5, 1.7f), Concrete, new(.3f, 0, 0));
            B(n, 0, 21, 2, 1, 1, 5, Steel);
            return n;
        }
        bool home = Has(key, "housing", "house", "market");
        bool hq = Has(key, "hq", "headquarter");
        bool barrack = Has(key, "barracks", "training");
        bool dock = Has(key, "port", "naval", "patrolbase");
        float width = hq ? 49 : home ? 27 : barrack ? 32 : 38;
        float depth = hq ? 36 : home ? 23 : 30;
        float height = hq ? 22 : home ? 23 : barrack ? 9 : 13;
        B(n, 0, .65f, 0, width + 3, 1.3f, depth + 3, Concrete);
        B(n, 0, height * .5f + 1, 0, width, height, depth, home ? Sand : hq ? new Color("b7b39f") : new Color("8d9385"));
        B(n, 0, 1.8f, 0, width + .4f, 1.2f, depth + .4f, Steel);
        if (home || barrack)
            Piece(n, Roof, new(0, height + 3.4f, 0), new(width + 2, 5, depth + 2), RoofRed);
        else
        {
            B(n, 0, height + 1.3f, 0, width + 1, .8f, depth + 1, Steel);
            for (int i = -1; i <= 1; i++)
                B(n, i * 8, height + 2.6f, -3, 5, 2, 6, Concrete);
        }
        Windows(n, width, height, depth, home ? 4 : hq ? 3 : 1, home ? 5 : 6);
        B(n, 0, 4, depth * .51f, home ? 3 : 7, 6, .3f, Steel);
        B(n, 0, 7.2f, depth * .52f + 1, home ? 5 : 10, .7f, 3, Steel);
        Stripe(n, side, width * .6f, depth * .515f, height - 1);
        if (!home && !hq && !barrack)
        {
            for (int i = -1; i <= 1; i += 2)
            {
                B(n, i * (width * .5f - 4), height + 5, -depth * .3f, 3, 7, 3, RoofRed);
                B(n, i * (width * .5f - 4), height + 8.5f, -depth * .3f, 3.4f, .5f, 3.4f, Steel);
            }
            for (int i = 0; i < 3; i++)
                B(n, -11 + i * 11, 4, depth * .505f, 7, 5, .2f, Rubber);
        }
        if (hq)
        {
            B(n, 0, height + 6, -7, 1, 10, 1, Steel);
            B(n, 3, height + 9, -7, 6, 3, .2f, Mark(side));
        }
        if (dock)
        {
            B(n, 0, .5f, depth * .9f, width + 8, 1, 28, Concrete);
            for (int i = -1; i <= 1; i += 2)
            {
                B(n, i * 17, 11, depth * .8f, 1.3f, 22, 1.3f, RoofRed);
                B(n, i * 17, 21, depth * .8f + 6, 1.2f, 1.2f, 15, RoofRed);
            }
        }
        return n;
    }

    private static Node3D? Asset(string key, int side)
    {
        string path = $"res://Assets/models/{key}.glb";
        if (!Imported.TryGetValue(path, out var scene))
        {
            if (!ResourceLoader.Exists(path))
                return null;
            scene = GD.Load<PackedScene>(path);
            Imported[path] = scene;
        }
        var node = scene.Instantiate<Node3D>();
        node.Name = key;
        // Explicitly enable the GLB's COLOR_0 channel in the Compatibility renderer.
        ApplyVertexPaint(node);
        node.SetMeta("side", side);
        B(node, 0, 3.65f, 4.65f, 3.2f, .18f, 1.15f, Mark(side));
        return node;
    }
    private static void ApplyVertexPaint(Node node)
    {
        if (node is MeshInstance3D mesh)
            mesh.MaterialOverride = VehicleVertexPaint;
        foreach (var child in node.GetChildren())
            ApplyVertexPaint(child);
    }
    public static Node3D BuildVehicle(string key, int side)
    {
        string k = key.ToLowerInvariant();
        if (Has(k, "tank", "leopard"))
        {
            var asset = Asset("leopard", side);
            if (asset != null)
                return asset;
        }
        if (Has(k, "mlrs", "grad", "rocket"))
        {
            var asset = Asset("mlrs", side);
            if (asset != null)
                return asset;
        }
        var n = Root(key);
        Color paint = Olive(side);
        bool truck = Has(k, "truck", "supply", "ammo", "service", "transport", "mog");
        bool missile = Has(k, "sam", "mlrs", "rocket", "missile", "launcher");
        B(n, 0, 2, 0, 7.4f, 2, 13, paint);
        B(n, 0, 1, 0, 6, 1, 12, Steel);
        if (truck || missile)
        {
            for (int s = -1; s <= 1; s += 2)
                for (int i = 0; i < 3; i++)
                    C(n, s * 3.8f, 1.7f, -4 + i * 4, 1.55f, .9f, Rubber, new(0, 0, Mathf.Pi / 2));
            B(n, 0, 4.2f, 4.1f, 6.8f, 4, 4.5f, paint);
            B(n, 0, 4.8f, 6.4f, 5.8f, 1.8f, .12f, Glass);
            B(n, 0, 2.4f, 6.7f, 7.3f, .7f, .5f, Steel);
            B(n, -2.5f, 3, 6.7f, 1, .6f, .12f, Sand);
            B(n, 2.5f, 3, 6.7f, 1, .6f, .12f, Sand);
            if (missile)
                for (int i = -1; i <= 1; i++)
                {
                    B(n, i * 2, 5, -1.8f, 1.7f, 2, 8, paint, new(-.3f, 0, 0));
                    B(n, i * 2, 6.1f, 2.1f, 1.3f, 1.3f, .1f, Rubber, new(-.3f, 0, 0));
                }
            else
            {
                B(n, 0, 4.1f, -2.2f, 6.8f, 4, 7.7f, new Color("77785d"));
                for (int i = 0; i < 4; i++)
                    B(n, 0, 6.2f, -5 + i * 2, 7, .2f, .25f, Steel);
            }
        }
        else
        {
            foreach (int s in new[] { -1, 1 })
            {
                B(n, s * 3.5f, 1.6f, 0, 2.2f, 2.8f, 12, Rubber);
                B(n, s * 3.5f, 3.1f, 0, 2.3f, .7f, 11.5f, paint);
            }
            B(n, 0, 3.2f, 0, 7, 1.3f, 10, paint);
            B(n, 0, 4.4f, -.5f, 5.8f, 2, 6.5f, paint);
            C(n, 0, 4.6f, 7, .4f, 12, Steel, new(Mathf.Pi / 2, 0, 0));
            C(n, 1.3f, 5.6f, -1, .9f, .3f, Steel);
        }
        Stripe(n, side, 3, 6.56f, 3);
        return n;
    }
    public static Node3D BuildInfantry(string key, int side)
    {
        var n = Root(key);
        Color paint = Olive(side);
        Node3D leftLeg = Root("LeftLeg"), rightLeg = Root("RightLeg");
        leftLeg.Position = new(-.5f, 2.1f, 0);
        rightLeg.Position = new(.5f, 2.1f, 0);
        n.AddChild(leftLeg);
        n.AddChild(rightLeg);
        foreach (var leg in new[] { leftLeg, rightLeg })
        {
            B(leg, 0, -.9f, 0, .75f, 1.8f, .8f, paint);
            B(leg, 0, -1.85f, .25f, .9f, .5f, 1.3f, Rubber);
        }
        var upper = Root("UpperBody");
        n.AddChild(upper);
        B(upper, 0, 2.9f, 0, 1.8f, 1.8f, 1.1f, paint);
        B(upper, 0, 2.9f, -.8f, 1.5f, 1.7f, .65f, new Color("5c6048"));
        B(upper, 0, 4.25f, .08f, .95f, .9f, .9f, new Color("b89a76"));
        Piece(upper, Sphere, new(0, 4.65f, 0), new(.75f, .5f, .75f), paint);
        Node3D leftArm = Root("LeftArm"), rightArm = Root("RightArm");
        leftArm.Position = new(-1, 3.65f, 0);
        rightArm.Position = new(1, 3.65f, 0);
        upper.AddChild(leftArm);
        upper.AddChild(rightArm);
        B(leftArm, 0, -.65f, .1f, .5f, 1.4f, .6f, paint);
        B(rightArm, 0, -.65f, .1f, .5f, 1.4f, .6f, paint);
        var rifle = Root("Rifle");
        rifle.Position = new(-.35f, -.6f, .6f);
        rightArm.AddChild(rifle);
        B(rifle, 0, 0, .45f, .28f, .38f, 2.6f, Rubber);
        B(rifle, 0, -.4f, .15f, .25f, .7f, .35f, Steel);
        if (Has(key, "at", "rocket", "manpad"))
            C(upper, -.8f, 3.9f, .6f, .35f, 3.7f, Steel, new(Mathf.Pi / 2, 0, 0));
        InfantryRigs.Add(n, new InfantryRig { LeftLeg = leftLeg, RightLeg = rightLeg, LeftArm = leftArm, RightArm = rightArm, UpperBody = upper, Rifle = rifle });
        AnimateInfantry(n, 0, 0, false);
        return n;
    }
    /// <summary>Visual-only articulated gait. Phase is elapsed visual seconds; motion is normalized 0..1.</summary>
    public static void AnimateInfantry(Node3D root, float phase, float motion, bool firing)
    {
        if (!InfantryRigs.TryGetValue(root, out var rig))
            return;
        float amount = Mathf.Clamp(motion, 0, 1);
        float gait = Mathf.Sin(phase * 9.5f);
        float stride = gait * .64f * amount;
        rig.LeftLeg.Rotation = new(stride, 0, 0);
        rig.RightLeg.Rotation = new(-stride, 0, 0);
        float recoil = firing ? Mathf.Max(0, Mathf.Sin(phase * 36)) * .045f : 0;
        rig.UpperBody.Position = new(0, Mathf.Abs(Mathf.Cos(phase * 9.5f)) * .13f * amount, -recoil);
        rig.UpperBody.Rotation = new(.1f * amount, 0, -stride * .045f);
        rig.LeftArm.Rotation = new(firing ? -1.05f : -.35f - stride * .5f, 0, -.18f);
        rig.RightArm.Rotation = new(firing ? -.85f - recoil : -.35f + stride * .28f, 0, .12f);
        rig.Rifle.Rotation = new(-rig.RightArm.Rotation.X, 0, 0);
    }
    public static Node3D BuildAircraft(string key, int side)
    {
        var n = Root(key);
        Color c = Olive(side);
        bool heli = Has(key, "heli", "helicopter");
        Piece(n, Sphere, new(0, 0, 0), new(2, 1.5f, 7), c);
        Piece(n, Sphere, new(0, .5f, 3), new(1.5f, 1, 2), Glass);
        B(n, 0, 0, -6, 1, 1, 7, c);
        B(n, 0, .8f, -8, .5f, 3, 3, c, new(-.35f, 0, 0));
        if (heli)
        {
            B(n, 0, 2.2f, 0, .4f, 2, .4f, Steel);
            B(n, 0, 3.2f, 0, 20, .2f, .8f, Steel);
            B(n, 0, 3.2f, 0, .8f, .2f, 20, Steel);
            foreach (int s in new[] { -1, 1 })
                B(n, s * 2, -2, 0, .3f, .3f, 9, Steel);
        }
        else
        {
            B(n, 0, 0, -1, 18, .35f, 4, c);
            B(n, 0, .3f, -7, 8, .3f, 2, c);
            foreach (int s in new[] { -1, 1 })
                C(n, s * 4, -.8f, -2, .65f, 5, Steel, new(Mathf.Pi / 2, 0, 0));
        }
        return n;
    }
    public static Node3D BuildShip(string key, int side)
    {
        var n = Root(key);
        bool large = Has(key, "frigate", "base", "destroy");
        float length = large ? 54 : 31;
        float width = large ? 12 : 8;
        Piece(n, Sphere, new(0, .8f, 0), new(width * .5f, 3, length * .5f), new Color("515e62"));
        B(n, 0, 2, 0, width * .85f, 1, length * .79f, new Color("89918b"));
        B(n, 0, 5, -2, width * .65f, 5, length * .3f, Concrete);
        B(n, 0, 8, -.8f, width * .55f, 1.7f, 6, Steel);
        B(n, 0, 8.2f, 2.3f, width * .5f, 1, .15f, Glass);
        B(n, 0, 12, -3, .5f, 10, .5f, Steel);
        B(n, 0, 15, -3, 7, .4f, .5f, Steel);
        C(n, 0, 3.5f, length * .29f, 2.6f, 2, Olive(side));
        C(n, 0, 4.1f, length * .36f, .35f, 7, Steel, new(Mathf.Pi / 2, 0, 0));
        if (large)
            for (int i = -1; i <= 1; i += 2)
                B(n, i * 3, 4, -length * .22f, 3, 2, 7, Olive(side), new(-.2f, 0, 0));
        Stripe(n, side, width * .7f, length * .39f, 2.5f);
        return n;
    }
}

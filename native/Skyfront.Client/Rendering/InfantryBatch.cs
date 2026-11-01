using Godot;
using System;
using System.Collections.Generic;

namespace Skyfront.Client.Rendering;

/// <summary>Articulated infantry using shared mesh/material MultiMeshes instead of per-soldier draw calls.</summary>
public partial class InfantryBatch : Node3D
{
    private const int Steps = 16;
    private sealed class Group
    {
        public required MultiMeshInstance3D Node;
        public float[] Buffer = Array.Empty<float>();
        public int Count, Capacity;
        public void Add(Transform3D t)
        {
            if (Count == Capacity)
            {
                Capacity = Math.Max(32, Capacity * 2);
                Array.Resize(ref Buffer, Capacity * 12);
            }
            int i = Count++ * 12;
            var b = t.Basis;
            var o = t.Origin;
            Buffer[i] = b.X.X;
            Buffer[i + 1] = b.Y.X;
            Buffer[i + 2] = b.Z.X;
            Buffer[i + 3] = o.X;
            Buffer[i + 4] = b.X.Y;
            Buffer[i + 5] = b.Y.Y;
            Buffer[i + 6] = b.Z.Y;
            Buffer[i + 7] = o.Y;
            Buffer[i + 8] = b.X.Z;
            Buffer[i + 9] = b.Y.Z;
            Buffer[i + 10] = b.Z.Z;
            Buffer[i + 11] = o.Z;
        }
        public void Upload()
        {
            var mm = Node.Multimesh;
            if (mm.InstanceCount != Capacity)
                mm.InstanceCount = Capacity;
            if (Count > 0)
                mm.Buffer = Buffer;
            mm.VisibleInstanceCount = Count;
        }
    }
    private sealed class Prototype
    {
        public required Group[] Groups;
        public required int[] PartGroups;
        public required Transform3D[][] Poses;
    }
    private readonly Dictionary<(string, int), Prototype> _prototypes = new();
    public void Clear()
    {
        foreach (var prototype in _prototypes.Values)
            foreach (var group in prototype.Groups)
            {
                RemoveChild(group.Node);
                group.Node.QueueFree();
            }
        _prototypes.Clear();
    }
    public void Prepare(string key, int paint)
    {
        if (!_prototypes.ContainsKey((key, paint)))
            _prototypes[(key, paint)] = Create(key, paint);
    }
    public void BeginFrame()
    {
        foreach (var prototype in _prototypes.Values)
            foreach (var group in prototype.Groups)
                group.Count = 0;
    }
    public void Add(string key, int paint, Transform3D world, float phase, float motion, bool firing)
    {
        if (!_prototypes.TryGetValue((key, paint), out var prototype))
            return;
        float clock = phase * 9.5f / Mathf.Tau;
        int step = ((int)Mathf.Floor(clock * Steps) % Steps + Steps) % Steps;
        int pose = firing ? 1 + Steps * 2 + step : motion < .04f ? 0 : 1 + (motion < .55f ? 0 : Steps) + step;
        var transforms = prototype.Poses[pose];
        for (int part = 0; part < transforms.Length; part++)
            prototype.Groups[prototype.PartGroups[part]].Add(world * transforms[part]);
    }
    public void EndFrame()
    {
        foreach (var prototype in _prototypes.Values)
            foreach (var group in prototype.Groups)
                group.Upload();
    }
    private Prototype Create(string key, int paint)
    {
        var template = ModelLibrary.BuildInfantry(key, paint);
        var meshes = new List<MeshInstance3D>();
        CollectMeshes(template, meshes);
        var groups = new List<Group>();
        var lookup = new Dictionary<(ulong, ulong), int>();
        var partGroups = new int[meshes.Count];
        for (int i = 0; i < meshes.Count; i++)
        {
            var part = meshes[i];
            var identity = (part.Mesh.GetInstanceId(), part.MaterialOverride?.GetInstanceId() ?? 0);
            if (!lookup.TryGetValue(identity, out int index))
            {
                index = groups.Count;
                lookup[identity] = index;
                var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = part.Mesh, CustomAabb = new Aabb(new(-6000, -500, -6000), new(12000, 2000, 12000)) };
                var node = new MultiMeshInstance3D { Name = $"Infantry_{key}_{paint}_{index}", Multimesh = mm, MaterialOverride = part.MaterialOverride };
                AddChild(node);
                groups.Add(new Group { Node = node });
            }
            partGroups[i] = index;
        }
        var poses = new Transform3D[1 + Steps * 3][];
        for (int pose = 0; pose < poses.Length; pose++)
        {
            int step = pose == 0 ? 0 : (pose - 1) % Steps;
            float phase = step * Mathf.Tau / (Steps * 9.5f);
            ModelLibrary.AnimateInfantry(template, phase, pose == 0 || pose > Steps * 2 ? 0 : pose <= Steps ? .5f : 1, pose > Steps * 2);
            poses[pose] = new Transform3D[meshes.Count];
            for (int part = 0; part < meshes.Count; part++)
            {
                Transform3D transform = meshes[part].Transform;
                Node parent = meshes[part].GetParent();
                while (parent != template)
                {
                    if (parent is Node3D spatial)
                        transform = spatial.Transform * transform;
                    parent = parent.GetParent();
                }
                poses[pose][part] = transform;
            }
        }
        template.Free();
        return new Prototype { Groups = groups.ToArray(), PartGroups = partGroups, Poses = poses };
    }
    private static void CollectMeshes(Node node, List<MeshInstance3D> meshes)
    {
        if (node is MeshInstance3D mesh)
            meshes.Add(mesh);
        foreach (var child in node.GetChildren())
            CollectMeshes(child, meshes);
    }
}

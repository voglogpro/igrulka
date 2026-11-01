namespace Skyfront.Client.Parity;

/// <summary>
/// Reverse references for resident scene objects. A dirty shared resource visits
/// its actual owners, rather than inspecting every resident JSON descriptor.
/// Contains no Godot objects, so lifecycle behavior can be checked on the CPU.
/// </summary>
internal sealed class SceneResourceOwners
{
    private sealed record Binding(string Geometry, string[] Materials);
    private readonly Dictionary<string, Binding> _bindings = new();
    private readonly Dictionary<string, HashSet<string>> _geometryOwners = new();
    private readonly Dictionary<string, HashSet<string>> _materialOwners = new();

    public int Count => _bindings.Count;

    public void Bind(string id, string geometry, IReadOnlyList<string> materials)
    {
        if (_bindings.TryGetValue(id, out var previous) && previous.Geometry == geometry &&
            SameMaterials(previous.Materials, materials)) return;
        Remove(id);
        _bindings[id] = new Binding(geometry, materials.ToArray());
        AddOwner(_geometryOwners, geometry, id);
        foreach (var material in materials) AddOwner(_materialOwners, material, id);
    }

    public void Remove(string id)
    {
        if (!_bindings.Remove(id, out var binding)) return;
        RemoveOwner(_geometryOwners, binding.Geometry, id);
        foreach (var material in binding.Materials) RemoveOwner(_materialOwners, material, id);
    }

    public void Clear()
    {
        _bindings.Clear();
        _geometryOwners.Clear();
        _materialOwners.Clear();
    }

    // Result is a reusable set, independent from the reverse indices: the caller
    // can apply/rebind its members without invalidating this enumeration.
    public int Collect(IEnumerable<string> geometries, IEnumerable<string> materials,
        ISet<string> excluded, HashSet<string> result)
    {
        result.Clear();
        var visits = 0;
        foreach (var geometry in geometries) CollectOwners(_geometryOwners, geometry);
        foreach (var material in materials) CollectOwners(_materialOwners, material);
        return visits;

        void CollectOwners(Dictionary<string, HashSet<string>> index, string resource)
        {
            if (!index.TryGetValue(resource, out var owners)) return;
            foreach (var id in owners)
            {
                visits++;
                if (!excluded.Contains(id)) result.Add(id);
            }
        }
    }

    private static void AddOwner(Dictionary<string, HashSet<string>> index, string resource, string id)
    {
        if (!index.TryGetValue(resource, out var owners)) index[resource] = owners = new();
        owners.Add(id);
    }

    private static bool SameMaterials(string[] previous, IReadOnlyList<string> materials)
    {
        if (previous.Length != materials.Count) return false;
        for (var i = 0; i < previous.Length; i++)
            if (previous[i] != materials[i]) return false;
        return true;
    }

    private static void RemoveOwner(Dictionary<string, HashSet<string>> index, string resource, string id)
    {
        if (!index.TryGetValue(resource, out var owners)) return;
        owners.Remove(id);
        if (owners.Count == 0) index.Remove(resource);
    }
}

using Skyfront.Client.Parity;

var checks = 0;
void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
    checks++;
}
var index = new SceneResourceOwners();
var found = new HashSet<string>();
var excluded = new HashSet<string>();
void Expect(string[] geometries, string[] materials, params string[] expected)
{
    index.Collect(geometries, materials, excluded, found);
    Check(found.SetEquals(expected), "Exact affected owners: " + string.Join(',', expected));
}
// A typical dirty FX geometry must not visit the 2,544 resident tree objects.
for (var i = 0; i < 2544; i++) index.Bind("tree" + i, "treeGeometry", new[] { "treeMaterial" });
index.Bind("fx", "fxGeometry", new[] { "fxMaterial" });
index.Bind("shared", "fxGeometry", new[] { "fxMaterial", "secondMaterial", "fxMaterial" });
Expect(new[] { "fxGeometry" }, Array.Empty<string>(), "fx", "shared");
Check(index.Collect(new[] { "fxGeometry" }, Array.Empty<string>(), excluded, found) == 2, "Only two reverse references visited");
Expect(Array.Empty<string>(), new[] { "secondMaterial" }, "shared");
Expect(new[] { "fxGeometry" }, new[] { "fxMaterial", "secondMaterial" }, "fx", "shared");
excluded.Add("fx");
Expect(new[] { "fxGeometry" }, new[] { "fxMaterial" }, "shared");
excluded.Clear();
// Redefinition moves both geometry and all material references atomically.
index.Bind("shared", "newGeometry", new[] { "newMaterial", "anotherMaterial" });
Expect(new[] { "fxGeometry" }, new[] { "secondMaterial" }, "fx");
Expect(new[] { "newGeometry" }, Array.Empty<string>(), "shared");
Expect(Array.Empty<string>(), new[] { "newMaterial", "anotherMaterial" }, "shared");
index.Bind("shared", "newGeometry", new[] { "newMaterial", "anotherMaterial" });
Check(index.Count == 2546, "Reapply preserves one exact binding per object");
index.Remove("shared");
index.Remove("shared");
Expect(new[] { "newGeometry" }, new[] { "newMaterial", "anotherMaterial" });
// Visibility/remove is a full source protocol removal; returning objects rebind.
index.Remove("fx");
Expect(new[] { "fxGeometry" }, new[] { "fxMaterial" });
index.Bind("fx", "fxGeometry", new[] { "fxMaterial" });
Expect(new[] { "fxGeometry" }, Array.Empty<string>(), "fx");
// The returned set can be traversed while callers reapply/rebind descriptors.
foreach (var id in found) index.Bind(id, "fxGeometry", new[] { "fxMaterial" });
Expect(new[] { "fxGeometry" }, Array.Empty<string>(), "fx");
index.Clear();
Check(index.Count == 0, "Reset removes all resident bindings");
Expect(new[] { "treeGeometry", "fxGeometry" }, new[] { "treeMaterial", "fxMaterial" });
index.Bind("fx", "afterReset", new[] { "resetMaterial" });
Expect(new[] { "afterReset" }, new[] { "resetMaterial" }, "fx");
Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { passed = true, checks }));

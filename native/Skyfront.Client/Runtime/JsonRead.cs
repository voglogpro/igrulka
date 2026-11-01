using System.Text.Json;
using Godot;

namespace Skyfront.Client.Runtime;

public static class JsonRead
{
    public static JsonElement P(this JsonElement e, string key) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) ? v : default;
    public static float F(this JsonElement e, string key, float fallback = 0) =>
        e.P(key).ValueKind == JsonValueKind.Number && e.P(key).TryGetSingle(out var v) ? v : fallback;
    public static int I(this JsonElement e, string key, int fallback = 0) =>
        e.P(key).ValueKind == JsonValueKind.Number && e.P(key).TryGetInt32(out var v) ? v : fallback;
    public static string S(this JsonElement e, string key, string fallback = "") =>
        e.P(key).ValueKind == JsonValueKind.String ? e.P(key).GetString()! : fallback;
    public static bool B(this JsonElement e, string key) => e.P(key).ValueKind == JsonValueKind.True;
    public static IEnumerable<JsonElement> Items(this JsonElement e) =>
        e.ValueKind == JsonValueKind.Array ? e.EnumerateArray() : Enumerable.Empty<JsonElement>();
    public static Vector3 Point(this JsonElement e, float y = 0) => new(e.F("x"), e.F("y", y), e.F("z"));
}

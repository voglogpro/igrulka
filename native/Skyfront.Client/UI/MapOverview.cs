using Godot;
using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Skyfront.Client.UI;

/// <summary>Cached geographic overview of public snapshot data; never queries hidden simulation state.</summary>
public partial class MapOverview : Control
{
    public event Action<Vector2>? FocusRequested;
    private readonly record struct Blip(Vector2 Position, Color Color, float Radius);
    private readonly List<Blip> _blips = new(180);
    private readonly List<Vector2> _landmarks = new();
    private readonly Vector2[] _footprint = new Vector2[4];
    private ImageTexture? _raster;
    private float _width = 4800, _depth = 4000;
    private Vector2 _cameraCenter;
    private bool _hasFootprint;
    private static readonly Color Friend = new(.25f, .72f, .65f);
    private static readonly Color Enemy = new(.80f, .34f, .29f);
    private readonly StyleBoxFlat _frame = new()
    {
        BgColor = new Color(.075f, .11f, .095f, .96f),
        BorderColor = new Color(.30f, .36f, .29f),
        BorderWidthLeft = 1,
        BorderWidthRight = 1,
        BorderWidthTop = 1,
        BorderWidthBottom = 1
    };
    private Rect2 MapRect => new(new Vector2(7, 24), new Vector2(Mathf.Max(20, Size.X - 14), Mathf.Max(20, Size.Y - 31)));

    public override void _Ready()
    {
        MouseFilter = MouseFilterEnum.Stop;
        TextureFilter = TextureFilterEnum.Nearest;
        Position = new Vector2(20, 110);
        CustomMinimumSize = new Vector2(194, 164);
        Size = new Vector2(194, 164);
    }

    public void ApplyWorld(JsonElement world)
    {
        _landmarks.Clear();
        if (world.TryGetProperty("map", out var map))
        {
            _width = Number(map, "width", 4800);
            _depth = Number(map, "depth", 4000);
        }
        _width = Math.Max(1, _width);
        _depth = Math.Max(1, _depth);
        const int imageWidth = 192, imageHeight = 160;
        var image = Image.CreateEmpty(imageWidth, imageHeight, false, Image.Format.Rgb8);
        image.Fill(new Color(.24f, .30f, .20f));
        if (world.TryGetProperty("heightGrid", out var grid) && grid.TryGetProperty("water", out var water) && water.ValueKind == JsonValueKind.Array)
        {
            int columns = (int)Number(grid, "columns", 0), rows = (int)Number(grid, "rows", 0);
            if (columns > 1 && rows > 1 && (long)columns * rows == water.GetArrayLength())
            {
                var wet = new bool[water.GetArrayLength()];
                int index = 0;
                foreach (var value in water.EnumerateArray())
                    wet[index++] = value.ValueKind == JsonValueKind.True ||
                    (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out int flag) && flag != 0);
                for (int y = 0; y < imageHeight; y++)
                    for (int x = 0; x < imageWidth; x++)
                    {
                        int gx = Mathf.RoundToInt((float)x / (imageWidth - 1) * (columns - 1));
                        int gz = Mathf.RoundToInt((float)y / (imageHeight - 1) * (rows - 1));
                        bool sea = wet[gz * columns + gx];
                        image.SetPixel(x, y, sea ? new Color(.10f, .20f, .24f) : new Color(.25f, .31f, .21f));
                    }
            }
        }
        _raster = ImageTexture.CreateFromImage(image);
        foreach (string name in new[] { "depots", "settlements" })
            if (world.TryGetProperty(name, out var collection) && collection.ValueKind == JsonValueKind.Array)
                foreach (var item in collection.EnumerateArray())
                    if (item.ValueKind == JsonValueKind.Object)
                        _landmarks.Add(Point(item));
        QueueRedraw();
    }

    public void UpdateState(JsonElement state, Camera3D camera)
    {
        _blips.Clear();
        bool coop = state.TryGetProperty("mode", out var mode) && mode.GetString() == "coop";
        if (state.TryGetProperty("sideHQ", out var headquarters) && headquarters.ValueKind == JsonValueKind.Array)
            foreach (var hq in headquarters.EnumerateArray())
                _blips.Add(new Blip(Point(hq), SideColor((int)Number(hq, "side", 0), coop), 3.5f));
        int count = 0;
        foreach (string name in new[] { "groundUnits", "units", "warships" })
        {
            if (!state.TryGetProperty(name, out var units) || units.ValueKind != JsonValueKind.Array)
                continue;
            foreach (var unit in units.EnumerateArray())
            {
                if (count >= 150)
                    break;
                if (unit.ValueKind != JsonValueKind.Object || Number(unit, "hp", 1) <= 0 || Number(unit, "delay", 0) > 0)
                    continue;
                _blips.Add(new Blip(Point(unit), SideColor((int)Number(unit, "side", 0), coop), 1.15f));
                count++;
            }
        }
        Vector3 forward = -camera.GlobalBasis.Z;
        float distance = forward.Y < -.001f ? -camera.GlobalPosition.Y / forward.Y : 0;
        Vector3 focus = camera.GlobalPosition + forward * Mathf.Max(0, distance);
        _cameraCenter = new Vector2(focus.X, focus.Z);
        Vector2 viewport = camera.GetViewport().GetVisibleRect().Size;
        _hasFootprint = viewport.X > 1 && viewport.Y > 1;
        for (int i = 0; i < 4 && _hasFootprint; i++)
        {
            Vector2 screen = new(i is 1 or 2 ? viewport.X : 0, i >= 2 ? viewport.Y : 0);
            Vector3 origin = camera.ProjectRayOrigin(screen), direction = camera.ProjectRayNormal(screen);
            if (direction.Y >= -.001f)
            {
                _hasFootprint = false;
                break;
            }
            Vector3 point = origin + direction * Mathf.Max(0, -origin.Y / direction.Y);
            _footprint[i] = new Vector2(point.X, point.Z);
        }
        QueueRedraw();
    }

    public override void _Draw()
    {
        DrawStyleBox(_frame, new Rect2(Vector2.Zero, Size));
        DrawString(ThemeDB.FallbackFont, new Vector2(8, 17), "ОБЗОР КАРТЫ", HorizontalAlignment.Left, -1, 11, new Color(.68f, .72f, .62f));
        var map = MapRect;
        if (_raster != null)
            DrawTextureRect(_raster, map, false);
        foreach (var landmark in _landmarks)
            DrawCircle(ToMap(landmark), 1.3f, new Color(.64f, .61f, .42f));
        foreach (var blip in _blips)
            if (Mathf.Abs(blip.Position.X) <= _width / 2 && Mathf.Abs(blip.Position.Y) <= _depth / 2)
                DrawCircle(ToMap(blip.Position), blip.Radius, blip.Color);
        if (_hasFootprint)
            for (int i = 0; i < 4; i++)
                DrawLine(ToMap(_footprint[i]), ToMap(_footprint[(i + 1) % 4]), new Color(.87f, .86f, .69f, .7f), 1);
        Vector2 center = ToMap(_cameraCenter);
        DrawLine(center - new Vector2(3, 0), center + new Vector2(3, 0), Colors.White, 1);
        DrawLine(center - new Vector2(0, 3), center + new Vector2(0, 3), Colors.White, 1);
    }

    public override void _GuiInput(InputEvent @event)
    {
        if (@event is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left })
        {
            Vector2 local = GetLocalMousePosition();
            var rect = MapRect;
            if (rect.HasPoint(local))
            {
                Vector2 uv = (local - rect.Position) / rect.Size;
                FocusRequested?.Invoke(new Vector2((uv.X - .5f) * _width, (uv.Y - .5f) * _depth));
            }
            AcceptEvent();
        }
    }

    private Vector2 ToMap(Vector2 position)
    {
        var rect = MapRect;
        return rect.Position + new Vector2(Mathf.Clamp(position.X / _width + .5f, 0, 1), Mathf.Clamp(position.Y / _depth + .5f, 0, 1)) * rect.Size;
    }
    private static Color SideColor(int side, bool coop) => side == 0 || (coop && side == 2) ? Friend : Enemy;
    private static Vector2 Point(JsonElement item) => new(Number(item, "x", 0), Number(item, "z", 0));
    private static float Number(JsonElement item, string name, float fallback) => item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetSingle(out var number) && float.IsFinite(number) ? number : fallback;
}

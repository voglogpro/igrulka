using Godot;
using System;
using System.Text.Json;

namespace Skyfront.Client.Rendering;

/// <summary>Local visual rain volume. Weather and animation clock come from simulation snapshots.</summary>
public partial class WeatherView : Node3D
{
    private const int Capacity = 900;
    private MultiMeshInstance3D _rain = null!;
    private ShaderMaterial _material = null!;
    private AudioStreamPlayer? _recording;
    private bool _muted;
    private float _amount;
    private float _clock, _snapshotClock;
    private bool _paused = true;

    public override void _Ready()
    {
        ProcessMode = ProcessModeEnum.Always;
        _material = new ShaderMaterial { Shader = GD.Load<Shader>("res://Shaders/rain.gdshader") };
        var mesh = new QuadMesh { Size = new Vector2(.19f, 4.8f), Material = _material };
        var batch = new MultiMesh
        {
            TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
            UseCustomData = true,
            Mesh = mesh,
            InstanceCount = Capacity,
            VisibleInstanceCount = 0
        };
        var random = new RandomNumberGenerator { Seed = 81671 };
        for (int i = 0; i < Capacity; i++)
        {
            var position = new Vector3(random.RandfRange(-220, 220), random.RandfRange(0, 180), random.RandfRange(-220, 220));
            batch.SetInstanceTransform(i, new Transform3D(Basis.Identity, position));
            batch.SetInstanceCustomData(i, new Color(random.Randf(), random.Randf(), random.Randf(), 1));
        }
        _rain = new MultiMeshInstance3D
        {
            Name = "LocalRain",
            Multimesh = batch,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
            CustomAabb = new Aabb(new Vector3(-250, -10, -250), new Vector3(500, 220, 500))
        };
        AddChild(_rain);
        const string path = "res://Assets/audio/rain.ogg";
        if (ResourceLoader.Exists(path))
        {
            var stream = GD.Load<AudioStreamOggVorbis>(path);
            stream.Loop = true;
            _recording = new AudioStreamPlayer { Name = "RecordedRain", Stream = stream, VolumeDb = -28 };
            AddChild(_recording);
        }
    }

    public void SetMuted(bool muted)
    {
        _muted = muted;
        if (muted)
            _recording?.Stop();
    }

    public void UpdateState(JsonElement state, Camera3D camera)
    {
        if (_rain == null)
            return;
        _amount = 0;
        bool storm = false;
        if (state.TryGetProperty("weather", out var weather) && weather.ValueKind == JsonValueKind.Object)
        {
            string kind = weather.TryGetProperty("kind", out var value) ? value.GetString() ?? "clear" : "clear";
            storm = kind == "storm";
            if (kind is "rain" or "storm")
                _amount = Mathf.Clamp(Number(weather, "amount", 0), 0, 1);
        }
        Vector3 forward = -camera.GlobalBasis.Z;
        float groundDistance = forward.Y < -.08f ? Mathf.Clamp(-camera.GlobalPosition.Y / forward.Y, 0, 5000) : 250;
        Vector3 anchor = camera.GlobalPosition + forward * groundDistance;
        anchor.Y = 0;
        // Instances and culling volume follow the observed battlefield, not the sky or whole map.
        _rain.GlobalPosition = anchor;
        _rain.Multimesh.VisibleInstanceCount = Mathf.RoundToInt(Capacity * _amount * (storm ? 1 : .72f));
        _rain.Visible = _amount > .005f;
        _clock = _snapshotClock = Number(state, "time", 0);
        _material.SetShaderParameter("simulation_time", _clock);
        _material.SetShaderParameter("rain_amount", _amount);
        _material.SetShaderParameter("anchor_height", anchor.Y);
        _material.SetShaderParameter("wind", storm ? 3.2f : 1.4f);
        bool paused = state.TryGetProperty("paused", out var pause) && pause.ValueKind == JsonValueKind.True;
        _paused = paused;
        if (_recording != null)
        {
            _recording.StreamPaused = paused;
            if (_muted || _amount < .01f)
                _recording.Stop();
            else
            {
                _recording.VolumeDb = Mathf.LinearToDb(Mathf.Max(.001f, _amount * .055f));
                if (!_recording.Playing)
                    _recording.Play();
                _recording.StreamPaused = paused;
            }
        }
    }

    public override void _Process(double delta)
    {
        if (_paused || _amount < .005f || _material == null)
            return;
        // Smooth between 5 Hz snapshots, but stop after a missing update instead of free-running.
        _clock = Mathf.Min(_clock + (float)delta, _snapshotClock + .25f);
        _material.SetShaderParameter("simulation_time", _clock);
    }

    private static float Number(JsonElement element, string name, float fallback) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetSingle(out var number) && float.IsFinite(number) ? number : fallback;
}

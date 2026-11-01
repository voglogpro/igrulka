using Godot;
using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Skyfront.Client.Audio;

/// <summary>Bounded playback of existing recordings; no synthesis or gameplay ownership.</summary>
public partial class NativeAudio : Node3D
{
    private readonly Dictionary<string, AudioStream> _samples = new();
    private readonly Dictionary<string, AudioStream> _loops = new();
    private readonly Dictionary<string, string> _families = new();
    private readonly HashSet<long> _seen = new();
    private readonly Queue<long> _seenOrder = new();
    private readonly List<AudioStreamPlayer3D> _shots = new();
    private readonly List<LoopVoice> _engines = new();
    private readonly Dictionary<string, Vector3> _previousPositions = new();
    private readonly Dictionary<string, double> _lastClass = new();
    private bool _muted, _paused, _requestedPaused, _primed;
    private double _lastTime = -1;
    private int _nextShot;

    private sealed class LoopVoice
    {
        public required AudioStreamPlayer3D Player;
        public string Id = "", Sample = "";
        public Vector3 Target;
    }
    private readonly record struct EngineCandidate(string Id, string Sample, Vector3 Position, float Distance);

    public override void _Ready()
    {
        ProcessMode = ProcessModeEnum.Always;
        foreach (string name in new[] { "rocket-launch", "cruise-launch", "ballistic-launch", "artillery-shot",
            "prop-engine", "fpv-rotor", "truck-engine", "missile-flight", "missile-approach", "impact-recording", "rifle-recording" })
        {
            string path = $"res://Assets/audio/{name}.wav";
            if (!ResourceLoader.Exists(path))
            {
                GD.PushWarning($"Native audio recording missing: {path}");
                continue;
            }
            var stream = GD.Load<AudioStream>(path);
            _samples[name] = stream;
            if (name is "prop-engine" or "fpv-rotor" or "truck-engine" or "missile-flight")
            {
                if (stream.Duplicate() is AudioStreamWav loop)
                {
                    loop.LoopMode = AudioStreamWav.LoopModeEnum.Forward;
                    loop.LoopBegin = 0;
                    loop.LoopEnd = (int)(loop.GetLength() * loop.MixRate);
                    _loops[name] = loop;
                }
            }
        }
        for (int i = 0; i < 24; i++)
            _shots.Add(CreatePlayer($"RecordingVoice{i}", 0));
        for (int i = 0; i < 8; i++)
            _engines.Add(new LoopVoice { Player = CreatePlayer($"EngineVoice{i}", -13) });
    }

    private AudioStreamPlayer3D CreatePlayer(string name, float volume)
    {
        var player = new AudioStreamPlayer3D
        {
            Name = name,
            UnitSize = 250,
            MaxDistance = 8000,
            VolumeDb = volume,
            MaxDb = 0,
            PanningStrength = 0.75f
        };
        AddChild(player);
        return player;
    }

    public void ConfigureWorld(JsonElement world)
    {
        _families.Clear();
        if (world.TryGetProperty("catalogs", out var catalogs) && catalogs.TryGetProperty("weapons", out var weapons))
            foreach (var weapon in weapons.EnumerateObject())
                _families[weapon.Name] = Text(weapon.Value, "family");
        Reset();
    }

    public void SetMuted(bool muted)
    {
        _muted = muted;
        if (muted)
            StopAll();
    }

    public void SetPaused(bool paused)
    {
        _requestedPaused = paused;
        ApplyPause(paused);
    }

    private void ApplyPause(bool paused)
    {
        _paused = paused;
        foreach (var player in _shots)
            player.StreamPaused = paused;
        foreach (var voice in _engines)
            voice.Player.StreamPaused = paused;
    }

    public void Consume(JsonElement state, Camera3D camera)
    {
        double time = Number(state, "time", 0);
        if (time < _lastTime)
            Reset();
        _lastTime = time;
        bool statePaused = state.TryGetProperty("paused", out var paused) && paused.ValueKind == JsonValueKind.True;
        ApplyPause(statePaused || _requestedPaused);
        bool audible = !_muted && !_paused;
        if (state.TryGetProperty("events", out var events) && events.ValueKind == JsonValueKind.Array)
            foreach (var entry in events.EnumerateArray())
            {
                long id = (long)Number(entry, "id", -1);
                if (id < 0 || !_seen.Add(id))
                    continue;
                _seenOrder.Enqueue(id);
                while (_seenOrder.Count > 2048)
                    _seen.Remove(_seenOrder.Dequeue());
                // First snapshot/load/resume never replays historical ring-buffer events.
                if (!_primed || !audible || time - Number(entry, "time", time) > 0.8)
                    continue;
                PlayEvent(entry, time);
            }
        _primed = true;
        if (!audible)
            return;

        var candidates = new List<EngineCandidate>();
        var positions = new Dictionary<string, Vector3>();
        foreach (string collection in new[] { "units", "groundUnits", "serviceVehicles", "ammoVehicles" })
        {
            if (!state.TryGetProperty(collection, out var units) || units.ValueKind != JsonValueKind.Array)
                continue;
            foreach (var unit in units.EnumerateArray())
            {
                if (Number(unit, "hp", 1) <= 0)
                    continue;
                string key = Text(unit, "key"), id = collection + ":" + Number(unit, "id", -1);
                Vector3 position = EntityPosition(unit);
                positions[id] = position;
                string sample;
                if (collection == "units")
                {
                    if (Number(unit, "delay", 0) > 0 || Text(unit, "status") is "falling" or "airburst")
                        continue;
                    string family = Family(key);
                    sample = family == "drone" ? (key == "heavy" ? "prop-engine" : "fpv-rotor") : "missile-flight";
                }
                else
                {
                    if (collection == "groundUnits" && key is not ("supplytruck" or "apc" or "armoredcar" or "mlrs" or "leopard" or "heavytank" or "lighttank" or "ifv" or "tankdestroyer" or "howitzer"))
                        continue;
                    bool moving = unit.TryGetProperty("moving", out var movingField) && movingField.ValueKind == JsonValueKind.True;
                    moving |= _previousPositions.TryGetValue(id, out var previous) && previous.DistanceSquaredTo(position) > 0.25f;
                    if (!moving)
                        continue;
                    sample = "truck-engine";
                }
                if (!_loops.ContainsKey(sample))
                    continue;
                float distance = camera.GlobalPosition.DistanceSquaredTo(position);
                if (distance < 8000 * 8000)
                    candidates.Add(new EngineCandidate(id, sample, position, distance));
            }
        }
        _previousPositions.Clear();
        foreach (var pair in positions)
            _previousPositions[pair.Key] = pair.Value;
        candidates.Sort((a, b) => a.Distance.CompareTo(b.Distance));
        if (candidates.Count > 6)
            candidates.RemoveRange(6, candidates.Count - 6);
        var desired = new HashSet<string>();
        foreach (var candidate in candidates)
            desired.Add(candidate.Id);
        foreach (var voice in _engines)
            if (!desired.Contains(voice.Id))
            {
                voice.Player.Stop();
                voice.Id = "";
                voice.Sample = "";
            }
        foreach (var candidate in candidates)
        {
            var voice = _engines.Find(v => v.Id == candidate.Id) ?? _engines.Find(v => v.Id.Length == 0);
            if (voice == null)
                continue;
            voice.Target = candidate.Position;
            if (voice.Id != candidate.Id || voice.Sample != candidate.Sample || !voice.Player.Playing)
            {
                voice.Id = candidate.Id;
                voice.Sample = candidate.Sample;
                voice.Player.Stream = _loops[candidate.Sample];
                voice.Player.GlobalPosition = candidate.Position;
                voice.Player.VolumeDb = candidate.Sample == "missile-flight" ? -16 : -13;
                voice.Player.StreamPaused = false;
                voice.Player.Play();
            }
        }
    }

    public override void _Process(double delta)
    {
        if (_paused || _muted)
            return;
        foreach (var voice in _engines)
            if (voice.Id.Length > 0)
                voice.Player.GlobalPosition = voice.Player.GlobalPosition.Lerp(voice.Target, (float)(1 - Math.Exp(-delta * 14)));
    }

    private void PlayEvent(JsonElement entry, double time)
    {
        string type = Text(entry, "type"), key = Text(entry, "key"), shooter = Text(entry, "shooter");
        string sample = "";
        if (type == "launch")
        {
            string family = Family(key);
            if (family == "drone")
                return;
            sample = family == "ballistic" ? "ballistic-launch" : family == "cruise" ? "cruise-launch" : "rocket-launch";
        }
        else if (type == "navalShot")
            sample = "artillery-shot";
        else if (type == "shot")
        {
            if (key == "sam" || shooter == "mlrs")
                sample = "rocket-launch";
            else if (shooter == "howitzer")
                sample = "artillery-shot";
            else if (key == "gun")
                sample = "rifle-recording";
        }
        else if (type is "impact" or "crash" or "destroy" or "groundDestroyed" ||
            (type == "intercept" && Text(entry, "mode") != "fall"))
            sample = "impact-recording";
        if (sample.Length == 0 || !_samples.TryGetValue(sample, out var stream))
            return;
        if (_lastClass.TryGetValue(sample, out double last) && time - last < 0.075)
            return;
        _lastClass[sample] = time;
        var player = _shots.Find(p => !p.Playing) ?? _shots[_nextShot++ % _shots.Count];
        player.Stop();
        player.Stream = stream;
        player.GlobalPosition = EntityPosition(entry);
        player.VolumeDb = sample == "artillery-shot" ? -2 : -4;
        player.PitchScale = 1;
        player.StreamPaused = false;
        player.Play();
    }

    private string Family(string key) => _families.TryGetValue(key, out var family) ? family : key switch
    {
        "drone" or "heavy" => "drone",
        "cruise" or "stealth" => "cruise",
        "ballistic" or "tactical" or "cluster" => "ballistic",
        _ => "rocket"
    };

    private void Reset()
    {
        StopAll();
        _seen.Clear();
        _seenOrder.Clear();
        _lastClass.Clear();
        _previousPositions.Clear();
        _primed = false;
        _lastTime = -1;
    }
    private void StopAll()
    {
        foreach (var player in _shots)
            player.Stop();
        foreach (var voice in _engines)
        {
            voice.Player.Stop();
            voice.Id = "";
            voice.Sample = "";
        }
    }
    private static Vector3 EntityPosition(JsonElement item) => new((float)Number(item, "x", 0), (float)Number(item, "y", 3), (float)Number(item, "z", 0));
    private static double Number(JsonElement item, string name, double fallback) => item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number) ? number : fallback;
    private static string Text(JsonElement item, string name) => item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
}

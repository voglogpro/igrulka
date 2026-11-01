using Godot;
using System.Text.Json;

public partial class EngineProbe : Node3D
{
    public override void _Ready()
    {
        try
        {
            // Exercise managed Godot bindings and shared, batched 3D resources.
            // A headless run does not render them or measure GPU performance.
            var mesh = new BoxMesh { Size = new Vector3(1, 2, 1) };
            const int chunks = 4;
            const int perChunk = 128;
            for (var chunk = 0; chunk < chunks; chunk++)
            {
                var instances = new MultiMesh
                {
                    TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
                    Mesh = mesh,
                    InstanceCount = perChunk
                };
                for (var i = 0; i < perChunk; i++)
                    instances.SetInstanceTransform(i, new Transform3D(
                        Basis.Identity, new Vector3(chunk * 100 + i % 16 * 3, 1, i / 16 * 3)));
                AddChild(new MultiMeshInstance3D { Multimesh = instances });
            }
            GD.Print("SKYFRONT_ENGINE_PROBE " + JsonSerializer.Serialize(new
            {
                status = "pass",
                godot = Engine.GetVersionInfo()["string"].AsString(),
                dotnet = System.Environment.Version.ToString(),
                display = DisplayServer.GetName(),
                sharedMeshes = 1,
                multiMeshChunks = chunks,
                instancesCreated = chunks * perChunk,
                gameSimulationTested = false,
                gpuPerformanceMeasured = false
            }));
            GetTree().Quit(0);
        }
        catch (System.Exception error)
        {
            GD.PushError(error.ToString());
            GetTree().Quit(1);
        }
    }
}

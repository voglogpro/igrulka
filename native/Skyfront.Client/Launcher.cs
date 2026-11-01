using Godot;

namespace Skyfront.Client;

public partial class Launcher : Node3D
{
    public override void _Ready()
    {
        // Keep the rejected prototype accessible only for development comparisons.
        AddChild(OS.GetCmdlineUserArgs().Contains("--legacy-prototype") ? new App() : new ParityApp());
    }
}

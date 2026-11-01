using Godot;

namespace Skyfront.Client.Rendering;

public partial class RtsCamera : Camera3D
{
    public Vector3 Focus = new(-1975, 0, 0);
    public float Distance = 310;
    public float Yaw = -Mathf.Pi / 2;
    public float Pitch = 0.78f;
    public bool InputEnabled = true;
    public override void _Ready()
    {
        Far = 9500;
        Near = 1;
        Fov = 52;
        Current = true;
    }
    public override void _Process(double delta)
    {
        var dt = (float)delta;
        if (InputEnabled)
        {
            var direction = new Vector2(
                (Input.IsPhysicalKeyPressed(Key.D) ? 1 : 0) - (Input.IsPhysicalKeyPressed(Key.A) ? 1 : 0),
                (Input.IsPhysicalKeyPressed(Key.S) ? 1 : 0) - (Input.IsPhysicalKeyPressed(Key.W) ? 1 : 0));
            var right = new Vector3(Mathf.Cos(Yaw), 0, -Mathf.Sin(Yaw));
            var back = new Vector3(Mathf.Sin(Yaw), 0, Mathf.Cos(Yaw));
            Focus += (right * direction.X + back * direction.Y) * Distance * dt * 0.85f * (Input.IsPhysicalKeyPressed(Key.Shift) ? 2.2f : 1);
            if (Input.IsPhysicalKeyPressed(Key.Q))
                Yaw += dt;
            if (Input.IsPhysicalKeyPressed(Key.R))
                Yaw -= dt;
        }
        Focus.X = Mathf.Clamp(Focus.X, -2550, 2550);
        Focus.Z = Mathf.Clamp(Focus.Z, -2050, 2050);
        Position = Focus + new Vector3(Mathf.Sin(Yaw) * Mathf.Cos(Pitch), Mathf.Sin(Pitch), Mathf.Cos(Yaw) * Mathf.Cos(Pitch)) * Distance;
        LookAt(Focus, Vector3.Up);
    }
    public void Zoom(float factor) => Distance = Mathf.Clamp(Distance * factor, 55, 2300);
    public Vector3 GroundPoint(Vector2 screen, TerrainView terrain)
    {
        var from = ProjectRayOrigin(screen);
        var dir = ProjectRayNormal(screen);
        if (Mathf.Abs(dir.Y) < .001f)
            return Focus;
        var p = from + dir * (-from.Y / dir.Y);
        for (var i = 0; i < 3; i++)
            p = from + dir * ((Mathf.Max(-1, terrain.GroundHeight(p.X, p.Z)) - from.Y) / dir.Y);
        return p;
    }
}

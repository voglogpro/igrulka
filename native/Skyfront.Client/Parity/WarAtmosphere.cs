using Godot;
using System.Text.Json;
using Skyfront.Client.Runtime;

namespace Skyfront.Client.Parity;

/// <summary>
/// Optional native finishing pass. It reads visual telemetry only and never
/// changes the original simulation, camera controls, lighting or source objects.
/// </summary>
public partial class WarAtmosphere : Node3D
{
    private MeshInstance3D? _fogQuad;
    private ShaderMaterial? _fogMaterial, _finishMaterial;
    private CanvasLayer? _finishLayer;
    private bool _enabled;
    private Camera3D? _camera;

    /// <summary>Off until the original scene has passed parity acceptance.</summary>
    public bool Enabled
    {
        get => _enabled;
        set
        {
            _enabled = value;
            if (_finishLayer != null) _finishLayer.Visible = value;
            if (_fogQuad != null) _fogQuad.Visible = value && _fogAmount > .0001f;
        }
    }
    private float _fogAmount;

    public void Configure(Camera3D camera)
    {
        _camera = camera;
        if (_fogMaterial != null) return;
        _fogMaterial = new ShaderMaterial
        {
            Shader = new Shader { Code = FogShader },
            // Sample the opaque depth first; subsequent source rain, smoke and
            // tracers must remain present instead of being erased by a screen copy.
            RenderPriority = -128
        };
        _fogQuad = new MeshInstance3D
        {
            Name = "OptionalHeightFog",
            Mesh = new QuadMesh { Size = new Vector2(2, 2) },
            MaterialOverride = _fogMaterial,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
            CustomAabb = new Aabb(new Vector3(-20000, -20000, -20000), new Vector3(40000, 40000, 40000)),
            Visible = false
        };
        AddChild(_fogQuad);

        _finishMaterial = new ShaderMaterial { Shader = GD.Load<Shader>("res://Parity/war-atmosphere.gdshader") };
        _finishLayer = new CanvasLayer { Name = "OptionalWarFinish", Layer = 1, Visible = _enabled };
        AddChild(_finishLayer);
        var finish = new ColorRect
        {
            Name = "AtmosphereScreen",
            Color = Colors.White,
            MouseFilter = Control.MouseFilterEnum.Ignore,
            Material = _finishMaterial,
            FocusMode = Control.FocusModeEnum.None
        };
        finish.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
        _finishLayer.AddChild(finish);
    }

    public void Apply(JsonElement frame)
    {
        if (_fogMaterial == null || _finishMaterial == null || _camera == null) return;
        var post = frame.P("environment").P("post");
        var daylight = Mathf.Clamp(post.F("daylight", .1f), 0, 1);
        _fogAmount = Mathf.Clamp(post.F("groundFog"), 0, .35f);
        var tint = BrowserValues.Vector(post.P("fogTint"), new Vector3(.32f, .38f, .40f));
        _fogMaterial.SetShaderParameter("fog_amount", _fogAmount);
        _fogMaterial.SetShaderParameter("fog_color", tint);
        _fogMaterial.SetShaderParameter("far_clip", _camera.Far);
        _fogQuad!.Visible = _enabled && _fogAmount > .0001f;
        _finishMaterial.SetShaderParameter("source_clock", frame.F("time"));
        _finishMaterial.SetShaderParameter("daylight", daylight);
    }

    // GL Compatibility has OpenGL NDC z in [-1,1]. Inverse projection also
    // handles the renderer's chosen/reversed depth mapping without guessing it.
    // Sky/clear depth and high roofs receive no opaque screen-space fog layer.
    private const string FogShader = """
shader_type spatial;
render_mode unshaded, fog_disabled, cull_disabled, depth_test_disabled, depth_draw_never, blend_mix;
uniform sampler2D scene_depth : hint_depth_texture, repeat_disable, filter_nearest;
uniform float fog_amount = 0.0;
uniform vec3 fog_color = vec3(.32,.38,.40);
uniform float far_clip = 9000.0;
uniform float fog_base_height = 3.0;
uniform float fog_height = 14.0;

void vertex() { POSITION = vec4(VERTEX.xy,0.0,1.0); }
void fragment() {
    float depth = texture(scene_depth,SCREEN_UV).r;
    if (depth <= .0000005 || depth >= .9999995) discard;
    vec4 view_h = INV_PROJECTION_MATRIX * vec4(SCREEN_UV*2.0-1.0,depth*2.0-1.0,1.0);
    vec3 view_position = view_h.xyz/view_h.w;
    float distance_to_surface = length(view_position);
    if (distance_to_surface > far_clip*.94) discard;
    vec3 surface = (INV_VIEW_MATRIX*vec4(view_position,1.0)).xyz;
    if (surface.y > fog_base_height+fog_height*5.0) discard;
    vec3 eye = INV_VIEW_MATRIX[3].xyz;
    float height_eye = max(eye.y-fog_base_height,0.0);
    float height_surface = max(surface.y-fog_base_height,0.0);
    float difference = height_eye-height_surface;
    float extinction_eye = exp(-height_eye/fog_height);
    float extinction_surface = exp(-height_surface/fog_height);
    float average_density = abs(difference)<.01
        ? extinction_surface
        : fog_height*(extinction_surface-extinction_eye)/difference;
    // The integral concerns only the thin low layer traversed by this ray.
    // A roof above that layer is not painted through fog behind the building.
    float optical_depth = max(average_density,0.0)*distance_to_surface*fog_amount*.008;
    float alpha = min(.28,1.0-exp(-optical_depth));
    if (alpha<.0001) discard;
    ALBEDO = fog_color;
    ALPHA = alpha;
}
""";
}

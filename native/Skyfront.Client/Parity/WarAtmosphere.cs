using Godot;
using System.Text.Json;
using System.Runtime.CompilerServices;
using Skyfront.Client.Runtime;

namespace Skyfront.Client.Parity;

/// <summary>
/// Native art pass driven only by the original visual telemetry. No independent
/// day clock, gameplay, exposure adaptation, camera controls or source mutation.
/// </summary>
public partial class WarAtmosphere : Node3D
{
    private MeshInstance3D? _fogQuad;
    private ShaderMaterial? _fogMaterial, _finishMaterial;
    private CanvasLayer? _finishLayer;
    private bool _enabled;
    private Camera3D? _camera;
    private sealed class SourceLight
    {
        public float Energy;
        public Color Color;
        public bool Initialized;
    }
    private sealed class SourceEnvironment
    {
        public float AmbientEnergy, FogDensity;
        public bool Initialized;
    }
    private static readonly ConditionalWeakTable<Light3D, SourceLight> SourceLights = new();
    private static readonly ConditionalWeakTable<Godot.Environment, SourceEnvironment> SourceEnvironments = new();

    /// <summary>Disabled by --baseline-graphics for original-renderer A/B.</summary>
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
            Name = "LowGroundAtmosphere",
            Mesh = new QuadMesh { Size = new Vector2(2, 2) },
            MaterialOverride = _fogMaterial,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
            CustomAabb = new Aabb(new Vector3(-20000, -20000, -20000), new Vector3(40000, 40000, 40000)),
            Visible = false
        };
        AddChild(_fogQuad);

        _finishMaterial = new ShaderMaterial { Shader = GD.Load<Shader>("res://Parity/war-atmosphere.gdshader") };
        _finishLayer = new CanvasLayer { Name = "WarFinish", Layer = 1, Visible = _enabled };
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
        // A very thin neutral layer even in clear weather, never an opaque wall.
        // Use the original weather amount rather than a second native simulation.
        _fogAmount = Mathf.Clamp(.015f + post.F("groundFog") * .50f, .015f, .14f);
        var tint = BrowserValues.Vector(post.P("fogTint"), new Vector3(.32f, .38f, .40f));
        _fogMaterial.SetShaderParameter("fog_amount", _fogAmount);
        _fogMaterial.SetShaderParameter("fog_color", tint);
        _fogMaterial.SetShaderParameter("far_clip", _camera.Far);
        _fogQuad!.Visible = _enabled && _fogAmount > .0001f;
        _finishMaterial.SetShaderParameter("source_clock", frame.F("time"));
        _finishMaterial.SetShaderParameter("daylight", daylight);
    }

    /// <summary>
    /// Called AFTER BrowserSceneView applies this frame's original environment
    /// and lights. Every value starts from fresh source data, so energy never
    /// compounds between frames. Source direction/matrices/shadow coverage stay.
    /// </summary>
    public static void ApplyLighting(Godot.Environment environment, IReadOnlyDictionary<string, Light3D> lights,
        JsonElement frame, bool enabled)
    {
        if (!enabled) return;
        var post = frame.P("environment").P("post");
        if (post.ValueKind != JsonValueKind.Object) return;
        var daylight = Mathf.Clamp(post.F("daylight", .1f), 0, 1);
        var day = Mathf.SmoothStep(0, 1, daylight);
        var sourceEnvironment = SourceEnvironments.GetValue(environment, static _ => new SourceEnvironment());
        if (!sourceEnvironment.Initialized)
        {
            sourceEnvironment.AmbientEnergy = environment.AmbientLightEnergy;
            sourceEnvironment.FogDensity = environment.FogDensity;
            sourceEnvironment.Initialized = true;
        }
        var ambientEnergy = 0f;
        var hasAmbient = false;
        foreach (var descriptor in frame.P("lights").Items())
        {
            var type = descriptor.S("type");
            if (type is "ambient" or "hemisphere")
            {
                ambientEnergy += descriptor.F("intensity", 1);
                hasAmbient = true;
            }
            else if (lights.TryGetValue(BrowserValues.Id(descriptor.P("id")), out var light) && light is DirectionalLight3D)
            {
                var source = SourceLights.GetValue(light, static _ => new SourceLight());
                source.Energy = descriptor.F("intensity", 1);
                source.Color = BrowserValues.Color(descriptor.P("color"), Colors.White).LinearToSrgb();
                source.Initialized = true;
            }
        }
        if (hasAmbient) sourceEnvironment.AmbientEnergy = ambientEnergy;
        var sourceFog = frame.P("environment").P("fog");
        if (sourceFog.ValueKind == JsonValueKind.Object)
            sourceEnvironment.FogDensity = sourceFog.F("density");
        var moonAmbient = new Color(.30f, .36f, .44f);
        var dayAmbient = new Color(.54f, .58f, .58f);
        environment.AmbientLightColor = moonAmbient.Lerp(dayAmbient, day);
        // Source daytime hemi+ambient reaches 1.9 before the sun is added. A
        // restrained day fill avoids beige overexposure, retaining the night floor.
        environment.AmbientLightEnergy = sourceEnvironment.AmbientEnergy * Mathf.Lerp(.58f, .38f, day);
        // No auto exposure: flashes and camera pans cannot pump the whole scene.
        environment.TonemapExposure = Mathf.Lerp(1.22f, 1.04f, day);
        if (environment.FogEnabled)
        {
            environment.FogDensity = Math.Min(sourceEnvironment.FogDensity * .18f, .00018f);
            environment.FogLightColor = new Color(.16f, .20f, .25f).Lerp(new Color(.48f, .53f, .54f), day);
        }
        foreach (var light in lights.Values)
        {
            if (light is not DirectionalLight3D) continue;
            var source = SourceLights.GetValue(light, static _ => new SourceLight());
            if (!source.Initialized)
            {
                source.Energy = light.LightEnergy;
                source.Color = light.LightColor;
                source.Initialized = true;
            }
            var sourceColor = source.Color;
            var luminance = sourceColor.R * .2126f + sourceColor.G * .7152f + sourceColor.B * .0722f;
            light.LightColor = sourceColor.Lerp(new Color(luminance, luminance, luminance), .18f);
            light.LightEnergy = source.Energy * Mathf.Lerp(.70f, .50f, day);
            light.LightAngularDistance = .55f;
            // Keep the source's stable single shadow map. No additional lights,
            // shadow cascades, SSR, SDFGI or volumetric passes are introduced.
        }
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
uniform float fog_base_height = 2.3;
uniform float fog_height = 9.5;

void vertex() { POSITION = vec4(VERTEX.xy,1.0,1.0); }
void fragment() {
    float depth = texture(scene_depth,SCREEN_UV).r;
    if (depth <= .0000005 || depth >= .9999995) discard;
    vec4 view_h = INV_PROJECTION_MATRIX * vec4(SCREEN_UV*2.0-1.0,depth*2.0-1.0,1.0);
    vec3 view_position = view_h.xyz/view_h.w;
    float distance_to_surface = length(view_position);
    if (distance_to_surface > far_clip*.94) discard;
    vec3 surface = (INV_VIEW_MATRIX*vec4(view_position,1.0)).xyz;
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
    float alpha = min(.18,1.0-exp(-optical_depth));
    if (alpha<.0001) discard;
    ALBEDO = fog_color;
    ALPHA = alpha;
}
""";
}

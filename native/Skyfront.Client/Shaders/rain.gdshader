shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, shadows_disabled;

uniform float simulation_time = 0.0;
uniform float rain_amount = 0.0;
uniform float anchor_height = 0.0;
uniform float wind = 1.4;
varying float drop_alpha;

void vertex() {
    vec3 center = MODEL_MATRIX[3].xyz;
    float speed = 38.0 + INSTANCE_CUSTOM.r * 13.0;
    center.y = anchor_height + mod(center.y - anchor_height - simulation_time * speed, 180.0);
    center.x += sin(simulation_time * 0.3 + INSTANCE_CUSTOM.g * 6.28) * wind;
    vec4 view_center = VIEW_MATRIX * vec4(center, 1.0);
    vec3 local = VERTEX;
    local.x += local.y * 0.075;
    // Short camera-facing droplets remain separate streaks, never a full-screen stripe layer.
    view_center.xy += local.xy * (0.65 + INSTANCE_CUSTOM.b * 0.65);
    POSITION = PROJECTION_MATRIX * view_center;
    drop_alpha = (0.12 + INSTANCE_CUSTOM.b * 0.12) * rain_amount;
}

void fragment() {
    float across = 1.0 - abs(UV.x * 2.0 - 1.0);
    float along = sin(UV.y * 3.14159265);
    ALBEDO = vec3(0.58, 0.66, 0.68);
    ALPHA = across * along * drop_alpha;
}

shader_type spatial;
render_mode cull_disabled;

uniform sampler2D height_map : filter_linear, repeat_disable;
uniform bool has_height_map = false;
uniform vec2 terrain_origin = vec2(-2400.0, -2000.0);
uniform vec2 terrain_size = vec2(4800.0, 4000.0);
uniform float water_level = 0.0;
varying vec3 world_position;

void vertex() {
    world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
    vec2 position = world_position.xz;
    float ground = water_level - 100.0;
    if (has_height_map) {
        vec2 uv = (position - terrain_origin) / terrain_size;
        // Height samples occupy texel centers, including the field's edge vertices.
        vec2 texture_size = vec2(textureSize(height_map, 0));
        uv = (uv * (texture_size - vec2(1.0)) + vec2(0.5)) / texture_size;
        ground = texture(height_map, uv).r;
        if (ground > water_level + 0.08) { discard; }
    }
    float depth = max(water_level - ground, 0.0);
    float wave_a = sin(position.x * 0.038 + position.y * 0.018 + TIME * 0.7);
    float wave_b = cos(position.y * 0.061 - position.x * 0.013 + TIME * 0.53);
    NORMAL_MAP = normalize(vec3(wave_a * 0.11, wave_b * 0.08, 1.0)) * 0.5 + vec3(0.5);
    vec3 deep = vec3(0.045, 0.13, 0.16);
    vec3 shallow = vec3(0.15, 0.30, 0.29);
    float foam = (1.0 - smoothstep(0.15, 2.2, depth)) * (0.35 + 0.25 * sin(TIME * 1.2 + position.x * 0.08 + position.y * 0.06));
    ALBEDO = mix(mix(shallow, deep, smoothstep(1.0, 25.0, depth)), vec3(0.62, 0.70, 0.61), foam);
    ROUGHNESS = 0.28 + 0.1 * wave_b;
    METALLIC = 0.18;
    SPECULAR = 0.65;
}

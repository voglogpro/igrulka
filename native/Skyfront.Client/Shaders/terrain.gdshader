shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

varying vec3 ground_position;
varying vec3 ground_normal;
uniform sampler2D ground_noise_map : filter_linear_mipmap, repeat_enable;

void vertex() {
    ground_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
    ground_normal = normalize(MODEL_NORMAL_MATRIX * NORMAL);
}

void fragment() {
    vec2 p = ground_position.xz;
    // One cached periodic RGB texture replaces twenty trigonometric hashes per fragment.
    float patch = texture(ground_noise_map, p * (0.012 / 32.0)).r;
    vec3 detail_sample = texture(ground_noise_map, p * (0.31 / 32.0)).rgb;
    float detail = detail_sample.r;
    float fine = texture(ground_noise_map, p * (1.7 / 32.0)).r;
    // COLOR carries explicit sampled shore/rock/grass classification. Height zero is grass.
    vec3 base = COLOR.rgb;
    base *= 0.88 + patch * 0.22 + (detail - 0.5) * 0.10 + (fine - 0.5) * 0.035;
    base += vec3(0.018, 0.007, -0.008) * smoothstep(0.50, 0.85, patch);
    ALBEDO = clamp(base, vec3(0.025), vec3(0.65));
    float dx = detail_sample.g * 2.0 - 1.0;
    float dz = detail_sample.b * 2.0 - 1.0;
    vec3 world_n = normalize(ground_normal + vec3(-dx, 0.0, -dz) * 0.24);
    NORMAL = normalize((VIEW_MATRIX * vec4(world_n, 0.0)).xyz);
    ROUGHNESS = 0.94;
    SPECULAR = 0.12;
}

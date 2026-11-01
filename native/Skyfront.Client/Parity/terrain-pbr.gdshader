shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx, cull_back;

// Shared 1K CC0 Poly Haven materials. No displacement: original CPU heights,
// source picking, coastline, navigation and projectile origins stay unchanged.
uniform sampler2D mud_albedo : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D mud_normal : hint_normal, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D mud_arm : repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D dirt_albedo : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D dirt_normal : hint_normal, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D dirt_arm : repeat_enable, filter_linear_mipmap_anisotropic;
uniform float mud_tile_metres = 1.3;
uniform float dirt_tile_metres = 2.0;
uniform float wetness : hint_range(0.0, 1.0) = 0.0;
uniform float normal_strength : hint_range(0.0, 1.0) = 0.24;
uniform vec3 earth_tint = vec3(0.91, 0.94, 0.94);
uniform bool use_mesh_uv = false;

// Sparse virtual atlas supplied by TrenchPresentation. The 0 index means solid
// ground; all existing terrain outside actual trench footprints stays present.
uniform bool trench_mask_enabled = false;
uniform sampler2D trench_index : repeat_disable, filter_nearest;
uniform sampler2D trench_mask : repeat_disable, filter_linear;
uniform vec2 trench_atlas_size = vec2(128.0);
uniform float trench_tile_world = 32.0;
uniform float trench_tile_pixels = 128.0;
uniform vec2 trench_index_offset = vec2(256.0);

varying vec3 earth_world;
varying vec3 earth_world_normal;
varying float earth_mix;
varying float vegetation_weight;
varying vec2 earth_warp;

float hash_ground(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}

float ground_noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash_ground(i), hash_ground(i + vec2(1.0, 0.0)), f.x),
               mix(hash_ground(i + vec2(0.0, 1.0)), hash_ground(i + vec2(1.0)), f.x), f.y);
}

void vertex() {
    earth_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
    earth_world_normal = normalize(MODEL_NORMAL_MATRIX * NORMAL);
    // Broad irregular zones, rather than a repeating grid or an additional set
    // of texture samples. Domain warp is evaluated only at terrain vertices.
    float broad = ground_noise(earth_world.xz / 410.0 + vec2(13.4, -8.7));
    earth_warp = vec2(broad - 0.5, ground_noise(earth_world.xz / 230.0 + vec2(-31.2, 19.1)) - 0.5);
    vec2 warped = earth_world.xz + earth_warp * 82.0;
    earth_mix = ground_noise(warped / 145.0) * 0.64 + broad * 0.36;
    vegetation_weight = clamp((COLOR.g - (COLOR.r + COLOR.b) * 0.5) * 2.0, 0.0, 1.0);
}

void fragment() {
    if (trench_mask_enabled) {
        vec2 virtual_tile = floor(earth_world.xz / trench_tile_world) + trench_index_offset;
        vec2 index_size = vec2(textureSize(trench_index, 0));
        if (all(greaterThanEqual(virtual_tile, vec2(0.0))) && all(lessThan(virtual_tile, index_size))) {
            vec2 code = floor(texture(trench_index, (virtual_tile + 0.5) / index_size).rg * 255.0 + 0.5);
            float tile = code.r + code.g * 256.0 - 1.0;
            if (tile >= 0.0) {
                float columns = trench_atlas_size.x / trench_tile_pixels;
                vec2 tile_xy = vec2(mod(tile, columns), floor(tile / columns));
                // Do not interpolate across unrelated physical atlas tiles.
                vec2 pixel = clamp(fract(earth_world.xz / trench_tile_world) * trench_tile_pixels,
                                   vec2(0.5), vec2(trench_tile_pixels - 0.5));
                vec2 atlas_uv = (tile_xy * trench_tile_pixels + pixel) / trench_atlas_size;
                if (texture(trench_mask, atlas_uv).r > 0.5) discard;
            }
        }
    }

    vec2 metres = use_mesh_uv ? UV : earth_world.xz;
    // Independent orientations and phases keep the two source tiles from
    // reinforcing the same diagonal repeated bump pattern.
    const mat2 mud_rotation = mat2(vec2(0.921061, 0.389418), vec2(-0.389418, 0.921061));
    const mat2 dirt_rotation = mat2(vec2(0.362358, -0.932039), vec2(0.932039, 0.362358));
    vec2 mud_uv = mud_rotation * metres / mud_tile_metres + vec2(17.23, 4.13) + earth_warp * 1.7;
    vec2 dirt_uv = dirt_rotation * metres / dirt_tile_metres + vec2(-9.27, 31.7) - earth_warp * 0.9;
    // Broad photo variation avoids a one-metre diagonal carpet from the RTS
    // camera. Keep all PBR maps aligned, and retain the conservative normal
    // visibility budget below instead of adding distant texture fetches.
    mud_uv *= 0.17;
    dirt_uv *= 0.17;
    float blend = smoothstep(0.23, 0.79, earth_mix);
    // Filter by cycles per pixel, not metres per pixel. A 1.3m tile occupying
    // only a handful of pixels must not keep a strong high-frequency normal.
    vec2 metre_dx = dFdx(metres);
    vec2 metre_dy = dFdy(metres);
    vec3 position_dx = dFdx(earth_world);
    vec3 position_dy = dFdy(earth_world);
    vec2 mud_dx = dFdx(mud_uv);
    vec2 mud_dy = dFdy(mud_uv);
    vec2 dirt_dx = dFdx(dirt_uv);
    vec2 dirt_dy = dFdy(dirt_uv);
    float footprint = max(length(metre_dx), length(metre_dy));
    float cycles_per_pixel = footprint / min(mud_tile_metres, dirt_tile_metres);
    float detail = 1.0 - smoothstep(0.012, 0.075, cycles_per_pixel);
    vec3 mud = texture(mud_albedo, mud_uv).rgb;
    vec3 dirt = texture(dirt_albedo, dirt_uv).rgb;
    vec3 soil = mix(mud, dirt, blend);
    float luminance = dot(soil, vec3(0.2126, 0.7152, 0.0722));
    soil = mix(soil, vec3(luminance), 0.45) * vec3(0.85, 0.93, 0.91);
    vec3 palette = mix(vec3(0.255, 0.265, 0.255), vec3(0.215, 0.240, 0.215), smoothstep(0.28, 0.85, earth_mix));
#if CURRENT_RENDERER != RENDERER_COMPATIBILITY
    // Palette constants are authored as sRGB; the active GL renderer converts
    // ALBEDO to linear itself, whereas Forward+/Mobile expect linear here.
    palette = palette * (palette * (palette * 0.305306011 + 0.682171111) + 0.012522878);
#endif
    // Distant pixels carry the broad earth palette, not a minified carpet of
    // one-metre colour/normal tiles. Texture detail returns smoothly up close.
    soil = mix(palette, soil, mix(0.12, 0.62, detail));
    float macro_value = mix(0.72, 1.17, smoothstep(0.13, 0.87, earth_mix));
    vec3 quiet_grass = mix(vec3(1.0), vec3(0.88, 0.96, 0.84), vegetation_weight * 0.25);
    ALBEDO = soil * earth_tint * quiet_grass * macro_value * (1.0 - wetness * 0.13);

    // At RTS distances skip four fine-detail fetches entirely. This remains one
    // shared material and costs no more samples than the previous close shader.
    AO = 1.0;
    AO_LIGHT_AFFECT = 0.12;
    ROUGHNESS = mix(0.94, 0.82, wetness);
    METALLIC = 0.0;
    SPECULAR = 0.16;
    vec3 n = normalize(earth_world_normal);
    NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
    if (detail > 0.01) {
        // Explicit gradients remain valid across the fine-detail branch edge.
        vec3 arm = mix(textureGrad(mud_arm, mud_uv, mud_dx, mud_dy).rgb, textureGrad(dirt_arm, dirt_uv, dirt_dx, dirt_dy).rgb, blend);
        AO = mix(1.0, mix(0.86, 1.0, arm.r), detail);
        ROUGHNESS = mix(ROUGHNESS, clamp(mix(max(arm.g, 0.80), max(arm.g * 0.86, 0.72), wetness), 0.72, 1.0), detail);
        vec3 mud_n = textureGrad(mud_normal, mud_uv, mud_dx, mud_dy).xyz * 2.0 - 1.0;
        vec3 dirt_n = textureGrad(dirt_normal, dirt_uv, dirt_dx, dirt_dy).xyz * 2.0 - 1.0;
        // Rotate the sampled tangent normals back into the common metre basis.
        mud_n.xy = transpose(mud_rotation) * mud_n.xy;
        dirt_n.xy = transpose(dirt_rotation) * dirt_n.xy;
        vec3 map_normal = normalize(mix(mud_n, dirt_n, blend));
        map_normal.xy *= normal_strength * detail * (1.0 - wetness * 0.15);
        map_normal = normalize(map_normal);
        // Derivative TBN also works with the original tangent-free terrain.
        vec3 dp2_perp = cross(position_dy, n);
        vec3 dp1_perp = cross(n, position_dx);
        vec3 tangent = dp2_perp * metre_dx.x + dp1_perp * metre_dy.x;
        vec3 bitangent = dp2_perp * metre_dx.y + dp1_perp * metre_dy.y;
        float inverse_length = inversesqrt(max(max(dot(tangent, tangent), dot(bitangent, bitangent)), 0.000001));
        vec3 mapped = normalize(tangent * inverse_length * map_normal.x + bitangent * inverse_length * map_normal.y + n * map_normal.z);
        NORMAL = normalize((VIEW_MATRIX * vec4(mapped, 0.0)).xyz);
    }
}

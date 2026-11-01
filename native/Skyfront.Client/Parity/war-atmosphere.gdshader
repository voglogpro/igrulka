shader_type canvas_item;
render_mode unshaded;

// Canvas reads the completed 3D viewport, including transparent source effects.
// This also avoids applying the 3D tonemapper a second time to a copied frame.
uniform sampler2D completed_scene : hint_screen_texture, repeat_disable, filter_linear_mipmap;
uniform float source_clock = 0.0;
uniform float daylight = 0.1;
uniform float bloom_strength : hint_range(0.0, 0.2) = 0.055;
uniform float grain_strength : hint_range(0.0, 0.02) = 0.0020;
uniform float vignette_strength : hint_range(0.0, 0.15) = 0.038;
uniform float grade_strength : hint_range(0.0, 1.0) = 0.26;

uint grain_pcg(uint value) {
    uint state = value * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

float grain_hash(uvec2 pixel, uint frame) {
    // Integer permutation avoids the directional float precision bands produced
    // by sin(dot(pixel,...)) on large dark areas in GL Compatibility.
    uint seed = pixel.x + pixel.y * 374761393u + frame * 668265263u;
    return float(grain_pcg(seed) >> 8u) * (1.0 / 16777216.0);
}

void fragment() {
    vec3 source = textureLod(completed_scene,SCREEN_UV,0.0).rgb;
    // Existing mip levels form a small soft highlight halo without additional
    // viewports, blur targets, lights or per-explosion allocations.
    vec3 near_glow = textureLod(completed_scene,SCREEN_UV,2.0).rgb;
    vec3 middle_glow = textureLod(completed_scene,SCREEN_UV,3.0).rgb;
    vec3 far_glow = textureLod(completed_scene,SCREEN_UV,4.0).rgb;
    vec3 halo = max(near_glow*.5+middle_glow*.32+far_glow*.18-vec3(.62),vec3(0.0));
    float luminance = dot(source,vec3(.2126,.7152,.0722));
    float night = 1.0-clamp(daylight,0.0,1.0);
    vec3 cool_shadows = vec3(.965,.995,1.025);
    vec3 warm_highlights = vec3(1.018,1.004,.985);
    vec3 grade = mix(cool_shadows,warm_highlights,smoothstep(.12,.75,luminance));
    vec3 color = source*mix(vec3(1.0),grade,grade_strength*(.5+night*.5));
    // Quiet, common palette for land, buildings, smoke and armour. Preserve
    // luminance and bright ordnance flashes rather than crushing the whole frame.
    color = mix(color, vec3(dot(color,vec3(.2126,.7152,.0722))),.075);
    color += vec3(.002,.003,.004)*night*(1.0-smoothstep(.0,.28,luminance));
    color += halo*vec3(1.04,.99,.94)*bloom_strength;
    vec2 centered = SCREEN_UV*2.0-1.0;
    float edge = smoothstep(.2,1.75,dot(centered,centered));
    color *= 1.0-edge*vignette_strength;
    uvec2 pixel = uvec2(floor(SCREEN_UV/SCREEN_PIXEL_SIZE));
    uint frame = uint(max(0.0,floor(source_clock*24.0)));
    float grain = grain_hash(pixel,frame)-.5;
    color += grain*grain_strength*(.65+.35*(1.0-luminance));
    COLOR = vec4(clamp(color,vec3(0.0),vec3(1.0)),1.0);
}

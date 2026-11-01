using Godot;
using System.Text.Json;
using Skyfront.Client.Runtime;

namespace Skyfront.Client.Parity;

internal sealed class BrowserTexture
{
    private readonly Dictionary<string, JsonElement> _fields = new();
    public Texture2D? Texture;
    public JsonElement Descriptor;
    public void Update(JsonElement value)
    {
        foreach (var property in value.EnumerateObject())
        if (property.Name != "data")
            _fields[property.Name] = property.Value.Clone();
        Descriptor = JsonSerializer.SerializeToElement(_fields);
        var data = value.S("data");
        if (data.Length == 0)
            return;
        var comma = data.IndexOf(',');
        if (comma < 0)
            throw new InvalidDataException("Texture data URI is invalid");
        var bytes = Convert.FromBase64String(data[(comma + 1)..]);
        var image = new Image();
        var error = data.StartsWith("data:image/jpeg", StringComparison.Ordinal) ? image.LoadJpgFromBuffer(bytes) : image.LoadPngFromBuffer(bytes);
        if (error != Error.Ok)
            throw new InvalidDataException("Cannot decode browser texture: " + error);
        image.GenerateMipmaps();
        Texture = ImageTexture.CreateFromImage(image);
    }
}

internal sealed class BrowserMaterial
{
    private readonly Dictionary<string, JsonElement> _fields = new();
    private static readonly Dictionary<string, Shader> Shaders = new();
    private readonly Dictionary<(bool, int), Material> _variants = new();
    public Material Material = null!;
    public bool VertexColors => B("vertexColors");
    public string Type => Get("type").ValueKind == JsonValueKind.String ? Get("type").GetString()! : "standard";
    private JsonElement Get(string key) => _fields.GetValueOrDefault(key);
    private float F(string key, float fallback) => Get(key).ValueKind == JsonValueKind.Number && Get(key).TryGetSingle(out var value) ? value : fallback;
    private bool B(string key, bool fallback = false) => Get(key).ValueKind == JsonValueKind.Undefined ? fallback : Get(key).ValueKind == JsonValueKind.True;
    private string S(string key, string fallback = "") => Get(key).ValueKind == JsonValueKind.String ? Get(key).GetString()! : fallback;
    public void Update(JsonElement value, Dictionary<string, BrowserTexture> textures)
    {
        foreach (var property in value.EnumerateObject())
        {
            if (property.Name == "uniforms" && _fields.TryGetValue("uniforms", out var old) && old.ValueKind == JsonValueKind.Object)
            {
                var merged = old.EnumerateObject().ToDictionary(x => x.Name, x => x.Value.Clone());
                foreach (var p in property.Value.EnumerateObject())
                    merged[p.Name] = p.Value.Clone();
                _fields[property.Name] = JsonSerializer.SerializeToElement(merged);
            }
            else
                _fields[property.Name] = property.Value.Clone();
        }
        if (Type is "particle" or "streak" or "scar" or "weather" or "sky" or "infantry")
        {
            var mode = Type + (S("blending") == "additive" ? ":add" : ":mix");
            if (!Shaders.TryGetValue(mode, out var shader))
            {
                shader = Type == "infantry" ? GD.Load<Shader>("res://Parity/infantry-art.gdshader") : new Shader { Code = ShaderCode(Type, S("blending") == "additive") };
                Shaders[mode] = shader;
            }
            if (Material is not ShaderMaterial custom || custom.Shader != shader)
            {
                _variants.Clear();
                Material = custom = new ShaderMaterial { Shader = shader };
            }
            if (Get("uniforms").ValueKind == JsonValueKind.Object)
                foreach (var uniform in Get("uniforms").EnumerateObject())
                {
                    var raw = uniform.Value;
                    if (raw.ValueKind == JsonValueKind.Number)
                        custom.SetShaderParameter(uniform.Name, raw.GetSingle());
                    else if (raw.ValueKind == JsonValueKind.Array)
                    {
                        var a = BrowserValues.Floats(raw);
                        if (a.Length == 2)
                            custom.SetShaderParameter(uniform.Name, new Vector2(a[0], a[1]));
                        else if (a.Length == 3)
                            custom.SetShaderParameter(uniform.Name, new Vector3(a[0], a[1], a[2]));
                        else if (a.Length == 4)
                            custom.SetShaderParameter(uniform.Name, new Vector4(a[0], a[1], a[2], a[3]));
                    }
                    else if (raw.P("texture").ValueKind != JsonValueKind.Undefined && textures.TryGetValue(BrowserValues.Id(raw.P("texture")), out var texture) && texture.Texture != null)
                        custom.SetShaderParameter(uniform.Name, texture.Texture);
                }
            return;
        }
        if (Material is not StandardMaterial3D standard)
        {
            _variants.Clear();
            Material = standard = new StandardMaterial3D();
        }
        ApplyStandard(standard, textures);
        foreach (var (key, variant) in _variants)
        {
            var copy = (StandardMaterial3D)variant;
            ApplyStandard(copy, textures);
            copy.DisableReceiveShadows = !key.Item1;
            copy.RenderPriority = key.Item2;
        }
    }
    private void ApplyStandard(StandardMaterial3D standard, Dictionary<string, BrowserTexture> textures)
    {
        standard.DisableReceiveShadows = false;
        standard.RenderPriority = 0;
        var color = BrowserValues.Color(Get("color"), Colors.White).LinearToSrgb();
        color.A = F("opacity", 1);
        standard.AlbedoColor = color;
        standard.Roughness = F("roughness", 1);
        standard.Metallic = F("metalness", 0);
        standard.ShadingMode = Type is "basic" or "sprite" or "line" ? BaseMaterial3D.ShadingModeEnum.Unshaded : BaseMaterial3D.ShadingModeEnum.PerPixel;
        // The mesh cache omits COLOR when the source material disables it. Keeping
        // this enabled also preserves Three's independent InstancedMesh.instanceColor.
        standard.VertexColorUseAsAlbedo = true;
        standard.VertexColorIsSrgb = false;
        standard.CullMode = S("side") switch
        {
            "double" => BaseMaterial3D.CullModeEnum.Disabled,
            "back" => BaseMaterial3D.CullModeEnum.Front,
            _ => BaseMaterial3D.CullModeEnum.Back
        };
        standard.NoDepthTest = !B("depthTest", true);
        standard.DepthDrawMode = B("depthWrite", true) ? BaseMaterial3D.DepthDrawModeEnum.OpaqueOnly : BaseMaterial3D.DepthDrawModeEnum.Disabled;
        standard.Transparency = F("alphaTest", 0) > 0 ? BaseMaterial3D.TransparencyEnum.AlphaScissor : B("transparent") || color.A < 1 ? BaseMaterial3D.TransparencyEnum.Alpha : BaseMaterial3D.TransparencyEnum.Disabled;
        standard.AlphaScissorThreshold = F("alphaTest", .5f);
        standard.BlendMode = S("blending") == "additive" ? BaseMaterial3D.BlendModeEnum.Add : BaseMaterial3D.BlendModeEnum.Mix;
        standard.DisableFog = !B("fog", true);
        standard.TextureFilter = BaseMaterial3D.TextureFilterEnum.LinearWithMipmaps;
        standard.BillboardMode = Type == "sprite" ? BaseMaterial3D.BillboardModeEnum.Enabled : BaseMaterial3D.BillboardModeEnum.Disabled;
        standard.BillboardKeepScale = true;
        var emission = BrowserValues.Color(Get("emissive"), Colors.Black);
        standard.EmissionEnabled = emission.R > 0 || emission.G > 0 || emission.B > 0;
        standard.Emission = emission.LinearToSrgb();
        standard.EmissionEnergyMultiplier = F("emissiveIntensity", 1);
        var maps = Get("maps");
        Texture2D? Map(string name) => maps.P(name).ValueKind != JsonValueKind.Undefined && textures.TryGetValue(BrowserValues.Id(maps.P(name)), out var texture) ? texture.Texture : null;
        standard.AlbedoTexture = Map("map");
        standard.NormalTexture = Map("normalMap");
        standard.NormalEnabled = standard.NormalTexture != null;
        var normalScale = BrowserValues.Floats(Get("normalScale"));
        standard.NormalScale = normalScale.Length > 0 ? normalScale[0] : 1;
        standard.EmissionTexture = Map("emissiveMap");
        standard.MetallicTexture = Map("metalnessMap");
        standard.RoughnessTexture = Map("roughnessMap");
        standard.MetallicTextureChannel = BaseMaterial3D.TextureChannel.Blue;
        standard.RoughnessTextureChannel = BaseMaterial3D.TextureChannel.Green;
        standard.AOTexture = Map("aoMap");
        standard.AOEnabled = standard.AOTexture != null;
        var textureId = maps.P("map");
        if (textureId.ValueKind == JsonValueKind.Undefined)
            textureId = maps.P("normalMap");
        if (textureId.ValueKind != JsonValueKind.Undefined && textures.TryGetValue(BrowserValues.Id(textureId), out var uvTexture))
        {
            var td = uvTexture.Descriptor;
            var repeat = BrowserValues.Floats(td.P("repeat"));
            var offset = BrowserValues.Floats(td.P("offset"));
            var sx = repeat.Length > 0 ? repeat[0] : 1;
            var sy = repeat.Length > 1 ? repeat[1] : 1;
            var ox = offset.Length > 0 ? offset[0] : 0;
            var oy = offset.Length > 1 ? offset[1] : 0;
            // Three uploads flipY textures upside down. Godot ImageTexture retains PNG row order.
            if (td.B("flipY"))
            {
                sy = -sy;
                oy = 1 - oy;
            }
            standard.Uv1Scale = new Vector3(sx, sy, 1);
            standard.Uv1Offset = new Vector3(ox, oy, 0);
            standard.TextureRepeat = td.S("wrapS") != "clamp" || td.S("wrapT") != "clamp";
        }
    }
    public void RefreshTextures(Dictionary<string, BrowserTexture> textures) => Update(JsonSerializer.SerializeToElement(new { }), textures);
    public bool ReferencesTextures(HashSet<string> changed)
    {
        var maps = Get("maps");
        if (maps.ValueKind == JsonValueKind.Object && maps.EnumerateObject().Any(p => changed.Contains(BrowserValues.Id(p.Value))))
            return true;
        var uniforms = Get("uniforms");
        return uniforms.ValueKind == JsonValueKind.Object && uniforms.EnumerateObject().Any(p => p.Value.P("texture").ValueKind != JsonValueKind.Undefined && changed.Contains(BrowserValues.Id(p.Value.P("texture"))));
    }
    public Material ForObject(bool receiveShadow, int renderOrder)
    {
        renderOrder = Math.Clamp(renderOrder, -128, 127);
        if (Material is not StandardMaterial3D standard)
        {
            Material.RenderPriority = renderOrder;
            return Material;
        }
        if (receiveShadow && renderOrder == 0) return standard;
        var key = (receiveShadow, renderOrder);
        if (_variants.TryGetValue(key, out var variant))
            return variant;
        var copy = (StandardMaterial3D)standard.Duplicate();
        copy.DisableReceiveShadows = !receiveShadow;
        copy.RenderPriority = renderOrder;
        _variants[key] = copy;
        return copy;
    }
    private static string ShaderCode(string type, bool additive)
    {
        var header = "shader_type spatial;\nrender_mode unshaded, cull_disabled, depth_draw_never, fog_disabled, " + (additive ? "blend_add" : "blend_mix") + ";\n";
        if (type == "weather")
            return header + """
uniform float time; uniform vec3 center; uniform vec3 box; uniform float amount; uniform vec2 wind; uniform vec2 drift; uniform vec3 tint;
varying float alpha;
void vertex(){ float speed=92.0+COLOR.b*42.0; vec3 p=vec3(COLOR.r*box.x+drift.x,mod(COLOR.g*box.y-speed*time,box.y),COLOR.b*box.z+drift.y);
p.x=center.x+mod(p.x-center.x+box.x*.5,box.x)-box.x*.5;p.z=center.z+mod(p.z-center.z+box.z*.5,box.z)-box.z*.5;
float tail=UV.x*(1.8+COLOR.a*2.0);vec3 world=p-normalize(vec3(wind.x,-speed,wind.y))*tail;
float shown=step(COLOR.a,amount);float edge=1.0-smoothstep(.34,.5,max(abs(world.x-center.x)/box.x,abs(world.z-center.z)/box.z));
alpha=shown*mix(.19,.025,UV.x)*smoothstep(0.0,9.0,world.y)*(1.0-smoothstep(box.y*.8,box.y,world.y))*edge;VERTEX=world;}
void fragment(){if(alpha<.01)discard;ALBEDO=tint;ALPHA=alpha;}
""";
        if (type == "sky")
            return header + """
uniform float daylight=.1;uniform float overcast=0.0;varying vec3 sky_vertex;
void vertex(){sky_vertex=VERTEX;}
void fragment(){vec3 v=normalize(sky_vertex);float h=v.y;vec3 col=mix(vec3(.40,.31,.30),vec3(.075,.13,.23),smoothstep(-.06,.5,h));float glow=pow(max(0.0,dot(v,normalize(vec3(-1.0,.11,-.5)))),24.0);col+=vec3(.40,.17,.065)*glow;vec3 night=mix(vec3(.04,.06,.09),vec3(.008,.018,.042),smoothstep(0.0,.6,h));vec3 day=mix(vec3(.62,.73,.78),vec3(.12,.31,.55),smoothstep(-.1,.7,h));col=mix(night,mix(col,day,smoothstep(.12,.7,daylight)),smoothstep(0.0,.15,daylight));float lum=dot(col,vec3(.3,.5,.2));ALBEDO=mix(col,vec3(lum*.9+.02),overcast*.75);}
""";
        var instance = "varying vec4 tint_alpha;void vertex(){tint_alpha=INSTANCE_CUSTOM;}\n";
        if (type == "streak")
            return header + instance + """
void fragment(){float across=abs(UV.y-.5)*2.0;float core=exp(-across*across*9.0);float halo=(1.0-across*across)*.22;float along=smoothstep(0.0,.75,UV.x)*(1.0-smoothstep(.93,1.0,UV.x));float alpha=(core+halo)*along*tint_alpha.a;if(alpha<.004)discard;ALBEDO=tint_alpha.rgb*(.55+core*.9);ALPHA=alpha;}
""";
        if (type == "scar")
            return header + instance + """
void fragment(){vec2 p=(UV-.5)*2.0;float angle=atan(p.y,p.x);float r=length(p)*(1.0+.045*sin(angle*7.0)+.025*cos(angle*11.0));float bowl=1.0-smoothstep(.28,.78,r);float rim=smoothstep(.65,.8,r)*(1.0-smoothstep(.8,1.0,r));float alpha=(bowl*.48+rim*.23)*tint_alpha.a;if(alpha<.005)discard;ALBEDO=mix(vec3(.075,.066,.052),vec3(.28,.23,.16),rim);ALPHA=alpha;}
""";
        return header + "uniform float kind;uniform float clock;\n" + instance + """
float hash_noise(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash_noise(i),hash_noise(i+vec2(1,0)),f.x),mix(hash_noise(i+vec2(0,1)),hash_noise(i+vec2(1,1)),f.x),f.y);}
void fragment(){vec2 p=(UV-.5)*2.0;float r=length(p);float alpha;if(kind<.5){float n=noise(p*3.0+vec2(clock*.16,clock*.23))*.6+noise(p*7.0)*.25;alpha=(1.0-smoothstep(.1,1.0,r))*(.45+n*.55);}else if(kind<1.5){float n=noise(p*5.0+vec2(0.0,clock*2.0));alpha=exp(-r*r*(3.0+n))*(1.0-smoothstep(.5,1.0,r))*(.55+.45*n);}else{float dust=noise(p*13.0+vec2(clock*.2));float edge=r+(dust-.5)*.045;alpha=smoothstep(.83,.93,edge)*(1.0-smoothstep(.94,1.0,edge))*(.2+.8*dust);}alpha*=tint_alpha.a;if(alpha<.003)discard;ALBEDO=tint_alpha.rgb;ALPHA=alpha;}
""";
    }
}

import * as T from '../../../vendor/three/three.module.js';

// Rain is drawn as thousands of falling streaks inside a box that follows the camera target.
// Position, wrapping and fading all happen in the vertex shader, so the CPU only updates uniforms.
const COUNT = 3600;
const BOX = { x: 900, z: 640, y: 300 };
const vertex = `attribute vec3 aSeed;attribute float aEnd;uniform float time;uniform vec3 center;uniform vec3 box;uniform float amount;uniform vec2 wind;varying float vAlpha;
void main(){
 float speed=118.+aSeed.z*46.;
 vec3 p=vec3(aSeed.x*box.x,aSeed.y*box.y,aSeed.z*box.z);
 vec3 fall=vec3(wind.x,-speed,wind.y)*time;
 p+=fall;
 p=mod(p+box*.5,box)-box*.5;
 float tail=aEnd*(.03+aSeed.z*.012);
 vec3 dir=normalize(vec3(wind.x,-speed,wind.y));
 p-=dir*tail*speed;
 vec3 world=vec3(center.x+p.x,center.y+box.y*.5+p.y,center.z+p.z);
 float shown=step(aSeed.x*.5+.5,amount);
 vAlpha=shown*mix(.2,.03,aEnd)*smoothstep(0.,40.,world.y);
 gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);
}`;
const fragment = `varying float vAlpha;uniform vec3 tint;void main(){if(vAlpha<.01)discard;gl_FragColor=vec4(tint,vAlpha);}`;

// Ground mist: a few low translucent sheets with drifting noise. They lie under the rooftops, so
// fog weather veils the field and the streets while the sky above stays clear.
const MIST_LAYERS = [2.5, 7, 12.5, 19];
const MIST_SIZE = { x: 2200, z: 1700 };
const mistVertex = `varying vec3 vWorld;void main(){vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
const mistFragment = `uniform float time;uniform float amount;uniform float layer;uniform vec3 tint;uniform vec3 center;varying vec3 vWorld;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){
 vec2 p=vWorld.xz*.006+vec2(time*.012*(1.+layer),time*.007);
 float m=n(p)*.55+n(p*2.3+7.1)*.3+n(p*5.1-3.7)*.15;
 m=smoothstep(.28,.85,m);
 vec2 d=abs(vWorld.xz-center.xz)/vec2(${MIST_SIZE.x / 2}.,${MIST_SIZE.z / 2}.);
 float edge=1.-smoothstep(.6,1.,max(d.x,d.y));
 float a=amount*(.06+m*.16)*(1.-layer*.18)*edge;
 if(a<.004)discard;
 gl_FragColor=vec4(tint,a);
}`;

export class WeatherFX {
  constructor(scene) {
    const positions = new Float32Array(COUNT * 2 * 3),
      seeds = new Float32Array(COUNT * 2 * 3),
      ends = new Float32Array(COUNT * 2);
    let s = 1234567;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < COUNT; i++) {
      const x = rnd() * 2 - 1,
        y = rnd() * 2 - 1,
        z = rnd() * 2 - 1;
      for (let end = 0; end < 2; end++) {
        const v = (i * 2 + end) * 3;
        seeds[v] = x;
        seeds[v + 1] = y;
        seeds[v + 2] = z;
        ends[i * 2 + end] = end;
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new T.BufferAttribute(seeds, 3));
    geometry.setAttribute('aEnd', new T.BufferAttribute(ends, 1));
    this.uniforms = {
      time: { value: 0 },
      center: { value: new T.Vector3() },
      box: { value: new T.Vector3(BOX.x, BOX.y, BOX.z) },
      amount: { value: 0 },
      wind: { value: new T.Vector2(6, 2) },
      tint: { value: new T.Color(0.62, 0.7, 0.8) },
    };
    this.rain = new T.LineSegments(
      geometry,
      new T.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = 11;
    scene.add(this.rain);
    // One shared geometry and one shared set of uniforms; the layers differ only by height.
    this.mistUniforms = {
      time: this.uniforms.time,
      center: this.uniforms.center,
      amount: { value: 0 },
      tint: { value: new T.Color('#9aa6ab') },
    };
    const sheet = new T.PlaneGeometry(MIST_SIZE.x, MIST_SIZE.z);
    sheet.rotateX(-Math.PI / 2);
    this.mist = new T.Group();
    MIST_LAYERS.forEach((y, i) => {
      const mesh = new T.Mesh(
        sheet,
        new T.ShaderMaterial({
          uniforms: { ...this.mistUniforms, layer: { value: i / MIST_LAYERS.length } },
          vertexShader: mistVertex,
          fragmentShader: mistFragment,
          transparent: true,
          depthWrite: false,
        }),
      );
      mesh.position.y = y;
      mesh.renderOrder = 10;
      mesh.frustumCulled = false;
      this.mist.add(mesh);
    });
    this.mist.visible = false;
    scene.add(this.mist);
    this.flash = 0;
    this.amount = 0;
    this.misty = 0;
  }
  lightning() {
    this.flash = 1;
  }
  // `rainy` is the strength of falling rain; `misty` is the ground haze (fog weather, a little in
  // rain). `tint` is the current fog colour so the mist matches day and night.
  update(dt, elapsed, target, rainy, misty = 0, tint = null) {
    const k = 1 - Math.exp(-Math.min(0.3, dt) * 3);
    this.amount += (rainy - this.amount) * k;
    this.misty += (misty - this.misty) * k;
    this.rain.visible = this.amount > 0.02;
    this.mist.visible = this.misty > 0.02;
    this.uniforms.time.value = elapsed;
    this.uniforms.center.value.set(target.x, 0, target.z);
    this.uniforms.amount.value = this.amount;
    // Only a light breeze: rain falls nearly straight down and sways slowly.
    this.uniforms.wind.value.set(5 + Math.sin(elapsed * 0.11) * 3, 1.5);
    this.mist.position.set(target.x, 0, target.z);
    this.mistUniforms.amount.value = this.misty;
    if (tint) this.mistUniforms.tint.value.copy(tint).lerp(WHITE, 0.25);
    this.flash = Math.max(0, this.flash - dt * 4.5);
  }
  diagnostics() {
    return {
      rain: this.rain.visible,
      rainAmount: this.amount,
      mist: this.misty,
      flash: this.flash,
    };
  }
}
const WHITE = new T.Color(1, 1, 1);

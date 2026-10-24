import * as T from '../../../vendor/three/three.module.js';

// Rain is drawn as thousands of falling streaks inside a box that follows the camera target.
// Position, wrapping and fading all happen in the vertex shader, so the CPU only updates uniforms.
const COUNT = 5200;
const BOX = { x: 900, z: 640, y: 320 };
const vertex = `attribute vec3 aSeed;attribute float aEnd;uniform float time;uniform vec3 center;uniform vec3 box;uniform float amount;uniform vec2 wind;varying float vAlpha;
void main(){
 float speed=240.+aSeed.z*120.;
 vec3 p=vec3(aSeed.x*box.x,aSeed.y*box.y,aSeed.z*box.z);
 vec3 fall=vec3(wind.x,-speed,wind.y)*time;
 p+=fall;
 p=mod(p+box*.5,box)-box*.5;
 float tail=aEnd*(.016+aSeed.z*.01);
 vec3 dir=normalize(vec3(wind.x,-speed,wind.y));
 p-=dir*tail*speed;
 vec3 world=vec3(center.x+p.x,center.y+box.y*.5+p.y,center.z+p.z);
 float shown=step(aSeed.x*.5+.5,amount);
 vAlpha=shown*mix(.38,.06,aEnd)*smoothstep(0.,40.,world.y);
 gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);
}`;
const fragment = `varying float vAlpha;uniform vec3 tint;void main(){if(vAlpha<.01)discard;gl_FragColor=vec4(tint,vAlpha);}`;

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
      wind: { value: new T.Vector2(40, 12) },
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
    this.flash = 0;
    this.amount = 0;
  }
  lightning() {
    this.flash = 1;
  }
  // `rainy` is the strength of falling rain; fog alone leaves the sky dry.
  update(dt, elapsed, target, rainy) {
    this.amount += (rainy - this.amount) * (1 - Math.exp(-Math.min(0.3, dt) * 3));
    this.rain.visible = this.amount > 0.02;
    this.uniforms.time.value = elapsed;
    this.uniforms.center.value.set(target.x, 0, target.z);
    this.uniforms.amount.value = this.amount;
    this.uniforms.wind.value.set(35 + Math.sin(elapsed * 0.13) * 20, 10);
    this.flash = Math.max(0, this.flash - dt * 4.5);
  }
  diagnostics() {
    return { rain: this.rain.visible, rainAmount: this.amount, flash: this.flash };
  }
}

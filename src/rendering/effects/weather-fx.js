import * as T from '../../../vendor/three/three.module.js';
import { RAIN, weatherStyle, rainWind, rainSeeds } from './weather-style.js';

// Rain is drawn as thousands of falling streaks inside a box that follows the camera target.
// Position, wrapping and fading all happen in the vertex shader, so the CPU only updates uniforms.
const COUNT = RAIN.count;
const BOX = { x: RAIN.width, z: RAIN.depth, y: RAIN.height };
const vertex = `attribute vec3 aSeed;attribute float aDensity;attribute float aEnd;uniform float time;uniform vec3 center;uniform vec3 box;uniform float amount;uniform vec2 wind;uniform vec2 drift;varying float vAlpha;
void main(){
 float speed=${RAIN.minSpeed.toFixed(1)}+aSeed.z*${RAIN.speedRange.toFixed(1)};
 vec3 p=vec3(aSeed.x*box.x+drift.x,mod(aSeed.y*box.y-speed*time,box.y),aSeed.z*box.z+drift.y);
 // Recenter the periodic volume, leaving individual drops anchored in the world.
 p.x=center.x+mod(p.x-center.x+box.x*.5,box.x)-box.x*.5;
 p.z=center.z+mod(p.z-center.z+box.z*.5,box.z)-box.z*.5;
 float tail=aEnd*(1.8+aDensity*2.0);
 vec3 dir=normalize(vec3(wind.x,-speed,wind.y));
 vec3 world=p-dir*tail;
 float shown=step(aDensity,amount);
 float edge=1.-smoothstep(.34,.5,max(abs(world.x-center.x)/box.x,abs(world.z-center.z)/box.z));
 vAlpha=shown*mix(.19,.025,aEnd)*smoothstep(0.,9.,world.y)*(1.-smoothstep(box.y*.8,box.y,world.y))*edge;
 gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);
}`;
const fragment = `varying float vAlpha;uniform vec3 tint;void main(){if(vAlpha<.01)discard;gl_FragColor=vec4(tint,vAlpha);}`;

export class WeatherFX {
  constructor(scene) {
    const positions = new Float32Array(COUNT * 2 * 3),
      seeds = new Float32Array(COUNT * 2 * 3),
      density = new Float32Array(COUNT * 2),
      ends = new Float32Array(COUNT * 2);
    const source = rainSeeds();
    for (let i = 0; i < COUNT; i++) {
      const x = source[i * 4],
        y = source[i * 4 + 1],
        z = source[i * 4 + 2];
      for (let end = 0; end < 2; end++) {
        const v = (i * 2 + end) * 3;
        seeds[v] = x;
        seeds[v + 1] = y;
        seeds[v + 2] = z;
        ends[i * 2 + end] = end;
        density[i * 2 + end] = source[i * 4 + 3];
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new T.BufferAttribute(seeds, 3));
    geometry.setAttribute('aEnd', new T.BufferAttribute(ends, 1));
    geometry.setAttribute('aDensity', new T.BufferAttribute(density, 1));
    this.uniforms = {
      time: { value: 0 },
      center: { value: new T.Vector3() },
      box: { value: new T.Vector3(BOX.x, BOX.y, BOX.z) },
      amount: { value: 0 },
      wind: { value: new T.Vector2(3.2, 1.4) },
      drift: { value: new T.Vector2() },
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
    this.time = 0;
  }
  lightning() {
    this.flash = 1;
  }
  // Integrate the wind: multiplying a changing wind by total time makes old storms accelerate.
  update(dt, target, weather) {
    const style = weatherStyle(weather);
    this.time += Math.max(0, dt);
    this.amount += (style.rain - this.amount) * (1 - Math.exp(-Math.max(0, dt) * 3));
    this.rain.visible = this.amount > 0.005;
    this.uniforms.time.value = this.time;
    this.uniforms.center.value.set(target.x, 0, target.z);
    this.uniforms.amount.value = this.amount;
    const wind = rainWind(this.time, style.wind);
    this.uniforms.wind.value.set(wind.x, wind.z);
    const drift = this.uniforms.drift.value;
    drift.x = (drift.x + wind.x * dt) % BOX.x;
    drift.y = (drift.y + wind.z * dt) % BOX.z;
    this.flash = Math.max(0, this.flash - dt * 4.5);
  }
  diagnostics() {
    return {
      rain: this.rain.visible,
      rainAmount: this.amount,
      flash: this.flash,
      drops: Math.round(COUNT * this.amount),
      time: this.time,
      wind: this.uniforms.wind.value.toArray(),
    };
  }
}

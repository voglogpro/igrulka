import * as T from '../../../vendor/three/three.module.js';

// Camera-facing ribbons stretched along a world direction: tracers, muzzle jets and sparks.
// The batch is rebuilt every frame from the live list, so it never keeps stale instances.
const streakVertex = `attribute vec3 aTint;attribute float aOpacity;varying vec2 vUv;varying vec3 vTint;varying float vAlpha;
void main(){vUv=uv;vTint=aTint;vAlpha=aOpacity;gl_Position=projectionMatrix*viewMatrix*instanceMatrix*vec4(position,1.0);}`;
const streakFragment = `varying vec2 vUv;varying vec3 vTint;varying float vAlpha;
void main(){float across=abs(vUv.y-.5)*2.;float core=exp(-across*across*9.);float halo=(1.-across*across)*.22;
 float along=smoothstep(0.,.75,vUv.x)*(1.-smoothstep(.93,1.,vUv.x));float alpha=(core+halo)*along*vAlpha;
 if(alpha<.004)discard;gl_FragColor=vec4(vTint*(.55+core*.9),alpha);
 #include <colorspace_fragment>
}`;

export class StreakBatch {
  constructor(scene, capacity) {
    this.capacity = capacity;
    this.count = 0;
    // Quad spans x = -1 (tail) .. 0 (head); the instance basis scales it to length and width.
    const geometry = new T.PlaneGeometry(1, 1).translate(-0.5, 0, 0);
    this.tint = new Float32Array(capacity * 3);
    this.opacity = new Float32Array(capacity);
    geometry.setAttribute(
      'aTint',
      new T.InstancedBufferAttribute(this.tint, 3).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'aOpacity',
      new T.InstancedBufferAttribute(this.opacity, 1).setUsage(T.DynamicDrawUsage),
    );
    this.mesh = new T.InstancedMesh(
      geometry,
      new T.ShaderMaterial({
        vertexShader: streakVertex,
        fragmentShader: streakFragment,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        toneMapped: false,
        side: T.DoubleSide,
      }),
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.count = 0;
    this.eye = new T.Vector3();
    scene.add(this.mesh);
  }
  begin(camera) {
    this.count = 0;
    this.eye.setFromMatrixPosition(camera.matrixWorld);
  }
  // Head position, unit direction, length, width, colour and opacity.
  add(x, y, z, dx, dy, dz, length, width, color, opacity = 1) {
    if (this.count >= this.capacity || length <= 0 || opacity <= 0) return;
    let sx = dy * (this.eye.z - z) - dz * (this.eye.y - y),
      sy = dz * (this.eye.x - x) - dx * (this.eye.z - z),
      sz = dx * (this.eye.y - y) - dy * (this.eye.x - x);
    const side = Math.hypot(sx, sy, sz);
    if (side < 1e-6) {
      sx = 0;
      sy = 1;
      sz = 0;
    } else {
      sx /= side;
      sy /= side;
      sz /= side;
    }
    const i = this.count++,
      m = this.mesh.instanceMatrix.array,
      o = i * 16;
    m[o] = dx * length;
    m[o + 1] = dy * length;
    m[o + 2] = dz * length;
    m[o + 3] = 0;
    m[o + 4] = sx * width;
    m[o + 5] = sy * width;
    m[o + 6] = sz * width;
    m[o + 7] = 0;
    m[o + 8] = dy * sz - dz * sy;
    m[o + 9] = dz * sx - dx * sz;
    m[o + 10] = dx * sy - dy * sx;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
    this.tint[i * 3] = color[0];
    this.tint[i * 3 + 1] = color[1];
    this.tint[i * 3 + 2] = color[2];
    this.opacity[i] = opacity;
  }
  end() {
    const was = this.mesh.count;
    this.mesh.count = this.count;
    if (!this.count && !was) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.aTint.needsUpdate = true;
    this.mesh.geometry.attributes.aOpacity.needsUpdate = true;
  }
}

// Short-lived streaks that move: sparks, muzzle jets and fragments of tracer.
export class StreakParticles {
  constructor(capacity) {
    this.slots = Array.from({ length: capacity }, () => ({ life: 0 }));
    this.cursor = 0;
    this.active = 0;
  }
  spawn(options) {
    const p = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;
    Object.assign(
      p,
      {
        vx: 0,
        vy: 0,
        vz: 0,
        dx: 0,
        dy: 1,
        dz: 0,
        gravity: 0,
        drag: 0,
        length: 1,
        width: 0.2,
        stretch: 0,
        opacity: 1,
        grow: 0,
        color: [5, 2.4, 0.6],
      },
      options,
    );
    p.total = p.life;
  }
  update(dt, streaks) {
    let active = 0;
    for (const p of this.slots) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      active++;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy = p.vy * drag - p.gravity * dt;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      let { dx, dy, dz } = p,
        length = p.length;
      if (p.stretch) {
        const speed = Math.hypot(p.vx, p.vy, p.vz) || 1;
        dx = p.vx / speed;
        dy = p.vy / speed;
        dz = p.vz / speed;
        length = Math.max(p.length, speed * p.stretch);
      }
      const t = p.life / p.total;
      streaks.add(
        p.x,
        p.y,
        p.z,
        dx,
        dy,
        dz,
        length * (1 + p.grow * (1 - t)),
        p.width,
        p.color,
        p.opacity * t,
      );
    }
    this.active = active;
  }
}

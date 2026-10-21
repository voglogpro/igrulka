import * as T from '../../../vendor/three/three.module.js';
const particleVertex = `attribute float aOpacity;attribute vec3 aTint;varying vec2 vUv;varying float vAlpha;varying vec3 vTint;
void main(){vUv=uv;vAlpha=aOpacity;vTint=aTint;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`;
const particleFragment = `uniform float kind;uniform float clock;varying vec2 vUv;varying float vAlpha;varying vec3 vTint;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){vec2 p=(vUv-.5)*2.;float r=length(p);float alpha;
 if(kind<.5){float n=noise(p*3.+vec2(clock*.16,clock*.23))*.6+noise(p*7.)*.25;alpha=smoothstep(1.,.1,r)*(.45+n*.55);}
 else if(kind<1.5){float n=noise(p*5.+vec2(0.,clock*2.));alpha=exp(-r*r*(3.+n))*smoothstep(1.,.5,r)*(.55+.45*n);}
 else{float dust=noise(p*13.+vec2(clock*.2));float edge=r+(dust-.5)*.045;alpha=smoothstep(.83,.93,edge)*(1.-smoothstep(.94,1.,edge))*(.2+.8*dust);}
 alpha*=vAlpha;if(alpha<.003)discard;gl_FragColor=vec4(vTint,alpha);
 #include <colorspace_fragment>
}`;

class ParticleBatch {
  constructor(scene, capacity, kind) {
    this.capacity = capacity;
    this.kind = kind;
    this.time = 0;
    this.cursor = 0;
    this.active = 0;
    this.slots = Array.from({ length: capacity }, () => ({ life: 0 }));
    const geometry = new T.PlaneGeometry(2, 2),
      opacity = new Float32Array(capacity),
      tint = new Float32Array(capacity * 3);
    geometry.setAttribute(
      'aOpacity',
      new T.InstancedBufferAttribute(opacity, 1).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'aTint',
      new T.InstancedBufferAttribute(tint, 3).setUsage(T.DynamicDrawUsage),
    );
    this.mesh = new T.InstancedMesh(
      geometry,
      new T.ShaderMaterial({
        uniforms: { kind: { value: kind }, clock: { value: 0 } },
        vertexShader: particleVertex,
        fragmentShader: particleFragment,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: kind === 1 ? T.AdditiveBlending : T.NormalBlending,
        toneMapped: false,
        side: T.DoubleSide,
      }),
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = kind === 0 ? 8 : 9;
    this.dummy = new T.Object3D();
    this.zero = new T.Matrix4().makeScale(0, 0, 0);
    this.rotation = new T.Quaternion();
    this.axis = new T.Vector3(0, 0, 1);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.zero);
    scene.add(this.mesh);
  }
  spawn(x, y, z, options = {}) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    const p = this.slots[i];
    Object.assign(p, {
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 1,
      growth: 0,
      life: 1,
      total: 1,
      opacity: 0.5,
      gravity: 0,
      drag: 0,
      aspect: 1,
      rotation: Math.random() * 6.28,
      ...options,
    });
    p.total = p.life;
    const c = options.color || (this.kind === 0 ? [0.3, 0.34, 0.36] : [4, 1.5, 0.3]);
    this.mesh.geometry.attributes.aTint.array.set(c, i * 3);
    this.mesh.geometry.attributes.aTint.needsUpdate = true;
  }
  update(dt, camera) {
    this.time += dt;
    this.mesh.material.uniforms.clock.value = this.time;
    const alpha = this.mesh.geometry.attributes.aOpacity.array;
    let active = 0;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.slots[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        alpha[i] = 0;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      active++;
      const age = p.total - p.life,
        drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const fade =
          Math.min(1, (age + 0.01) / 0.06) *
          Math.pow(p.life / p.total, this.kind === 0 ? 0.8 : 0.65),
        size = Math.max(0.01, p.size + p.growth * age);
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.quaternion.copy(camera.quaternion);
      this.rotation.setFromAxisAngle(this.axis, p.rotation);
      this.dummy.quaternion.multiply(this.rotation);
      if (this.kind === 2) this.dummy.rotation.set(-Math.PI / 2, 0, 0);
      this.dummy.scale.set(size * p.aspect, size, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      alpha[i] = p.opacity * fade;
    }
    this.active = active;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.aOpacity.needsUpdate = true;
  }
}

export class CombatEffects {
  constructor(world) {
    this.world = world;
    this.smoke = new ParticleBatch(world.scene, 768, 0);
    this.glow = new ParticleBatch(world.scene, 1024, 1);
    this.rings = new ParticleBatch(world.scene, 48, 2);
    this.clock = 0;
    this.emitters = new Map();
    this.lights = Array.from({ length: 3 }, () => {
      const light = new T.PointLight('#ffc18a', 0, 120, 2);
      light.userData.life = 0;
      world.scene.add(light);
      return light;
    });
    this.debris = Array.from({ length: 96 }, () => ({ life: 0 }));
    this.debrisCursor = 0;
    this.shards = new T.InstancedMesh(
      new T.BoxGeometry(1, 0.18, 2.7),
      new T.MeshStandardMaterial({ color: '#6e7771', metalness: 0.4, roughness: 0.6 }),
      96,
    );
    this.shards.frustumCulled = false;
    this.shards.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.dummy = new T.Object3D();
    this.zero = new T.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 96; i++) this.shards.setMatrixAt(i, this.zero);
    world.scene.add(this.shards);
    this.traceCapacity = 1536;
    this.tracePositions = new Float32Array(this.traceCapacity * 3 * 2);
    this.traceColors = new Float32Array(this.traceCapacity * 3 * 2);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.tracePositions, 3).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'color',
      new T.BufferAttribute(this.traceColors, 3).setUsage(T.DynamicDrawUsage),
    );
    geometry.setDrawRange(0, 0);
    this.tracers = new T.LineSegments(
      geometry,
      new T.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        blending: T.AdditiveBlending,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    this.tracers.frustumCulled = false;
    world.scene.add(this.tracers);
  }
  puff(x, y, z, size = 2, life = 2, options = {}) {
    this.smoke.spawn(x, y, z, {
      size,
      life,
      growth: size * 0.55,
      vx: 2,
      vy: 4,
      vz: 1,
      opacity: 0.32,
      ...options,
    });
  }
  spark(x, y, z, size = 0.6, life = 0.5, options = {}) {
    this.glow.spawn(x, y, z, { size, life, opacity: 0.9, gravity: 18, aspect: 0.3, ...options });
  }
  flash(x, y, z, size = 3, life = 0.09) {
    this.glow.spawn(x, y, z, { size, life, opacity: 1, growth: 10, color: [6, 3, 0.8] });
  }
  fragment(x, y, z, scale = 1, vx = 0, vy = 0, vz = 0) {
    const p = this.debris[this.debrisCursor];
    this.debrisCursor = (this.debrisCursor + 1) % this.debris.length;
    Object.assign(p, {
      x,
      y,
      z,
      life: 3.5,
      total: 3.5,
      scale,
      vx: vx + (Math.random() - 0.5) * 24,
      vy: vy + 12 + Math.random() * 18,
      vz: vz + (Math.random() - 0.5) * 24,
      rx: Math.random() * 6,
      ry: Math.random() * 6,
      rz: Math.random() * 6,
      spin: (Math.random() - 0.5) * 8,
    });
  }
  explode(x, y, z, size = 1, air = false) {
    this.flash(x, y + 2, z, size * 9, 0.17);
    for (let i = 0; i < 14 * size; i++) {
      const a = Math.random() * 6.28,
        r = Math.random() * size * 5;
      this.glow.spawn(x + Math.cos(a) * r, y + Math.random() * size * 3, z + Math.sin(a) * r, {
        size: size * (2 + Math.random() * 3),
        life: 0.3 + Math.random() * 0.45,
        growth: 8 * size,
        vy: 8 + Math.random() * 14,
        opacity: 0.34,
        color: i % 2 ? [3.5, 0.55, 0.035] : [1.9, 0.15, 0.008],
      });
    }
    for (let i = 0; i < 12 * size; i++)
      this.puff(
        x + (Math.random() - 0.5) * size * 7,
        y + size * 3,
        z + (Math.random() - 0.5) * size * 7,
        size * (2 + Math.random() * 2),
        2.5 + Math.random() * 2,
        {
          vy: 5 + Math.random() * 9,
          vx: (Math.random() - 0.5) * 12,
          vz: (Math.random() - 0.5) * 12,
          color: air ? [0.13, 0.15, 0.18] : [0.09, 0.1, 0.115],
          opacity: 0.35,
        },
      );
    for (let i = 0; i < 18 * size; i++)
      this.spark(x, y + 2, z, 0.25 + Math.random() * 0.55, 0.5 + Math.random() * 0.9, {
        vx: (Math.random() - 0.5) * size * 65,
        vy: 10 + Math.random() * size * 45,
        vz: (Math.random() - 0.5) * size * 65,
      });
    if (!air) {
      this.rings.spawn(x, 1.3, z, {
        size: 2,
        life: 0.6,
        growth: 60 * size,
        opacity: 0.2,
        color: [0.62, 0.5, 0.32],
      });
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        this.puff(x, 1, z, 1.1 * size, 0.75, {
          vx: Math.cos(a) * size * 32,
          vy: 1,
          vz: Math.sin(a) * size * 32,
          drag: 1.8,
          opacity: 0.16,
          color: [0.25, 0.22, 0.17],
        });
      }
    }
    for (let i = 0; i < 5 * size; i++) this.fragment(x, y + 2, z, 0.7 + Math.random() * size);
    const light = this.lights.reduce((a, b) => (a.userData.life < b.userData.life ? a : b));
    light.position.set(x, y + 6, z);
    light.userData.life = 0.24;
    light.userData.power = 70 * size;
    light.distance = 100 * size;
  }
  handle(e) {
    if (e.type === 'intercept') {
      if (e.mode === 'fall') {
        this.flash(e.x, e.y, e.z, 5, 0.1);
        for (let i = 0; i < 12; i++)
          this.spark(e.x, e.y, e.z, 0.5, 0.5, {
            vx: (Math.random() - 0.5) * 35,
            vy: Math.random() * 14,
            vz: (Math.random() - 0.5) * 35,
          });
        this.fragment(e.x, e.y, e.z, 3, e.vx, e.vy, e.vz);
      } else this.explode(e.x, e.y, e.z, e.key === 'ballistic' ? 1.6 : 1, true);
    }
    if (e.type === 'impact' || e.type === 'crash')
      this.explode(
        e.x,
        e.y || 2,
        e.z,
        e.key === 'fpv'
          ? 0.55
          : e.key === 'tank'
            ? 0.8
            : e.key === 'ballistic'
              ? 2.6
              : e.key === 'heavy'
                ? 1.7
                : 1.2,
      );
    if (e.type === 'destroy')
      for (let i = 0; i < 18; i++)
        this.puff(e.x + (Math.random() - 0.5) * 20, 2, e.z + (Math.random() - 0.5) * 20, 3, 3, {
          vy: 8,
          color: [0.39, 0.36, 0.31],
          opacity: 0.38,
        });
    if (e.type === 'cleared')
      for (let i = 0; i < 7; i++)
        this.puff(e.x, 1, e.z, 2, 1.1, { color: [0.42, 0.39, 0.32], opacity: 0.25 });
    if (e.type === 'hit')
      for (let i = 0; i < 3; i++)
        this.spark(e.x, e.y, e.z, 0.25, 0.2, {
          vx: (Math.random() - 0.5) * 20,
          vy: 4,
          vz: (Math.random() - 0.5) * 20,
        });
    if (e.type === 'shot') {
      const dx = e.tx - e.x,
        dy = e.ty - e.y,
        dz = e.tz - e.z,
        d = Math.hypot(dx, dy, dz) || 1,
        x = e.mx ?? e.x + (dx / d) * 8,
        y = e.my ?? e.y + (dy / d) * 8,
        z = e.mz ?? e.z + (dz / d) * 8;
      if (e.key === 'sam') {
        this.flash(x, y, z, 3, 0.18);
        this.puff(x, y, z, 2, 1.5, { vy: 3 });
      } else {
        this.flash(x, y, z, e.key === 'gun' ? 1.5 : 3, 0.07);
        this.puff(x, y, z, 0.5, 0.45, { opacity: 0.15 });
      }
    }
    if (e.type === 'launch') {
      this.puff(e.x, 2, e.z, 1.4, 0.9, { vy: 2, opacity: 0.2 });
      this.flash(e.x, 5, e.z, 1.4, 0.12);
    }
  }
  emit(state, dt) {
    if (dt <= 0) return;
    this.clock += dt;
    for (const b of state.buildings) {
      if (b.hp <= 0 || b.progress < 1 || !['industry', 'power', 'factory'].includes(b.key))
        continue;
      const interval = b.key === 'factory' && !b.queue?.length ? 0.85 : 0.26;
      if (this.clock - (this.emitters.get(b.id) || 0) < interval) continue;
      this.emitters.set(b.id, this.clock);
      const c = Math.cos(b.rotation || 0),
        s = Math.sin(b.rotation || 0),
        x = b.key === 'industry' ? -9 : b.key === 'power' ? 8 : 9,
        z = b.key === 'industry' ? -7 : b.key === 'power' ? -5 : 0;
      this.puff(
        b.x + x * c + z * s,
        b.key === 'industry' ? 34 : b.key === 'power' ? 26 : 19,
        b.z + z * c - x * s,
        b.key === 'factory' ? 1.1 : 2,
        3.8,
        {
          vy: b.key === 'factory' ? 2.5 : 4,
          opacity: b.key === 'power' ? 0.18 : 0.27,
          color: b.key === 'power' ? [0.57, 0.61, 0.59] : [0.3, 0.34, 0.35],
        },
      );
    }
    for (const u of state.units) {
      if (u.delay > 0) continue;
      const burning = u.status === 'falling' || u.hp / u.maxHp < 0.45,
        missile = ['cruise', 'ballistic'].includes(u.key),
        interval = burning ? 0.055 : missile ? 0.055 : 0.18;
      if (this.clock - (this.emitters.get(u.id) || 0) < interval) continue;
      this.emitters.set(u.id, this.clock);
      if (burning) {
        this.puff(u.x, u.y, u.z, 1.6, 2.2, { vy: 1, opacity: 0.38, color: [0.17, 0.18, 0.2] });
        this.glow.spawn(u.x, u.y, u.z, {
          size: 1.8,
          life: 0.23,
          opacity: 0.8,
          color: [3.5, 0.8, 0.07],
        });
      } else if (missile) {
        this.puff(u.x, u.y, u.z, 0.65, 1.1, { vy: 0, opacity: 0.18, color: [0.6, 0.63, 0.64] });
        this.flash(u.x, u.y, u.z, 1.1, 0.08);
      } else
        this.puff(u.x, u.y - 0.4, u.z, 0.2, 0.6, {
          vy: 0,
          opacity: 0.055,
          color: [0.45, 0.49, 0.5],
        });
    }
    if (this.emitters.size > 400) {
      const ids = new Set([...state.buildings, ...state.units].map((o) => o.id));
      for (const id of this.emitters.keys()) if (!ids.has(id)) this.emitters.delete(id);
    }
  }
  updateTracers(projectiles) {
    let segment = 0;
    for (const p of projectiles) {
      if (p.kind === 'bullet' && !p.tracer) continue;
      const tail = Math.min(p.life, 0.07),
        color =
          p.kind === 'interceptor'
            ? [1.6, 2.6, 4]
            : p.kind === 'shell'
              ? [4, 1.7, 0.4]
              : [5, 3.8, 1.5];
      for (let i = 0; i < 3 && segment < this.traceCapacity; i++, segment++)
        for (let end = 0; end < 2; end++) {
          const t = tail * (1 - (i + end) / 3),
            offset = segment * 6 + end * 3;
          this.tracePositions.set(
            [p.x - p.vx * t, p.y - p.vy * t - 0.5 * (p.gravity || 0) * t * t, p.z - p.vz * t],
            offset,
          );
          const intensity = 0.2 + (0.8 * (i + end)) / 3;
          this.traceColors.set(
            [color[0] * intensity, color[1] * intensity, color[2] * intensity],
            offset,
          );
        }
    }
    this.tracers.geometry.setDrawRange(0, segment * 2);
    this.tracers.geometry.attributes.position.needsUpdate = true;
    this.tracers.geometry.attributes.color.needsUpdate = true;
  }
  update(dt, elapsed, camera) {
    this.smoke.update(dt, camera);
    this.glow.update(dt, camera);
    this.rings.update(dt, camera);
    for (const light of this.lights) {
      light.userData.life = Math.max(0, light.userData.life - dt);
      light.intensity = light.userData.power * Math.pow(light.userData.life / 0.24, 2) || 0;
    }
    for (let i = 0; i < this.debris.length; i++) {
      const p = this.debris[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.shards.setMatrixAt(i, this.zero);
        continue;
      }
      p.vy -= 22 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.3) {
        p.y = 0.3;
        p.vy = Math.abs(p.vy) * 0.18;
        p.vx *= 0.8;
        p.vz *= 0.8;
      }
      p.rx += p.spin * dt;
      p.rz += p.spin * 0.7 * dt;
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.rx, p.ry, p.rz);
      this.dummy.scale.setScalar(p.scale * Math.min(1, p.life));
      this.dummy.updateMatrix();
      this.shards.setMatrixAt(i, this.dummy.matrix);
    }
    this.shards.instanceMatrix.needsUpdate = true;
  }
  diagnostics() {
    return {
      particles: this.smoke.active + this.glow.active + this.rings.active,
      capacity: this.smoke.capacity + this.glow.capacity + this.rings.capacity,
      lights: this.lights.length,
      drawBatches: 5,
      tracerSegments: this.tracers.geometry.drawRange.count / 2,
    };
  }
}

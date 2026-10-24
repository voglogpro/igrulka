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

export class ParticleBatch {
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
    this.dirty = true;
    const c = options.color || (this.kind === 0 ? [0.3, 0.34, 0.36] : [4, 1.5, 0.3]);
    this.mesh.geometry.attributes.aTint.array.set(c, i * 3);
    this.mesh.geometry.attributes.aTint.needsUpdate = true;
  }
  update(dt, camera) {
    this.time += dt;
    this.mesh.material.uniforms.clock.value = this.time;
    // Nothing alive and nothing to clear: keep the previous upload.
    if (!this.active && !this.dirty) return;
    this.dirty = false;
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

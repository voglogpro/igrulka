import * as T from '../../../vendor/three/three.module.js';

// Spent cases from automatic weapons: one instanced draw, fixed pool, simple bounce on the ground.
export class CasingPool {
  constructor(scene, capacity = 320) {
    this.slots = Array.from({ length: capacity }, () => ({ life: 0 }));
    this.cursor = 0;
    this.active = 0;
    this.dirty = false;
    this.mesh = new T.InstancedMesh(
      new T.CylinderGeometry(0.5, 0.5, 1, 6).rotateX(Math.PI / 2),
      new T.MeshStandardMaterial({
        color: '#c9a04c',
        emissive: '#4a3208',
        metalness: 0.85,
        roughness: 0.32,
      }),
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.dummy = new T.Object3D();
    this.zero = new T.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.zero);
    scene.add(this.mesh);
  }
  // Ejected to the right of the firing direction with a little upward kick.
  eject(x, y, z, dx, dz, size, floor) {
    const p = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;
    const side = Math.random() < 0.5 ? 1 : 1.25,
      push = 5 + Math.random() * 5;
    Object.assign(p, {
      x,
      y,
      z,
      vx: -dz * push * side - dx * 1.5 + (Math.random() - 0.5) * 2,
      vy: 4 + Math.random() * 5,
      vz: dx * push * side - dz * 1.5 + (Math.random() - 0.5) * 2,
      rx: Math.random() * 6,
      ry: Math.random() * 6,
      spin: 14 + Math.random() * 20,
      size,
      floor: floor + size * 0.25,
      life: 2.2 + Math.random(),
      bounces: 0,
    });
    this.dirty = true;
  }
  update(dt) {
    if (!this.dirty && !this.active) return;
    this.dirty = false;
    let active = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const p = this.slots[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      active++;
      p.vy -= 26 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < p.floor) {
        p.y = p.floor;
        p.vy = p.bounces++ < 2 ? Math.abs(p.vy) * 0.32 : 0;
        p.vx *= 0.45;
        p.vz *= 0.45;
        p.spin *= 0.4;
      }
      p.rx += p.spin * dt;
      p.ry += p.spin * 0.6 * dt;
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.rx, p.ry, 0);
      const fade = Math.min(1, p.life * 2);
      this.dummy.scale.set(p.size * 0.32 * fade, p.size * 0.32 * fade, p.size * fade);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.active = active;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

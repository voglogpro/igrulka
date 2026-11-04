import * as T from '../../vendor/three/three.module.js';

const CAPACITY = 96;

// Falling FAB bombs from state.bombs: one shared instanced mesh pointed along the fall.
export class Bombs {
  constructor(world) {
    const geometry = new T.CylinderGeometry(0.5, 0.42, 3, 8);
    geometry.rotateX(Math.PI / 2);
    this.mesh = new T.InstancedMesh(
      geometry,
      world.mat('#4b573c', { metalness: 0.2, roughness: 0.6 }),
      CAPACITY,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    world.scene.add(this.mesh);
    this.dummy = new T.Object3D();
    this.target = new T.Vector3();
  }
  update(state) {
    let n = 0;
    for (const b of state.bombs || []) {
      if (n >= CAPACITY) break;
      const d = this.dummy;
      d.position.set(b.x, b.y, b.z);
      this.target.set(b.x + b.vx, b.y + b.vy, b.z + b.vz);
      d.lookAt(this.target);
      d.updateMatrix();
      this.mesh.setMatrixAt(n++, d.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

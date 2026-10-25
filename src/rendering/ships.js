import * as T from '../../vendor/three/three.module.js';
import { batchStatic } from './mesh-utils.js';
import { shipModel } from './models/city/oil.js';
import { factionHex } from './team-colors.js';

const CAPACITY = 24;
const WATER = -1;

// Merchant ships drawn from state.ships: one batched hull geometry per side, instanced. Ships
// bob and roll on the swell and leave a pale wake while under way.
export class Ships {
  constructor(world) {
    this.world = world;
    this.dummy = new T.Object3D();
    this.meshes = [0, 1, 2, 3].map((side) => {
      const accent = factionHex(side);
      const group = new T.Group();
      shipModel(world, group, accent);
      batchStatic(group);
      const source = group.children[0],
        mesh = new T.InstancedMesh(source.geometry, source.material, CAPACITY);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      world.scene.add(mesh);
      return mesh;
    });
    this.wakeAt = new Map();
  }
  update(state, time, visible) {
    const counts = [0, 0, 0, 0];
    for (const ship of state.ships || []) {
      if (!visible(ship)) continue;
      const mesh = this.meshes[ship.side],
        i = counts[ship.side]++;
      if (i >= CAPACITY) continue;
      const d = this.dummy,
        phase = time * 0.9 + ship.id;
      d.position.set(ship.x, WATER + Math.sin(phase) * 0.25, ship.z);
      d.rotation.set(Math.sin(phase * 0.7) * 0.025, ship.yaw || 0, Math.sin(phase) * 0.04, 'YXZ');
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      const moving = ship.path?.length;
      if (moving && time - (this.wakeAt.get(ship.id) || 0) > 0.18) {
        this.wakeAt.set(ship.id, time);
        const back = 15,
          sx = ship.x - Math.sin(ship.yaw) * back,
          sz = ship.z - Math.cos(ship.yaw) * back;
        this.world.combatFX?.puff(sx, WATER + 0.3, sz, 1.6, 3.5, {
          vx: 0,
          vy: 0.05,
          vz: 0,
          growth: 2.6,
          opacity: 0.16,
          color: [0.85, 0.9, 0.9],
        });
      }
    }
    this.meshes.forEach((mesh, side) => {
      mesh.count = Math.min(CAPACITY, counts[side]);
      mesh.instanceMatrix.needsUpdate = true;
    });
    if (this.wakeAt.size > 64) this.wakeAt.clear();
  }
  diagnostics() {
    return { ships: this.meshes.reduce((n, m) => n + m.count, 0) };
  }
}

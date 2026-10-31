import * as T from '../../vendor/three/three.module.js';
import { batchStatic } from './mesh-utils.js';
import { factionHex } from './team-colors.js';

const CAPACITY = 16;
const WATER = -1;

// A grey missile ship: hull, bridge, mast and a launcher block with four cells.
function warshipModel(w, root, accent) {
  const hull = '#5c6567',
    deck = '#7a8385';
  w.box(root, 0, -1.8, 0, 7.5, 3.6, 34, hull);
  const bow = w.box(root, 0, -1.8, 17, 5.3, 3.6, 5.3, hull);
  bow.rotation.y = Math.PI / 4;
  w.box(root, 0, 1.8, 0, 7, 0.25, 33, deck);
  w.box(root, 0, 2, -3, 5.2, 4.2, 9, '#8f989a');
  w.box(root, 0, 6.2, -2, 4.4, 2, 5, '#a5adae');
  w.box(root, 0, 7.4, 0.55, 4, 0.8, 0.1, '#263238');
  w.cyl(root, 0, 8.2, -3, 0.3, 7, '#4b5355');
  w.box(root, 0, 13.5, -3, 3, 0.25, 0.25, '#4b5355');
  w.cyl(root, 0, 6, -8, 1, 3, accent);
  // Vertical launch cells forward of the bridge.
  for (const x of [-1.3, 1.3])
    for (const z of [6.5, 9.5]) w.box(root, x, 2, z, 2, 1.1, 2.4, '#3e4648');
  w.cyl(root, 0, 2, 13.5, 0.9, 1.4, '#3e4648');
  w.cyl(root, 0, 3.2, 14.6, 0.15, 3, '#2f3436').rotation.x = Math.PI / 2;
}

// Naval missile ships drawn from state.warships, instanced per side with the same swell as
// merchant ships and a wake while under way.
export class Warships {
  constructor(world) {
    this.world = world;
    this.dummy = new T.Object3D();
    this.meshes = [0, 1, 2, 3].map((side) => {
      const group = new T.Group();
      warshipModel(world, group, factionHex(side));
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
    for (const ship of state.warships || []) {
      if (ship.hp <= 0 || !visible(ship) || !this.meshes[ship.side]) continue;
      const mesh = this.meshes[ship.side],
        i = counts[ship.side]++;
      if (i >= CAPACITY) continue;
      const d = this.dummy,
        phase = time * 0.8 + ship.id;
      d.position.set(ship.x, WATER + Math.sin(phase) * 0.2, ship.z);
      d.rotation.set(Math.sin(phase * 0.7) * 0.02, ship.yaw || 0, Math.sin(phase) * 0.03, 'YXZ');
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      if (ship.state === 'sailing' && time - (this.wakeAt.get(ship.id) || 0) > 0.18) {
        this.wakeAt.set(ship.id, time);
        const back = 17;
        this.world.combatFX?.puff(
          ship.x - Math.sin(ship.yaw) * back,
          WATER + 0.3,
          ship.z - Math.cos(ship.yaw) * back,
          1.6,
          3.5,
          { vx: 0, vy: 0.05, vz: 0, growth: 2.6, opacity: 0.16, color: [0.85, 0.9, 0.9] },
        );
      }
    }
    this.meshes.forEach((mesh, side) => {
      mesh.count = Math.min(CAPACITY, counts[side]);
      mesh.instanceMatrix.needsUpdate = true;
    });
    if (this.wakeAt.size > 64) this.wakeAt.clear();
  }
  diagnostics() {
    return { warships: this.meshes.reduce((n, m) => n + m.count, 0) };
  }
}

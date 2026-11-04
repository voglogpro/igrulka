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

// A fast patrol boat with a bow gun and a small wheelhouse.
function patrolModel(w, root, accent) {
  const hull = '#59625f';
  w.box(root, 0, -1.4, 0, 5, 2.8, 20, hull);
  const bow = w.box(root, 0, -1.4, 10, 3.5, 2.8, 3.5, hull);
  bow.rotation.y = Math.PI / 4;
  w.box(root, 0, 1.4, 0, 4.6, 0.2, 19, '#7a8385');
  w.box(root, 0, 1.6, -2, 3.6, 2.8, 5, '#9aa2a3');
  w.box(root, 0, 4.4, -1.6, 3.2, 0.2, 0.1, '#263238');
  w.cyl(root, 0, 4.4, -3, 0.18, 4, '#4b5355');
  w.cyl(root, 0, 1.6, 6, 0.8, 1, '#3e4648');
  w.box(root, 0, 2.3, 7.8, 0.22, 0.22, 3.4, '#2f3436');
  w.cyl(root, 0, 7.8, -3, 0.5, 0.6, accent);
}

// A large destroyer: long hull, bow turret, two-step superstructure with radar mast, a sixteen-cell
// launch shaft amidships and three machine-gun mounts against drones.
function destroyerModel(w, root, accent) {
  const hull = '#565f62',
    deck = '#768082';
  w.box(root, 0, -2.2, 0, 10, 4.4, 50, hull);
  const bow = w.box(root, 0, -2.2, 25, 7, 4.4, 7, hull);
  bow.rotation.y = Math.PI / 4;
  w.box(root, 0, 2.2, 0, 9.4, 0.3, 49, deck);
  // Bow turret and barrel.
  w.cyl(root, 0, 3.2, 15, 2.2, 1.8, '#4a5254');
  w.box(root, 0, 3.6, 19, 0.45, 0.45, 6, '#2f3436');
  // Superstructure, bridge windows and radar mast.
  w.box(root, 0, 4.6, -1, 7.2, 4.6, 12, '#8d9698');
  w.box(root, 0, 8.4, 0, 6, 3, 7, '#a3abad');
  w.box(root, 0, 9.4, 3.55, 5.4, 0.9, 0.1, '#263238');
  w.cyl(root, 0, 13.5, -1, 0.35, 8, '#4b5355');
  w.box(root, 0, 16.5, -1, 4.2, 0.3, 0.3, '#4b5355');
  w.box(root, 0, 12.2, -1, 2.6, 1.6, 0.4, '#5b6466');
  // Funnel with the faction band.
  w.box(root, 0, 6.2, -10, 3.4, 4.4, 4.2, '#6d7678');
  w.cyl(root, 0, 8.8, -10, 1.3, 0.8, accent);
  // Launch shaft: a grid of cells forward of the bridge.
  for (const x of [-2.4, -0.8, 0.8, 2.4])
    for (const z of [7.5, 9.6]) w.box(root, x, 2.6, z, 1.4, 0.9, 1.8, '#363e40');
  // Machine-gun mounts: port, starboard and stern.
  for (const [x, z] of [
    [-3.8, -4],
    [3.8, -4],
    [0, -20],
  ]) {
    w.cyl(root, x, 2.9, z, 0.9, 1, '#4a5254');
    w.box(root, x, 3.6, z + 1.2, 0.18, 0.18, 2.4, '#2a2f31');
  }
  // Helicopter deck marking at the stern.
  w.box(root, 0, 2.38, -16, 6.4, 0.04, 6.4, '#5f6a5f');
}

// Naval missile ships and patrol boats drawn from state.warships, instanced per side with the same swell as
// merchant ships and a wake while under way.
export class Warships {
  constructor(world) {
    this.world = world;
    this.dummy = new T.Object3D();
    this.meshes = Array.from({ length: 12 }, (_, index) => {
      const side = index % 4,
        group = new T.Group();
      [warshipModel, patrolModel, destroyerModel][Math.floor(index / 4)](
        world,
        group,
        factionHex(side),
      );
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
    // Ships last seen afloat, and hulls going down after they vanished from the state.
    this.afloat = new Map();
    this.sinking = new Map();
  }
  update(state, time, visible) {
    // A different campaign does not sink the previous one's fleet.
    if (state.seed !== this.seed) {
      this.seed = state.seed;
      this.afloat.clear();
      this.sinking.clear();
    }
    const counts = Array(this.meshes.length).fill(0),
      seen = new Set();
    const place = (index, x, z, yaw, y, pitch, roll) => {
      const mesh = this.meshes[index],
        i = counts[index]++;
      if (!mesh || i >= CAPACITY) return;
      const d = this.dummy;
      d.position.set(x, y, z);
      d.rotation.set(pitch, yaw, roll, 'YXZ');
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    };
    for (const ship of state.warships || []) {
      const index = (ship.class === 'patrol' ? 4 : ship.class === 'destroyer' ? 8 : 0) + ship.side;
      if (ship.hp <= 0 || !this.meshes[index] || ship.side > 3) continue;
      seen.add(ship.id);
      this.afloat.set(ship.id, { index, x: ship.x, z: ship.z, yaw: ship.yaw || 0 });
      if (!visible(ship)) continue;
      const phase = time * 0.8 + ship.id;
      // A damaged hull lists to one side and trails smoke.
      const list = (1 - ship.hp / (ship.maxHp || ship.hp || 1)) * 0.08;
      place(
        index,
        ship.x,
        ship.z,
        ship.yaw || 0,
        WATER + Math.sin(phase) * 0.2,
        Math.sin(phase * 0.7) * 0.02,
        Math.sin(phase) * 0.03 + list,
      );
      if (list > 0.03 && time - (this.wakeAt.get(-ship.id) || 0) > 0.35) {
        this.wakeAt.set(-ship.id, time);
        this.world.combatFX?.puff(ship.x, 8, ship.z, 2.2, 4, {
          vx: 0.4,
          vy: 1.6,
          vz: 0.2,
          growth: 3,
          opacity: 0.3,
          color: [0.16, 0.16, 0.16],
        });
      }
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
    // A ship that left the state was sunk or lost with its base: it settles, lists and goes down.
    for (const [id, last] of this.afloat)
      if (!seen.has(id)) {
        this.afloat.delete(id);
        this.sinking.set(id, { ...last, start: time });
      }
    for (const [id, wreck] of this.sinking) {
      const t = time - wreck.start;
      if (t > 9 || t < 0) {
        this.sinking.delete(id);
        continue;
      }
      if (!visible(wreck)) continue;
      place(
        wreck.index,
        wreck.x,
        wreck.z,
        wreck.yaw,
        WATER - t * t * 0.18,
        Math.min(0.5, t * 0.06),
        Math.min(0.7, t * 0.12),
      );
      if (time - (this.wakeAt.get(-id) || 0) > 0.25) {
        this.wakeAt.set(-id, time);
        this.world.combatFX?.puff(wreck.x, 4, wreck.z, 3, 5, {
          vx: 0.3,
          vy: 2,
          vz: 0.1,
          growth: 3.4,
          opacity: 0.38,
          color: [0.12, 0.12, 0.12],
        });
      }
    }
    this.meshes.forEach((mesh, index) => {
      mesh.count = Math.min(CAPACITY, counts[index]);
      mesh.instanceMatrix.needsUpdate = true;
    });
    if (this.wakeAt.size > 64) this.wakeAt.clear();
  }
  diagnostics() {
    return { warships: this.meshes.reduce((n, m) => n + m.count, 0) };
  }
}

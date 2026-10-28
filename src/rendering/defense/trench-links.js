import * as T from '../../../vendor/three/three.module.js';
import { batchStatic } from '../mesh-utils.js';
import { FORTIFICATION } from '../../game/defense/config.js';
import { fortificationStatus } from '../../game/defense/fortifications.js';
import { trenchLinks, TRENCH_LINK_MAX_SPAN } from '../../game/defense/trench-links.js';

const PIECE_LENGTH = 6,
  END_TRIM = 1.6;

// Three shared unit-length sections: the ditch and berms, a bag parapet,
// then timber retaining walls. Earth colours stay neutral after a capture.
function template(stage) {
  const root = new T.Group(),
    geometry = new T.BoxGeometry(1, 1, 1),
    rounded = new T.SphereGeometry(0.5, 7, 4),
    materials = new Map();
  const box = (x, y, z, width, height, length, color, earth = false) => {
    if (!materials.has(color))
      materials.set(color, new T.MeshStandardMaterial({ color, roughness: 0.96 }));
    const mesh = new T.Mesh(earth ? rounded : geometry, materials.get(color));
    mesh.position.set(x, y + height / 2, z);
    mesh.scale.set(width, height, length);
    if (earth) mesh.rotation.y = Math.sin(x * 7 + z * 13) * 0.025;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  };
  if (stage === 0) {
    // Short dark firing sections read separately. Shallow continuous earth
    // between them still represents the unchanged continuous cover corridor.
    box(0, 0, 0, 3.6, 0.09, 0.64, '#28271f');
    for (const side of [-1, 1]) {
      box(side * 2.16, 0.02, 0, 0.85, 0.1, 1, '#62553f');
      box(side * 1.79, 0.08, 0, 0.16, 0.46, 0.64, '#352d23');
      for (let i = 0; i < 5; i++) {
        const z = -0.24 + i * 0.12,
          offset = Math.sin(i * 2.7 + side) * 0.12;
        box(
          side * (2.2 + offset),
          0.18,
          z,
          1.0 + offset,
          0.35 + (i % 3) * 0.1,
          i === 2 ? 0.075 : 0.105,
          i % 2 ? '#6d5c40' : '#79684a',
          true,
        );
        box(side * (2.6 + offset), 0.03, z, 0.7, 0.15, 0.11, '#62553d', true);
      }
    }
    for (let i = 0; i < 2; i++)
      box(0.12 * Math.sin(i), 0.1, (i - 0.5) * 0.39, 2.7, 0.04, 0.045, '#514632');
  } else if (stage === 1) {
    for (const side of [-1, 1])
      for (const i of [0, 1, 3]) {
        const z = -0.225 + i * 0.15;
        box(
          side * (2.13 + Math.sin(i * 3 + side) * 0.08),
          0.65,
          z,
          0.78,
          0.27 + (i % 2) * 0.06,
          0.13,
          i % 2 ? '#827356' : '#938363',
          true,
        );
        if (i !== 1) box(side * 2.15, 0.94, z + 0.025, 0.69, 0.23, 0.12, '#7a6b4f', true);
      }
  } else {
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++)
        box(side * 1.72, 0.12 + row * 0.19, 0, 0.12, 0.16, 0.62, row % 2 ? '#66563e' : '#756247');
      for (const z of [-0.25, 0.24]) box(side * 1.6, 0.08, z, 0.19, 0.92, 0.055, '#49402f');
    }
  }
  batchStatic(root);
  geometry.dispose();
  rounded.dispose();
  for (const material of materials.values()) material.dispose();
  return root.children[0];
}

export class TrenchLinkView {
  constructor(scene, { height = () => 0 } = {}) {
    this.height = height;
    this.records = new Map();
    this.seen = new Set();
    this.dummy = new T.Object3D();
    this.capacity = FORTIFICATION.maxPositions * 2 * Math.ceil(TRENCH_LINK_MAX_SPAN / PIECE_LENGTH);
    this.rebuilds = 0;
    this.pools = Array.from({ length: 3 }, (_, stage) => {
      const source = template(stage),
        mesh = new T.InstancedMesh(source.geometry, source.material, this.capacity);
      mesh.name = `trench-link-stage-${stage}`;
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      scene.add(mesh);
      return mesh;
    });
  }
  sync(state, visibleIds = null) {
    this.seen.clear();
    let dirty = false;
    for (const link of trenchLinks(state)) {
      const { a, b } = link;
      if (visibleIds && (!visibleIds.has(a.id) || !visibleIds.has(b.id))) continue;
      const level = Math.min(fortificationStatus(a).level, fortificationStatus(b).level);
      if (level < 1) continue;
      this.seen.add(link.id);
      let record = this.records.get(link.id);
      if (
        !record ||
        record.level !== level ||
        record.side !== link.side ||
        record.ax !== a.x ||
        record.az !== a.z ||
        record.bx !== b.x ||
        record.bz !== b.z
      ) {
        record = { ax: a.x, az: a.z, bx: b.x, bz: b.z, level, side: link.side };
        this.records.set(link.id, record);
        dirty = true;
      }
    }
    for (const id of this.records.keys())
      if (!this.seen.has(id)) {
        this.records.delete(id);
        dirty = true;
      }
    if (!dirty) return false;
    this.rebuilds++;
    const counts = [0, 0, 0];
    for (const record of this.records.values()) {
      const dx = record.bx - record.ax,
        dz = record.bz - record.az,
        length = Math.hypot(dx, dz),
        usable = Math.max(0, length - END_TRIM * 2),
        pieces = Math.ceil(usable / PIECE_LENGTH),
        yaw = Math.atan2(dx, dz);
      for (let i = 0; i < pieces && counts[0] < this.capacity; i++) {
        const from = (END_TRIM + usable * (i / pieces)) / length,
          to = (END_TRIM + usable * ((i + 1) / pieces)) / length,
          ax = record.ax + dx * from,
          az = record.az + dz * from,
          bx = record.ax + dx * to,
          bz = record.az + dz * to,
          ay = Math.max(0, this.height(ax, az)),
          by = Math.max(0, this.height(bx, bz)),
          flat = Math.hypot(bx - ax, bz - az),
          d = this.dummy;
        d.position.set((ax + bx) / 2, (ay + by) / 2 + 0.09, (az + bz) / 2);
        d.rotation.set(-Math.atan2(by - ay, flat), yaw, 0, 'YXZ');
        d.scale.set(1, 1, Math.hypot(flat, by - ay));
        d.updateMatrix();
        this.pools[0].setMatrixAt(counts[0]++, d.matrix);
        if (record.level >= 2) this.pools[1].setMatrixAt(counts[1]++, d.matrix);
        if (record.level >= 3) this.pools[2].setMatrixAt(counts[2]++, d.matrix);
      }
    }
    for (let i = 0; i < this.pools.length; i++) {
      const mesh = this.pools[i];
      mesh.count = counts[i];
      mesh.visible = mesh.count > 0;
      if (!mesh.count) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  }
  diagnostics() {
    return {
      links: this.records.size,
      stages: this.pools.map((p) => p.count),
      rebuilds: this.rebuilds,
      batches: 3,
    };
  }
  dispose() {
    for (const mesh of this.pools) {
      mesh.removeFromParent();
      mesh.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.records.clear();
    this.seen.clear();
  }
}

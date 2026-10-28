import * as T from '../../../vendor/three/three.module.js';
import { batchStatic } from '../mesh-utils.js';
import { FORTIFICATION } from '../../game/defense/config.js';
import { trenchRenderPieces } from '../../game/defense/trench-footprint.js';
export { trenchEndTrim, trenchRenderPieces } from '../../game/defense/trench-footprint.js';
import { fortificationStatus } from '../../game/defense/fortifications.js';
import { trenchLinks, TRENCH_LINK_MAX_SPAN } from '../../game/defense/trench-links.js';

const PIECE_LENGTH = 6;

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
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  };
  if (stage === 0) {
    box(0, 0, 0, 3.52, 0.1, 1, '#28271f');
    for (const side of [-1, 1]) {
      box(side * 1.74, 0.1, 0, 0.15, 0.54, 1, '#65543d');
      for (let i = 0; i < 4; i++) {
        const z = -0.375 + i * 0.25,
          offset = Math.sin(i * 2.7 + side) * 0.13;
        box(
          side * (2.2 + offset),
          0.02,
          z,
          1.25,
          0.48 + (i % 3) * 0.07,
          0.34,
          i % 2 ? '#6d5c40' : '#79684a',
          true,
        );
      }
      for (const z of [-0.34, 0.34]) box(side * 1.62, 0.08, z, 0.18, 0.76, 0.035, '#493e2d');
    }
  } else if (stage === 1) {
    for (const side of [-1, 1])
      for (const z of [-0.35, -0.12, 0.35])
        box(side * 2.15, 0.6, z, 0.68, 0.3, 0.19, '#827356', true);
  } else {
    for (const side of [-1, 1]) {
      for (let row = 0; row < 2; row++)
        box(side * 1.74, 0.68 + row * 0.2, 0, 0.15, 0.17, 1, row % 2 ? '#66563e' : '#756247');
      box(side * 1.6, 0.08, 0, 0.21, 1.14, 0.035, '#49402f');
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
    this.capacity =
      FORTIFICATION.maxPositions * 2 * (Math.ceil(TRENCH_LINK_MAX_SPAN / PIECE_LENGTH) + 10);
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
        record.a !== a ||
        record.b !== b ||
        record.level !== level ||
        record.side !== link.side ||
        record.ax !== a.x ||
        record.az !== a.z ||
        record.bx !== b.x ||
        record.bz !== b.z ||
        record.ayaw !== (a.yaw || 0) ||
        record.byaw !== (b.yaw || 0)
      ) {
        record = {
          a,
          b,
          ax: a.x,
          az: a.z,
          bx: b.x,
          bz: b.z,
          level,
          side: link.side,
          ayaw: a.yaw || 0,
          byaw: b.yaw || 0,
        };
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
        pieces = trenchRenderPieces(record.a, record.b),
        yaw = Math.atan2(dx, dz);
      for (const piece of pieces) {
        if (counts[0] >= this.capacity) break;
        const from = piece.from / length,
          to = piece.to / length,
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
        d.scale.set(piece.narrow ? 0.45 : 1, piece.narrow ? 0.45 : 1, Math.hypot(flat, by - ay));
        d.updateMatrix();
        this.pools[0].setMatrixAt(counts[0]++, d.matrix);
        if (!piece.narrow && record.level >= 2) this.pools[1].setMatrixAt(counts[1]++, d.matrix);
        if (!piece.narrow && record.level >= 3) this.pools[2].setMatrixAt(counts[2]++, d.matrix);
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

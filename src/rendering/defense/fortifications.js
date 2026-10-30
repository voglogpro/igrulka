import * as T from '../../../vendor/three/three.module.js';
import { batchStatic } from '../mesh-utils.js';
import { FORTIFICATION } from '../../game/defense/config.js';
import { fortificationStatus } from '../../game/defense/fortifications.js';
import { TRENCH_FOOTPRINT } from '../../game/defense/trench-footprint.js';
import { TrenchLinkView } from './trench-links.js';

function template(stage) {
  const root = new T.Group(),
    box = new T.BoxGeometry(1, 1, 1),
    earth = new T.SphereGeometry(0.5, 8, 4),
    materials = new Map(),
    half = TRENCH_FOOTPRINT.length / 2,
    width = TRENCH_FOOTPRINT.halfWidth;
  const add = (x, y, z, w, h, d, color, rounded = false) => {
    if (!materials.has(color))
      materials.set(color, new T.MeshStandardMaterial({ color, roughness: 0.96 }));
    const mesh = new T.Mesh(rounded ? earth : box, materials.get(color));
    mesh.position.set(x, y + h / 2, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  };
  if (stage === 0) {
    // Continuous open floor: straight core and rounded ends match the game capsule.
    add(0, 0, 0, TRENCH_FOOTPRINT.halfCore * 2, 0.1, width * 1.6, '#28271f');
    for (const end of [-1, 1])
      add(end * TRENCH_FOOTPRINT.halfCore, 0, 0, width * 2, 0.12, width * 1.6, '#28271f', true);
    for (const side of [-1, 1]) {
      // Long retaining boards are not stretched bags; the interior stays readable.
      for (let row = 0; row < 3; row++)
        add(
          0,
          0.12 + row * 0.21,
          side * width * 0.79,
          14.2,
          0.17,
          0.15,
          row % 2 ? '#65543d' : '#786348',
        );
      for (let i = 0; i < 12; i++) {
        const x = -half + 0.7 + i * ((TRENCH_FOOTPRINT.length - 1.4) / 11),
          taper = Math.abs(x) > TRENCH_FOOTPRINT.halfCore ? 0.68 : 1,
          offset = Math.sin(i * 2.7 + side) * 0.18;
        add(
          x,
          0.02,
          side * (width + offset) * taper,
          1.9,
          0.45 + (i % 3) * 0.08,
          1.25,
          i % 2 ? '#6d5c40' : '#79684a',
          true,
        );
        if (i % 2 === 0) add(x, 0.08, side * width * 0.73 * taper, 0.18, 0.78, 0.2, '#493e2d');
      }
    }
    for (let i = 0; i < 9; i++) add(-6.4 + i * 1.6, 0.11, 0, 0.16, 0.035, 2.7, '#514632');
  } else if (stage === 1) {
    for (const side of [-1, 1])
      for (let i = 0; i < 15; i++) {
        const x = -7.7 + i * 1.1;
        if (i % 5 === 2) continue;
        add(
          x,
          0.6,
          side * (width + Math.sin(i + side) * 0.12),
          1.13,
          0.3,
          0.68,
          i % 2 ? '#827356' : '#938363',
          true,
        );
        if (i % 3 === 0) add(x + 0.2, 0.86, side * width, 0.95, 0.25, 0.61, '#7a6b4f', true);
      }
  } else if (stage === 3) {
    // Covered strongpoint: a log-roofed dugout behind the firing trench under a layer of earth.
    // It stays low and behind the three firing places, so occupants remain readable.
    const back = -width * 2.6;
    for (let i = 0; i < 8; i++)
      add(-3.15 + i * 0.9, 0.95, back, 0.62, 0.36, 3.4, i % 2 ? '#5d4a33' : '#6b5539');
    add(0, 1.2, back, 8, 0.45, 3.9, '#5f5640', true);
    add(0, 1.38, back, 5.6, 0.36, 3, '#6d6449', true);
    for (const x of [-4.1, 4.1]) add(x, 0, back, 0.35, 1.1, 3.2, '#4c3d2b');
    for (const side of [-1, 1]) add(side * 7.6, 0.4, width * 0.9, 1.3, 0.55, 0.9, '#8b7b5c', true);
  } else if (stage === 4) {
    // Fort: a low concrete pillbox on the flank with embrasures and a concrete rear revetment.
    const flank = TRENCH_FOOTPRINT.halfCore + width * 0.9;
    add(flank, 0, 0, 4.2, 1.45, 4.4, '#8c8d86');
    add(flank, 1.45, 0, 4.7, 0.3, 4.9, '#9a9b93');
    add(flank, 0.85, width * 1.02, 2.8, 0.22, 0.12, '#2d2f2c');
    add(flank + 2.13, 0.85, 0, 0.12, 0.22, 2.6, '#2d2f2c');
    for (const x of [-6, -3, 0, 3]) add(x, 0, -width * 1.15, 2.6, 0.95, 0.35, '#878881');
  } else {
    for (const side of [-1, 1]) {
      for (let row = 0; row < 2; row++)
        add(
          0,
          0.7 + row * 0.2,
          side * width * 0.79,
          14.2,
          0.17,
          0.16,
          row % 2 ? '#66563e' : '#756247',
        );
      for (const x of [-6.6, -3.3, 0, 3.3, 6.6])
        add(x, 0.08, side * width * 0.72, 0.21, 1.14, 0.21, '#49402f');
    }
  }
  batchStatic(root);
  box.dispose();
  earth.dispose();
  for (const material of materials.values()) material.dispose();
  return root.children[0];
}

// Five fixed batches replace one mesh tree per position. Advancement changes instance counts.
export class FortificationView {
  constructor(scene, { height = () => 0, visible = () => true } = {}) {
    this.height = height;
    this.visible = visible;
    this.models = new Map();
    this.seen = new Set();
    this.dummy = new T.Object3D();
    this.capacity = FORTIFICATION.maxPositions;
    this.pools = Array.from({ length: 5 }, (_, stage) => {
      const model = template(stage),
        mesh = new T.InstancedMesh(model.geometry, model.material, this.capacity);
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      scene.add(mesh);
      return mesh;
    });
    this.links = new TrenchLinkView(scene, { height });
  }
  sync(state) {
    const seen = this.seen;
    seen.clear();
    let dirty = false,
      shadowsChanged = false;
    for (const t of state.trenches || []) {
      if (seen.size >= this.capacity || !this.visible(state, t)) continue;
      seen.add(t.id);
      const status = fortificationStatus(t),
        previous = this.models.get(t.id),
        yaw = t.yaw || 0,
        moved = !previous || previous.x !== t.x || previous.z !== t.z || previous.yaw !== yaw;
      if (
        moved ||
        previous.level !== status.level ||
        previous.side !== t.side ||
        previous.progress !== status.progress
      ) {
        shadowsChanged ||=
          moved ||
          previous.level !== status.level ||
          previous.side !== t.side ||
          Math.floor(previous.progress * 3) !== Math.floor(status.progress * 3);
        let pose = previous;
        if (moved) {
          const half = TRENCH_FOOTPRINT.length / 2,
            dx = Math.cos(yaw) * half,
            dz = -Math.sin(yaw) * half,
            low = Math.max(0, this.height(t.x - dx, t.z - dz)),
            high = Math.max(0, this.height(t.x + dx, t.z + dz)),
            centre = Math.max(0, this.height(t.x, t.z)),
            rise = high - low;
          pose = {
            y: (low + high) / 2 + 0.07,
            roll: Math.atan2(rise, TRENCH_FOOTPRINT.length),
            stretch: Math.hypot(TRENCH_FOOTPRINT.length, rise) / TRENCH_FOOTPRINT.length,
            terrainDeviation: Math.abs(centre - (low + high) / 2),
          };
        }
        this.models.set(t.id, {
          level: status.level,
          x: t.x,
          z: t.z,
          yaw,
          side: t.side,
          progress: status.progress,
          y: pose.y,
          roll: pose.roll,
          stretch: pose.stretch,
          terrainDeviation: pose.terrainDeviation,
        });
        dirty = true;
      }
    }
    for (const id of this.models.keys())
      if (!seen.has(id)) {
        this.models.delete(id);
        dirty = shadowsChanged = true;
      }
    const counts = [0, 0, 0, 0, 0];
    if (dirty)
      for (const record of this.models.values()) {
        const d = this.dummy;
        d.position.set(record.x, record.y, record.z);
        d.rotation.set(0, record.yaw, record.roll, 'YXZ');
        d.scale.set(record.stretch, 0.15 + record.progress * 0.85, 1);
        d.updateMatrix();
        this.pools[0].setMatrixAt(counts[0]++, d.matrix);
        d.scale.set(record.stretch, 1, 1);
        d.updateMatrix();
        if (record.level >= 2) this.pools[1].setMatrixAt(counts[1]++, d.matrix);
        if (record.level >= 3) this.pools[2].setMatrixAt(counts[2]++, d.matrix);
        if (record.level >= 4) this.pools[3].setMatrixAt(counts[3]++, d.matrix);
        if (record.level >= 5) this.pools[4].setMatrixAt(counts[4]++, d.matrix);
      }
    if (dirty)
      for (let i = 0; i < this.pools.length; i++) {
        const mesh = this.pools[i];
        mesh.count = counts[i];
        mesh.visible = mesh.count > 0;
        if (mesh.count) {
          mesh.instanceMatrix.clearUpdateRanges();
          mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
    // Refresh shadows a few times while digging; moving soldiers alone neither
    // rebuild the earthwork buffers nor invalidate their static shadow map.
    return this.links.sync(state, seen) || shadowsChanged;
  }
  diagnostics() {
    return {
      positions: this.models.size,
      stages: this.pools.map((p) => p.count),
      capacity: this.capacity,
      terrainDeviation: Math.max(
        0,
        ...Array.from(this.models.values(), (record) => record.terrainDeviation),
      ),
      links: this.links.diagnostics(),
      batches: 8,
    };
  }
  dispose() {
    for (const mesh of this.pools) {
      mesh.removeFromParent();
      mesh.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.models.clear();
    this.seen.clear();
    this.links.dispose();
  }
}

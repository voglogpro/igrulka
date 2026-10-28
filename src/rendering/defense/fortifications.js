import * as T from '../../../vendor/three/three.module.js';
import { batchStatic } from '../mesh-utils.js';
import { FORTIFICATION } from '../../game/defense/config.js';
import { fortificationStatus } from '../../game/defense/fortifications.js';
import { TrenchLinkView } from './trench-links.js';

function template(stage) {
  const root = new T.Group(),
    box = new T.BoxGeometry(1, 1, 1),
    bag = new T.SphereGeometry(1, 8, 4),
    materials = new Map();
  const add = (x, y, z, w, h, d, color, rounded = false) => {
    if (!materials.has(color))
      materials.set(color, new T.MeshStandardMaterial({ color, roughness: 0.94 }));
    const mesh = new T.Mesh(rounded ? bag : box, materials.get(color));
    mesh.position.set(x, y + h / 2, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  if (stage === 0) {
    add(0, 0, 0, 6.4, 0.12, 3.8, '#28271f');
    for (let i = 0; i < 5; i++) {
      add(-2.7 + i * 1.3, 0.13, 0.1 * Math.sin(i), 0.17, 0.05, 3.1, '#554832');
      for (const side of [-1, 1]) {
        const offset = Math.sin(i * 2.3 + side) * 0.16;
        add(-2.7 + i * 1.3, 0.05, side * (2.15 + offset), 1.45, 0.38, 1.5, '#625239', true);
        if (i !== 2)
          add(
            -2.7 + i * 1.3,
            0.27,
            side * (2.2 + offset),
            1.3,
            0.43,
            0.86,
            i % 2 ? '#786648' : '#6b593d',
            true,
          );
        add(-2.7 + i * 1.3, 0.1, side * 1.73, 1.24, 0.48, 0.13, '#40372a');
      }
    }
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) add(side * 3.4, 0.04, end * 1.6, 1.0, 0.5, 1.1, '#6b6047', true);
      for (let i = 0; i < 6; i++)
        add(-3 + i * 1.2, 0.13, side * 2.1, 0.69, 0.42, 0.53, i % 2 ? '#817258' : '#736447', true);
    }
  } else if (stage === 1) {
    for (const side of [-1, 1])
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 6; i++)
          add(
            -3 + i * 1.2 + (row ? 0.25 : 0),
            0.55 + row * 0.55,
            side * 2.1,
            0.7,
            0.34,
            0.5,
            i % 2 ? '#7d7255' : '#8d7c5d',
            true,
          );
        for (const i of [0, 2])
          add(side * 3.5, 0.55 + row * 0.55, -1.2 + i * 1.2, 0.5, 0.34, 0.7, '#786b51', true);
      }
  } else {
    for (const side of [-1, 1]) {
      add(side * 3.3, 0.1, -2.7, 0.22, 1.35, 0.22, '#53594d');
      add(side * 3.3, 0.1, -0.4, 0.22, 1.2, 0.22, '#53594d');
      add(side * 3.1, 0.15, 2.8, 0.24, 1.8, 0.24, '#71644b');
    }
    // Short open timber sections keep occupants readable from above.
    for (const side of [-1, 1]) {
      for (let row = 0; row < 4; row++)
        add(side * 3.1, 0.12 + row * 0.26, -0.7, 0.17, 0.21, 2.5, row % 2 ? '#6a5940' : '#776448');
      add(side * 2.6, 1.22, -2.35, 1.8, 0.35, 0.7, '#7f7154', true);
    }
    add(-2.3, 0.3, -2.5, 1.5, 0.7, 1, '#655c46');
    add(2.3, 0.3, -2.5, 1.1, 0.9, 0.8, '#4c5948');
  }
  batchStatic(root);
  box.dispose();
  bag.dispose();
  for (const material of materials.values()) material.dispose();
  return root.children[0];
}

// Three fixed batches replace one mesh tree per position. Advancement changes instance counts.
export class FortificationView {
  constructor(scene, { height = () => 0, visible = () => true } = {}) {
    this.height = height;
    this.visible = visible;
    this.models = new Map();
    this.seen = new Set();
    this.dummy = new T.Object3D();
    this.capacity = FORTIFICATION.maxPositions;
    this.pools = Array.from({ length: 3 }, (_, stage) => {
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
        this.models.set(t.id, {
          level: status.level,
          x: t.x,
          z: t.z,
          yaw,
          side: t.side,
          progress: status.progress,
          y: moved ? Math.max(0, this.height(t.x, t.z)) + 0.07 : previous.y,
        });
        dirty = true;
      }
    }
    for (const id of this.models.keys())
      if (!seen.has(id)) {
        this.models.delete(id);
        dirty = shadowsChanged = true;
      }
    const counts = [0, 0, 0];
    if (dirty)
      for (const record of this.models.values()) {
        const d = this.dummy;
        d.position.set(record.x, record.y, record.z);
        d.rotation.set(0, record.yaw, 0);
        d.scale.set(1, 0.15 + record.progress * 0.85, 1);
        d.updateMatrix();
        this.pools[0].setMatrixAt(counts[0]++, d.matrix);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        if (record.level >= 2) this.pools[1].setMatrixAt(counts[1]++, d.matrix);
        if (record.level >= 3) this.pools[2].setMatrixAt(counts[2]++, d.matrix);
      }
    if (dirty)
      for (let i = 0; i < 3; i++) {
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
      links: this.links.diagnostics(),
      batches: 6,
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

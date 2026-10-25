import * as T from '../../../vendor/three/three.module.js';
import { factionHex } from '../team-colors.js';
import { segmentDistance } from '../../game/city/road-network.js';

const INITIAL_CAPACITY = 32;
export class AmmoCrateView {
  constructor(scene, { height = () => 0 } = {}) {
    this.scene = scene;
    this.height = height;
    this.ids = [];
    this.signature = null;
    this.dummy = new T.Object3D();
    this.color = new T.Color();
    this.box = new T.BoxGeometry();
    this.ring = new T.RingGeometry(0.86, 1, 24);
    const wood = new T.MeshStandardMaterial({ color: '#78806a', roughness: 0.95 });
    const lid = new T.MeshStandardMaterial({ color: '#a2a78b', roughness: 0.9 });
    const strap = new T.MeshStandardMaterial({ color: '#39483f', roughness: 0.8 });
    const marker = new T.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      side: T.DoubleSide,
    });
    const icon = new T.MeshBasicMaterial({ color: '#dec58b' });
    this.materials = [wood, lid, strap, marker, icon];
    this.meshes = [];
    this.allocate(INITIAL_CAPACITY);
  }
  allocate(capacity) {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    this.capacity = capacity;
    this.meshes = this.materials.map((material, index) => {
      const mesh = new T.InstancedMesh(
        index === 3 ? this.ring : this.box,
        material,
        capacity * (index === 2 ? 2 : index === 4 ? 3 : 1),
      );
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = index < 2;
      mesh.receiveShadow = index < 3;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.name = `field-ammo-crates-${index}`;
      mesh.userData.crateIds = this.ids;
      this.scene.add(mesh);
      return mesh;
    });
    this.pickTargets = this.meshes.slice(0, 2);
  }
  put(mesh, index, x, y, z, sx, sy, sz, rotation = 0) {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(rotation, 0, 0);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }
  sync(state) {
    if (this.disposed) return;
    const crates = (state.ammoCrates || []).filter((c) => c.hp > 0);
    const signature =
      `${state.networkRevision ?? 0}:` +
      crates.map((c) => `${c.id}/${c.side}/${c.x}/${c.z}`).join('|');
    if (signature === this.signature) return;
    if (crates.length > this.capacity) {
      let capacity = this.capacity;
      while (capacity < crates.length) capacity *= 2;
      this.allocate(capacity);
    }
    this.signature = signature;
    this.ids.length = 0;
    for (const [i, c] of crates.entries()) {
      this.ids.push(c.id);
      const onRoad = (state.roads || []).some(
        (r) => !r.removed && r.hp > 0 && segmentDistance(c.x, c.z, r.ax, r.az, r.bx, r.bz) < 4.5,
      );
      const y = Math.max(0, this.height(c.x, c.z)) + (onRoad ? 0.6 : 0);
      this.put(this.meshes[0], i, c.x, y + 1.5, c.z, 5, 2.8, 4);
      this.put(this.meshes[1], i, c.x, y + 3, c.z, 5.4, 0.35, 4.4);
      for (let j = 0; j < 2; j++)
        this.put(this.meshes[2], i * 2 + j, c.x + (j ? 1.8 : -1.8), y + 1.7, c.z, 0.22, 3.2, 4.5);
      this.put(this.meshes[3], i, c.x, y + 0.12, c.z, 4.8, 4.8, 1, -Math.PI / 2);
      for (let j = 0; j < 3; j++)
        this.put(this.meshes[4], i * 3 + j, c.x + (j - 1) * 0.65, y + 3.21, c.z, 0.35, 0.12, 1.4);
      this.color.set(factionHex(c.side));
      this.meshes[3].setColorAt(i, this.color);
    }
    for (const [index, mesh] of this.meshes.entries()) {
      mesh.count = crates.length * (index === 2 ? 2 : index === 4 ? 3 : 1);
      mesh.visible = mesh.count > 0;
      if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
      mesh.boundingSphere = null;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  pick(ray) {
    const hit = ray.intersectObjects(
      this.pickTargets.filter((m) => m.visible),
      false,
    )[0];
    return hit ? (this.ids[hit.instanceId] ?? null) : null;
  }
  diagnostics() {
    return {
      crates: this.ids.length,
      capacity: this.capacity,
      draws: this.ids.length ? 5 : 0,
      disposed: !!this.disposed,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.meshes) {
      m.removeFromParent();
      m.dispose();
    }
    this.box.dispose();
    this.ring.dispose();
    for (const m of this.materials) m.dispose();
    this.ids.length = 0;
  }
}

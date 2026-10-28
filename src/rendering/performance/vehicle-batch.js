import * as T from '../../../vendor/three/three.module.js';
import { writeInstanceMatrix, finishInstanceUpdates } from './instance-updates.js';

// The original hierarchy remains a logical/picking proxy. Its turret, pitch, recoil and
// muzzle matrices keep their contracts, while shared geometry is drawn once per part.
export class VehicleBatch {
  constructor(scene, { castShadows = false, filterPart = () => true, tag = 'vehicleBatch' } = {}) {
    this.scene = scene;
    this.castShadows = castShadows;
    this.filterPart = filterPart;
    this.tag = tag;
    this.groups = new Map();
    this.records = new Map();
    this.seen = new Set();
    this.local = new T.Matrix4();
    this.matrix = new T.Matrix4();
    this.projection = new T.Matrix4();
    this.frustum = new T.Frustum();
    this.sphere = new T.Sphere(new T.Vector3(), 30);
    this.visibleEntities = 0;
    this.generation = 0;
  }
  groupFor(part) {
    const materials = Array.isArray(part.material) ? part.material : [part.material];
    const key = `${part.geometry.uuid}/${materials.map((m) => m.uuid).join('/')}/${part.receiveShadow}/${part.renderOrder}/${this.castShadows && part.castShadow}`;
    let group = this.groups.get(key);
    if (!group) {
      group = {
        geometry: part.geometry,
        material: part.material,
        capacity: 256,
        count: 0,
        receiveShadow: part.receiveShadow,
        renderOrder: part.renderOrder,
        castShadow: this.castShadows && part.castShadow,
      };
      this.groups.set(key, group);
      this.allocate(group);
    }
    return group;
  }
  allocate(group) {
    const old = group.mesh;
    const mesh = new T.InstancedMesh(group.geometry, group.material, group.capacity);
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.castShadow = group.castShadow;
    mesh.receiveShadow = group.receiveShadow;
    mesh.renderOrder = group.renderOrder;
    mesh.frustumCulled = false; // Cull complete logical vehicles, not stale aggregate bounds.
    mesh.userData[this.tag] = true;
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, group.count * 16));
      old.removeFromParent();
      old.dispose();
    }
    group.mesh = mesh;
    this.scene.add(mesh);
  }
  register(root) {
    root.userData.batchedVisual = true;
    const parts = [];
    root.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.visible || !this.filterPart(mesh)) return;
      parts.push({ mesh, group: this.groupFor(mesh), castShadow: mesh.castShadow });
      mesh.visible = false;
      mesh.castShadow = false;
    });
    this.records.set(root, parts);
    return parts;
  }
  sync(models, camera = null, include = null) {
    const generation = ++this.generation;
    this.seen.clear();
    this.visibleEntities = 0;
    for (const group of this.groups.values()) group.count = 0;
    if (camera) {
      camera.updateMatrixWorld();
      this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.projection);
    }
    for (const root of models.values()) {
      this.seen.add(root);
      const parts = this.records.get(root) || this.register(root);
      if (!root.visible || !parts.length) continue;
      if (include && !include(root)) continue;
      if (camera) {
        this.sphere.center.copy(root.position);
        if (!this.frustum.intersectsSphere(this.sphere)) continue;
      }
      this.visibleEntities++;
      root.updateWorldMatrix(true, true);
      for (const part of parts) {
        const { mesh, group } = part;
        let shown = true;
        for (let parent = mesh.parent; parent && parent !== root; parent = parent.parent)
          if (!parent.visible) {
            shown = false;
            break;
          }
        if (!shown) continue;
        const count = mesh.isInstancedMesh ? mesh.count : 1;
        // Generic CPU proxies may call setMatrixAt without needsUpdate. Only the
        // drive producer opts into versioned input, keeping that old contract.
        const stable =
          mesh.isInstancedMesh && mesh.userData.versionedDrive
            ? part.stable || (part.stable = { world: new Float64Array(16) })
            : null;
        const start = group.count;
        // Culling can let another part overwrite this slot between emissions.
        // Attribute IDs are immutable and avoid retaining retired grown buffers.
        let unchanged =
          stable &&
          stable.generation === generation - 1 &&
          stable.source === mesh.instanceMatrix &&
          stable.array === mesh.instanceMatrix.array &&
          stable.version === mesh.instanceMatrix.version &&
          stable.count === count &&
          stable.destinationId === group.mesh.instanceMatrix.id &&
          stable.start === start;
        if (unchanged)
          for (let i = 0; i < 16; i++) {
            if (stable.world[i] !== mesh.matrixWorld.elements[i]) {
              unchanged = false;
              break;
            }
          }
        if (unchanged) {
          group.count += count;
          stable.generation = generation;
          continue;
        }
        for (let i = 0; i < count; i++) {
          if (group.count === group.capacity) {
            group.capacity *= 2;
            this.allocate(group);
          }
          if (mesh.isInstancedMesh) {
            mesh.getMatrixAt(i, this.local);
            this.matrix.multiplyMatrices(mesh.matrixWorld, this.local);
          } else this.matrix.copy(mesh.matrixWorld);
          writeInstanceMatrix(group.mesh, group.count++, this.matrix);
        }
        if (stable) {
          stable.world.set(mesh.matrixWorld.elements);
          stable.source = mesh.instanceMatrix;
          stable.array = mesh.instanceMatrix.array;
          stable.version = mesh.instanceMatrix.version;
          stable.count = count;
          stable.destinationId = group.mesh.instanceMatrix.id;
          stable.start = start;
          stable.generation = generation;
        }
      }
    }
    for (const root of this.records.keys()) if (!this.seen.has(root)) this.records.delete(root);
    for (const group of this.groups.values()) {
      finishInstanceUpdates(group.mesh, group.count);
    }
  }
  diagnostics() {
    return {
      entities: this.visibleEntities,
      proxies: this.records.size,
      batches: [...this.groups.values()].filter((g) => g.count).length,
    };
  }
  dispose() {
    for (const root of this.records.keys()) delete root.userData.batchedVisual;
    for (const parts of this.records.values())
      for (const part of parts) {
        part.mesh.visible = true;
        part.mesh.castShadow = part.castShadow;
      }
    for (const group of this.groups.values()) {
      group.mesh.removeFromParent();
      group.mesh.dispose();
    }
    this.groups.clear();
    this.records.clear();
    this.seen.clear();
  }
}

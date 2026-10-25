import { VehicleBatch } from './vehicle-batch.js';
import { STATIC_BUILDING_KEYS } from '../models/buildings.js';
import * as T from '../../../vendor/three/three.module.js';

// Keep each building's hierarchy as its picking, scaffold and damage proxy.
// Opaque shared static parts draw in batches; transparent lights and new rubble
// retain the original renderer's sorting and lifetime.
export class BuildingBatch extends VehicleBatch {
  constructor(scene) {
    super(scene, {
      castShadows: true,
      tag: 'buildingBatch',
      filterPart: (mesh) => !Array.isArray(mesh.material) && !mesh.material.transparent,
    });
    this.roots = new Map();
    this.viewFrustum = new T.Frustum();
    this.shadowFrustum = new T.Frustum();
    this.viewProjection = new T.Matrix4();
    this.bounds = new T.Sphere(new T.Vector3(), 65);
    this.lastView = new T.Matrix4();
    this.lastShadow = new T.Matrix4();
    this.states = new Map();
    this.initialized = false;
  }
  sync(models, camera = null, sun = null) {
    let dirty = !this.initialized,
      count = 0;
    for (const [id, model] of models) {
      if (!STATIC_BUILDING_KEYS.has(model.root.userData.buildingKey)) continue;
      count++;
      const content = model.content,
        old = this.states.get(id),
        root = model.root;
      const values = [
        root,
        root.visible,
        content.visible,
        content.scale.y,
        content.position.y,
        content.rotation.x,
        content.rotation.z,
        model.scaffold.visible,
      ];
      if (!old || values.some((value, index) => value !== old[index])) {
        dirty = true;
        this.states.set(id, values);
      }
    }
    if (count !== this.roots.size) dirty = true;
    if (camera) {
      camera.updateMatrixWorld();
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      if (!this.lastView.equals(this.viewProjection)) {
        dirty = true;
        this.lastView.copy(this.viewProjection);
      }
      this.viewFrustum.setFromProjectionMatrix(this.viewProjection);
    }
    const shadow = !!sun?.shadow;
    if (this.hadShadow !== shadow || this.hadCamera !== !!camera) dirty = true;
    this.hadShadow = shadow;
    this.hadCamera = !!camera;
    if (shadow) {
      sun.updateMatrixWorld();
      sun.target.updateMatrixWorld();
      sun.shadow.updateMatrices(sun);
      const lightCamera = sun.shadow.camera;
      this.viewProjection.multiplyMatrices(
        lightCamera.projectionMatrix,
        lightCamera.matrixWorldInverse,
      );
      if (!this.lastShadow.equals(this.viewProjection)) {
        dirty = true;
        this.lastShadow.copy(this.viewProjection);
      }
      this.shadowFrustum.setFromProjectionMatrix(this.viewProjection);
    }
    if (!dirty) return;
    this.initialized = true;
    this.roots.clear();
    for (const [id, model] of models)
      if (STATIC_BUILDING_KEYS.has(model.root.userData.buildingKey)) this.roots.set(id, model.root);
    for (const id of this.states.keys()) if (!this.roots.has(id)) this.states.delete(id);
    super.sync(
      this.roots,
      null,
      camera
        ? (root) => {
            this.bounds.center.copy(root.position);
            this.bounds.center.y += 20;
            return (
              this.viewFrustum.intersectsSphere(this.bounds) ||
              (shadow && this.shadowFrustum.intersectsSphere(this.bounds))
            );
          }
        : null,
    );
  }
  dispose() {
    super.dispose();
    this.roots.clear();
    this.states.clear();
    this.initialized = false;
  }
}

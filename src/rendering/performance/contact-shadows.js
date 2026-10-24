import * as T from '../../../vendor/three/three.module.js';
import { groundHeight, isInfantry, GROUND_UNITS } from '../../game/config.js';

export class ContactShadows {
  constructor(scene, capacity = 240) {
    this.capacity = capacity;
    const size = 32,
      data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const radius = Math.hypot(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1);
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = Math.round(Math.max(0, 1 - radius * radius) ** 2 * 150);
      }
    this.texture = new T.DataTexture(data, size, size);
    this.texture.needsUpdate = true;
    this.geometry = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.material = new T.MeshBasicMaterial({
      color: '#111713',
      map: this.texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new T.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.dummy = new T.Object3D();
  }
  sync(units, visible) {
    let count = 0;
    for (const u of units) {
      if (count === this.capacity) break;
      if (!visible.has(u.id) || u.hp <= 0 || u.carrierId) continue;
      const infantry = isInfantry(u.key) && u.key !== 'mog';
      const size = infantry ? 2.6 : Math.max(6, GROUND_UNITS[u.key]?.size || 10);
      this.dummy.position.set(u.x, groundHeight(u.x, u.z) + 0.66, u.z);
      this.dummy.rotation.set(0, u.yaw || 0, 0);
      this.dummy.scale.set(size * (infantry ? 1 : 1.1), 1, size * (infantry ? 1 : 1.5));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count++, this.dummy.matrix);
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count) this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

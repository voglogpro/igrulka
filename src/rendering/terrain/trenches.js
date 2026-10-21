import * as T from '../../../vendor/three/three.module.js';
import { batchStatic } from '../mesh-utils.js';
export function syncTrenches() {
  for (const t of this.state.trenches || []) {
    let m = this.trenchModels.get(t.id);
    if (!m) {
      m = new T.Group();
      m.position.set(t.x, 0.06, t.z);
      m.rotation.y = t.yaw || 0;
      this.box(m, 0, 0, 0, 6, 0.12, 3.5, '#29332a');
      for (const z of [-2.1, 2.1]) this.box(m, 0, 0.1, z, 7, 0.85, 1, '#706049');
      for (const x of [-3.5, 3.5]) this.box(m, x, 0.1, 0, 1, 0.85, 4, '#7e6b4c');
      batchStatic(m);
      this.scene.add(m);
      this.trenchModels.set(t.id, m);
      this.renderer.shadowMap.needsUpdate = true;
    }
    m.scale.y = 0.15 + t.progress * 0.85;
  }
  const contacts = this.state.contacts?.[0] || [];
  this.contactRings.count = Math.min(300, contacts.length);
  for (let i = 0; i < this.contactRings.count; i++) {
    const c = contacts[i];
    this.contactDummy.position.set(c.x, 1.5, c.z);
    this.contactDummy.rotation.set(-Math.PI / 2, 0, 0);
    this.contactDummy.scale.setScalar(c.radius);
    this.contactDummy.updateMatrix();
    this.contactRings.setMatrixAt(i, this.contactDummy.matrix);
  }
  this.contactRings.instanceMatrix.needsUpdate = true;
}

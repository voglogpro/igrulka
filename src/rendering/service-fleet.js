import * as T from '../../vendor/three/three.module.js';
import { batchStatic } from './mesh-utils.js';
import { ContactShadows } from './performance/contact-shadows.js';

const PER_SIDE = 8;
const CAPACITY = PER_SIDE * 4;
// roads.js asphalt: base -0.05 plus 0.6 thickness; independent of legacy bridge heights.
const ROAD_LEVEL = 0.55;
const VAN_BASE = 0.5;
const EMPTY = [];
const groundLevel = () => 0;
const visibleByDefault = () => true;

// Build once; every van instance shares the resulting two batched geometries.
function vanTemplate(paint = '#bd793f') {
  const body = new T.Group(),
    lamps = new T.Group(),
    box = new T.BoxGeometry(1, 1, 1),
    wheel = new T.CylinderGeometry(0.67, 0.67, 0.5, 10),
    materials = new Map(),
    lampMaterial = new T.MeshBasicMaterial({ color: '#ffe0a0', toneMapped: false });
  function part(x, y, z, width, height, depth, color) {
    if (!materials.has(color))
      materials.set(color, new T.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.15 }));
    const mesh = new T.Mesh(box, materials.get(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh);
    return mesh;
  }
  const orange = paint,
    dark = '#273438',
    trim = '#d4c8a6',
    glass = '#38535a';
  part(0, 1.15, 0, 3.2, 1.15, 6.6, orange);
  part(0, 2.4, -1.1, 3.15, 1.8, 4.3, orange);
  part(0, 2.1, 1.6, 2.95, 1.3, 1.9, glass);
  part(0, 2.9, 1.5, 3.15, 0.3, 2.1, orange);
  part(0, 1.15, 3.4, 3.4, 0.4, 0.45, dark);
  part(0, 1, -3.4, 3.4, 0.4, 0.4, dark);
  part(0, 1.55, 3.32, 1.4, 0.5, 0.15, dark);
  part(0, 1.8, 2.65, 3.1, 0.25, 1.1, orange);
  part(0, 3.5, -0.3, 1.2, 0.16, 0.6, dark);
  part(0, 2.35, -3.3, 0.12, 1.8, 0.12, dark);
  for (const side of [-1, 1]) {
    part(side * 1.6, 1.9, -1.1, 0.06, 0.24, 4.25, trim);
    part(side * 1.64, 2.6, -1.4, 0.08, 0.75, 0.2, trim);
    part(side * 1.65, 2.6, -1.4, 0.09, 0.2, 0.9, trim);
    part(side * 1.6, 2.45, 0.7, 0.08, 0.5, 0.15, dark);
    part(side * 1.85, 2.3, 1.6, 0.5, 0.45, 0.35, dark);
    part(side * 1.2, 1.4, -3.34, 0.4, 0.5, 0.13, '#a55039');
    // Roof ladder and equipment rack.
    part(side * 1.05, 3.48, -1.5, 0.12, 0.15, 3.1, trim);
    for (const z of [-2.2, 2.1]) {
      const tire = new T.Mesh(wheel, materials.get(dark));
      tire.rotation.z = Math.PI / 2;
      tire.position.set(side * 1.6, 0.78, z);
      tire.castShadow = true;
      tire.receiveShadow = true;
      body.add(tire);
      part(side * 1.87, 0.78, z, 0.08, 0.65, 0.65, '#7d8883');
    }
    const lamp = new T.Mesh(box, lampMaterial);
    lamp.position.set(side * 1.1, 1.5, 3.35);
    lamp.scale.set(0.6, 0.3, 0.1);
    lamps.add(lamp);
  }
  for (const z of [-2.7, -2, -1.3, -0.6]) part(0, 3.48, z, 2.15, 0.12, 0.1, trim);
  batchStatic(body);
  batchStatic(lamps);
  box.dispose();
  wheel.dispose();
  for (const material of materials.values()) material.dispose();
  // Standard colors are folded into vertex colors; the untextured lamp material is reused.
  return { body: body.children[0], lamps: lamps.children[0] };
}

/** A bounded visual mirror of simulation vehicles. No paths, selection or gameplay state. */
export class ServiceFleet {
  constructor(
    scene,
    {
      height = groundLevel,
      visible = visibleByDefault,
      collection = 'serviceVehicles',
      paint = '#bd793f',
    } = {},
  ) {
    this.height = height;
    this.visible = visible;
    this.collection = collection;
    this.shadowUnits = [];
    this.shadowIds = new Set();
    this.shadows = new ContactShadows(scene, CAPACITY);
    this.poses = new Float64Array(CAPACITY * 4);
    this.flags = new Uint8Array(CAPACITY);
    this.count = 0;
    this.repairing = 0;
    this.disposed = false;
    this.dummy = new T.Object3D();
    const template = vanTemplate(paint);
    this.body = new T.InstancedMesh(template.body.geometry, template.body.material, CAPACITY);
    this.lamps = new T.InstancedMesh(template.lamps.geometry, template.lamps.material, CAPACITY);
    const amber = new T.MeshBasicMaterial({ color: '#ffbd59', toneMapped: false });
    this.beacons = new T.InstancedMesh(new T.BoxGeometry(1.1, 0.32, 0.28), amber, CAPACITY);
    this.work = new T.InstancedMesh(new T.TorusGeometry(1.35, 0.09, 4, 16), amber, CAPACITY);
    this.meshes = [this.body, this.lamps, this.beacons, this.work];
    this.body.castShadow = false;
    this.body.receiveShadow = true;
    for (const mesh of this.meshes) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.name = 'service-fleet';
      scene.add(mesh);
    }
  }

  // Call on a new simulation snapshot, or once per frame if positions are interpolated elsewhere.
  sync(state) {
    if (this.disposed) return;
    const counts = [0, 0, 0, 0];
    let count = 0;
    this.shadowIds.clear();
    for (const vehicle of state[this.collection] || EMPTY) {
      if (vehicle.hp != null && vehicle.hp <= 0) continue;
      if (!Number.isInteger(vehicle.side) || vehicle.side < 0 || vehicle.side > 3) continue;
      if (!Number.isFinite(vehicle.x) || !Number.isFinite(vehicle.z)) continue;
      if (counts[vehicle.side] >= PER_SIDE || !this.visible(state, vehicle)) continue;
      counts[vehicle.side]++;
      const offset = count * 4,
        level = Math.max(0, this.height(vehicle.x, vehicle.z)),
        yaw = Number.isFinite(vehicle.yaw) ? vehicle.yaw : 0,
        status = vehicle.state || vehicle.status,
        working = ['repairing', 'unloading'].includes(status);
      const shadow = (this.shadowUnits[count] ||= { key: 'supplytruck', hp: 1 });
      Object.assign(shadow, { id: vehicle.id, x: vehicle.x, z: vehicle.z, yaw });
      this.shadowIds.add(vehicle.id);
      this.poses[offset] = vehicle.x;
      this.poses[offset + 1] = level;
      this.poses[offset + 2] = vehicle.z;
      this.poses[offset + 3] = yaw;
      this.flags[count] = working ? 3 : status === 'outbound' || status === 'returning' ? 1 : 0;
      const d = this.dummy;
      d.position.set(vehicle.x, level + VAN_BASE, vehicle.z);
      d.rotation.set(0, yaw, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.body.setMatrixAt(count, d.matrix);
      this.lamps.setMatrixAt(count, d.matrix);
      count++;
    }
    this.count = count;
    this.shadowUnits.length = count;
    this.shadows.sync(this.shadowUnits, this.shadowIds);
    this.body.count = this.lamps.count = count;
    this.body.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    this.update(Number.isFinite(state.time) ? state.time : 0);
  }

  // The supplied battle clock freezes both the beacon and the repair marker during pause.
  update(time) {
    if (this.disposed) return;
    const clock = Number.isFinite(time) ? time : 0,
      d = this.dummy;
    let repairing = 0;
    for (let i = 0; i < this.count; i++) {
      const offset = i * 4,
        x = this.poses[offset],
        level = this.poses[offset + 1],
        z = this.poses[offset + 2],
        yaw = this.poses[offset + 3],
        working = (this.flags[i] & 2) !== 0,
        active = (this.flags[i] & 1) !== 0;
      d.position.set(x, level + VAN_BASE + 3.7, z);
      d.rotation.set(0, yaw + clock * 5 + i * 0.7, 0);
      d.scale.setScalar(active ? 1 : 0.45);
      d.updateMatrix();
      this.beacons.setMatrixAt(i, d.matrix);
      if (!working) continue;
      d.position.set(x + Math.sin(yaw) * 4.7, level + ROAD_LEVEL + 0.2, z + Math.cos(yaw) * 4.7);
      d.rotation.set(-Math.PI / 2, 0, clock * 0.8);
      d.scale.setScalar(1 + Math.sin(clock * 5 + i) * 0.1);
      d.updateMatrix();
      this.work.setMatrixAt(repairing++, d.matrix);
    }
    this.repairing = repairing;
    this.beacons.count = this.count;
    this.work.count = repairing;
    this.beacons.instanceMatrix.needsUpdate = true;
    this.work.instanceMatrix.needsUpdate = true;
  }

  diagnostics() {
    return {
      vehicles: this.count,
      repairing: this.repairing,
      capacity: CAPACITY,
      drawCalls: this.disposed || !this.count ? 0 : this.repairing ? 5 : 4,
      disposed: this.disposed,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.shadows.dispose();
    const materials = new Set();
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      materials.add(mesh.material);
      mesh.dispose();
      mesh.count = 0;
    }
    for (const material of materials) material.dispose();
    this.count = this.repairing = 0;
  }
}

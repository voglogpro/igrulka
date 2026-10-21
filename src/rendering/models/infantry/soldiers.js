import * as T from '../../../../vendor/three/three.module.js';
import { GROUND_UNITS, isInfantry } from '../../../game/config.js';
import { groundVisible, coverInfo } from '../../../game/units/infantry/cover.js';
const temp = new T.Object3D(),
  normal = new T.Vector3(),
  vertex = new T.Vector3();
function bodyGeometry(w, key, side) {
  const root = new T.Group(),
    paint = side === 0 ? '#75836b' : '#8f7966',
    skin = '#b6a085',
    dark = '#263c32',
    d = GROUND_UNITS[key];
  w.box(root, 0, 1.2, 0, 0.95, 1.18, 0.65, paint);
  w.box(root, 0, 1.65, -0.5, 0.8, 0.8, 0.48, '#4c5a44');
  w.box(root, 0, 1.45, 0.39, 0.85, 0.65, 0.2, '#526348');
  w.cyl(root, 0, 2.4, 0, 0.3, 0.4, skin);
  w.cyl(root, 0, 2.76, 0, 0.44, 0.25, paint);
  w.box(root, -0.52, 1.35, 0, 0.32, 0.95, 0.42, paint);
  w.box(root, 0.52, 1.7, 0.2, 0.32, 0.42, 0.8, paint);
  w.box(
    root,
    0.6,
    1.78,
    0.95,
    key === 'machinegunner' ? 0.22 : 0.14,
    0.17,
    key === 'sniper' ? 2.8 : 1.7,
    dark,
  );
  w.box(root, 0.58, 1.55, 0.45, 0.22, 0.5, 0.35, dark);
  if (key === 'sniper') {
    w.box(root, 0.59, 2, 0.65, 0.16, 0.16, 0.5, '#384e43');
    w.box(root, 0, 2.4, -0.2, 1.2, 0.5, 0.9, '#657752');
  }
  if (key === 'engineer') {
    w.box(root, -0.65, 1.4, -0.3, 0.15, 1.5, 0.2, '#b5ac89');
    w.box(root, -0.65, 2.5, -0.3, 0.5, 0.55, 0.16, '#4d5548');
  }
  if (key === 'operator') {
    w.box(root, 0, 1.5, 0.75, 0.9, 0.18, 0.6, '#273e3b');
    w.box(root, 0.3, 1.7, 0.8, 0.04, 0.7, 0.04, '#a3b5a0');
    w.box(root, 0, 2.48, 0.33, 0.68, 0.28, 0.2, '#253a3a');
  }
  if (key === 'assault') {
    w.box(root, 0, 2.4, 0.32, 0.65, 0.28, 0.22, '#364b43');
    w.box(root, 0, 1.3, 0.65, 0.4, 0.7, 0.14, '#78816b');
  }
  if (key === 'mog') {
    w.box(root, 0, 1.3, 0.4, 0.9, 0.7, 0.2, '#485d47');
  }
  root.updateMatrixWorld(true);
  let count = 0;
  root.traverse((m) => {
    if (m.isMesh) count += m.geometry.index?.count || m.geometry.attributes.position.count;
  });
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3),
    colors = new Float32Array(count * 3);
  let cursor = 0;
  root.traverse((m) => {
    if (!m.isMesh) return;
    const g = m.geometry,
      mat = new T.Matrix3().getNormalMatrix(m.matrixWorld),
      p = g.attributes.position,
      n = g.attributes.normal,
      indices = g.index,
      color = m.material.color;
    for (let j = 0; j < (indices?.count || p.count); j++, cursor++) {
      const i = indices ? indices.getX(j) : j;
      vertex.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      normal.fromBufferAttribute(n, i).applyNormalMatrix(mat);
      positions.set([vertex.x, vertex.y, vertex.z], cursor * 3);
      normals.set([normal.x, normal.y, normal.z], cursor * 3);
      colors.set([color.r, color.g, color.b], cursor * 3);
    }
  });
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
// Two instanced draws per active role/side, independent of the number of soldiers.
export class InfantryBatch {
  constructor(w) {
    this.world = w;
    this.pools = new Map();
    this.material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
    this.meshes = [];
    this.selected = new T.InstancedMesh(
      new T.RingGeometry(0.9, 1, 24),
      new T.MeshBasicMaterial({
        color: '#b9e5bd',
        transparent: true,
        opacity: 0.8,
        side: T.DoubleSide,
        depthWrite: false,
      }),
      600,
    );
    this.selected.frustumCulled = false;
    w.scene.add(this.selected);
    this.selected.count = 0;
  }
  pool(key, side) {
    const id = key + side;
    if (!this.pools.has(id)) {
      const body = new T.InstancedMesh(bodyGeometry(this.world, key, side), this.material, 512),
        legs = new T.InstancedMesh(
          this.world.boxGeo,
          this.world.mat(side === 0 ? '#3c4d3f' : '#52483b'),
          1024,
        );
      body.frustumCulled = legs.frustumCulled = false;
      body.instanceMatrix.setUsage(T.DynamicDrawUsage);
      legs.instanceMatrix.setUsage(T.DynamicDrawUsage);
      body.userData.infantryBatch = true;
      legs.userData.infantryBatch = true;
      body.userData.unitIds = [];
      legs.userData.unitIds = [];
      body.castShadow = legs.castShadow = false;
      this.world.scene.add(body, legs);
      this.meshes.push(body, legs);
      this.pools.set(id, { body, legs, count: 0 });
    }
    return this.pools.get(id);
  }
  sync(units, time) {
    for (const p of this.pools.values()) p.count = 0;
    let selected = 0;
    for (const u of units) {
      if (!isInfantry(u.key) || !groundVisible(this.world.state, 0, u)) continue;
      const d = GROUND_UNITS[u.key],
        pool = this.pool(u.key, u.side),
        members = Math.max(1, Math.ceil(((d.members || 1) * u.hp) / u.maxHp)),
        cover = coverInfo(this.world.state, u),
        crouch =
          (u.key === 'mog' && (u.setup || 0) > 0.8) ||
          u.digging ||
          u.trenchId ||
          u.camouflaged ||
          u.suppression > 0.55,
        angle =
          Number.isFinite(u.targetX) && !u.moving
            ? Math.atan2(u.targetX - u.x, u.targetZ - u.z)
            : u.yaw || 0;
      for (let m = 0; m < members && pool.count < 512; m++) {
        const x = members > 1 ? (m - 1) * 2.7 : 0,
          z = members > 1 ? (m % 2) * 2 - 1 : 0,
          c = Math.cos(angle),
          s = Math.sin(angle),
          wx = u.x + x * c + z * s,
          wz = u.z + z * c - x * s,
          index = pool.count++,
          height = crouch ? 0.67 : 1;
        const stride = u.moving ? Math.sin(time * 12 + m * 1.7) : 0;
        const recoil = Math.exp(-Math.max(0, time - (u.lastFire ?? -100)) * 22) * 0.06;
        temp.position.set(
          wx - Math.sin(angle) * recoil,
          (u.y || 1) + Math.abs(stride) * 0.055,
          wz - Math.cos(angle) * recoil,
        );
        temp.rotation.set(u.moving ? 0.065 : 0, angle, stride * 0.018);
        temp.scale.set(1, height, 1);
        temp.updateMatrix();
        pool.body.setMatrixAt(index, temp.matrix);
        pool.body.userData.unitIds[index] = u.id;
        for (let leg = 0; leg < 2; leg++) {
          const swing = u.moving ? Math.sin(time * 12 + m * 1.7 + leg * Math.PI) * 0.55 : 0;
          temp.position.set(
            wx + (leg ? 0.25 : -0.25) * c,
            (u.y || 1) + 0.62 * height,
            wz - (leg ? 0.25 : -0.25) * s,
          );
          temp.rotation.set(swing, angle, 0);
          temp.scale.set(0.31, 1.22 * height, 0.37);
          temp.updateMatrix();
          pool.legs.setMatrixAt(index * 2 + leg, temp.matrix);
          pool.legs.userData.unitIds[index * 2 + leg] = u.id;
        }
      }
      if (this.world.armySelection?.includes(u.id) && selected < 600) {
        temp.position.set(u.x, 1.4, u.z);
        temp.rotation.set(-Math.PI / 2, 0, 0);
        temp.scale.setScalar(u.key === 'mog' ? 7 : u.key === 'assault' ? 4.5 : 1.8);
        temp.updateMatrix();
        this.selected.setMatrixAt(selected++, temp.matrix);
      }
    }
    for (const u of units)
      if (
        !isInfantry(u.key) &&
        !u.carrierId &&
        this.world.armySelection?.includes(u.id) &&
        selected < 600
      ) {
        temp.position.set(u.x, 1.4, u.z);
        temp.rotation.set(-Math.PI / 2, 0, 0);
        temp.scale.setScalar(Math.max(4, GROUND_UNITS[u.key].size * 0.72));
        temp.updateMatrix();
        this.selected.setMatrixAt(selected++, temp.matrix);
      }
    for (const p of this.pools.values()) {
      p.body.count = p.count;
      p.legs.count = p.count * 2;
      p.body.instanceMatrix.needsUpdate = true;
      p.legs.instanceMatrix.needsUpdate = true;
    }
    this.selected.count = selected;
    this.selected.instanceMatrix.needsUpdate = true;
  }
}

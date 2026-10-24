import * as T from '../../../../vendor/three/three.module.js';
import { GROUND_UNITS, isInfantry } from '../../../game/config.js';
import { groundVisible } from '../../../game/units/infantry/cover.js';
import { buildInfantryAT } from './anti-tank.js';
const CORPSE_LIFE = 40,
  CORPSE_FALL = 0.45,
  CORPSE_LIMIT = 90;
const temp = new T.Object3D(),
  normal = new T.Vector3(),
  vertex = new T.Vector3(),
  frustum = new T.Frustum(),
  viewProjection = new T.Matrix4(),
  bounds = new T.Sphere(new T.Vector3(), 12);
// Centre-based helper: the shared world.box places boxes by their base.
function part(w, root, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) {
  const mesh = w.box(root, x, y - sy / 2, z, sx, sy, sz, color);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}
// Baked into the role geometry, so a private low-poly sphere is enough.
const SPHERE = new T.IcosahedronGeometry(1, 1);
function ball(w, root, x, y, z, sx, sy, sz, color) {
  const mesh = new T.Mesh(SPHERE, w.mat(color));
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  root.add(mesh);
  return mesh;
}
// Weapon held at the right shoulder and pointing forward (+z).
function weapon(w, root, key, dark) {
  const x = 0.2,
    y = 2.02,
    metal = '#1f2b26',
    furniture = '#3a3f33';
  if (key === 'machinegunner') {
    part(w, root, x, y - 0.02, -0.02, 0.14, 0.24, 0.55, furniture);
    part(w, root, x, y, 0.55, 0.2, 0.26, 0.75, metal);
    part(w, root, x, y + 0.02, 1.45, 0.08, 0.08, 1.25, metal);
    part(w, root, x, y + 0.03, 1.15, 0.15, 0.15, 0.55, '#2b3a33');
    part(w, root, x - 0.16, y - 0.2, 0.5, 0.3, 0.3, 0.32, '#4b5a3c');
    // Folded bipod and a belt hanging into the ammo box.
    part(w, root, x - 0.05, y - 0.12, 1.85, 0.04, 0.04, 0.5, metal, 0.4);
    part(w, root, x + 0.05, y - 0.12, 1.85, 0.04, 0.04, 0.5, metal, 0.4);
    part(w, root, x - 0.1, y - 0.05, 0.62, 0.06, 0.05, 0.25, '#b39a54');
    return;
  }
  if (key === 'sniper') {
    part(w, root, x, y - 0.03, -0.05, 0.13, 0.26, 0.55, furniture);
    part(w, root, x, y, 0.5, 0.14, 0.2, 0.7, '#3b4434');
    part(w, root, x, y + 0.02, 1.55, 0.06, 0.06, 1.5, metal);
    const scope = w.cyl(root, x, y + 0.18, 0.5, 0.07, 0.6, '#151d1a');
    scope.rotation.x = Math.PI / 2;
    scope.position.set(x, y + 0.2, 0.5);
    part(w, root, x, y + 0.2, 0.86, 0.13, 0.13, 0.06, '#5c8d8a');
    return;
  }
  const short = key === 'assault' || key === 'operator' || key === 'engineer';
  part(w, root, x, y - 0.03, -0.02, 0.12, 0.22, 0.45, furniture);
  part(w, root, x, y, 0.42, 0.14, 0.2, 0.5, metal);
  part(w, root, x, y + 0.01, short ? 0.85 : 0.92, 0.12, 0.14, short ? 0.38 : 0.52, '#2c3a31');
  part(w, root, x, y + 0.02, short ? 1.18 : 1.36, 0.05, 0.05, short ? 0.3 : 0.4, metal);
  part(w, root, x, y - 0.22, 0.5, 0.1, 0.32, 0.15, dark, 0.25);
  if (key === 'assault') part(w, root, x, y + 0.16, 0.45, 0.09, 0.09, 0.2, '#6f9a8d');
}
function bodyGeometry(w, key, side) {
  const root = new T.Group(),
    paint = side === 0 ? '#75836b' : '#8f7966',
    rig = side === 0 ? '#56654c' : '#6c5e4b',
    skin = '#b6a085',
    dark = '#263c32';
  // Belt, torso and plate carrier with magazine pouches.
  part(w, root, 0, 1.38, 0, 0.88, 0.28, 0.56, '#3d4536');
  part(w, root, 0, 1.88, 0, 0.9, 0.82, 0.54, paint);
  part(w, root, 0, 1.9, 0.2, 0.84, 0.7, 0.2, rig);
  part(w, root, 0, 1.92, -0.2, 0.82, 0.66, 0.16, rig);
  for (const px of [-0.26, 0, 0.26]) part(w, root, px, 1.66, 0.34, 0.2, 0.26, 0.1, '#4a5641');
  part(w, root, -0.38, 1.43, 0.12, 0.16, 0.22, 0.2, '#4a5641');
  // Shoulders and arms in a firing grip: right hand on the grip, left on the handguard.
  for (const sx of [-1, 1]) ball(w, root, sx * 0.5, 2.18, 0.02, 0.2, 0.17, 0.2, paint);
  part(w, root, 0.48, 2.0, 0.2, 0.2, 0.2, 0.5, paint, 0.55);
  part(w, root, 0.33, 1.92, 0.42, 0.17, 0.17, 0.42, paint, -0.1, -0.35);
  part(w, root, -0.47, 2.02, 0.28, 0.2, 0.2, 0.55, paint, 0.35, 0.35);
  part(w, root, -0.2, 1.96, 0.72, 0.17, 0.17, 0.55, paint, -0.05, 0.75);
  ball(w, root, 0.22, 1.93, 0.55, 0.1, 0.1, 0.1, skin);
  ball(w, root, 0.12, 1.98, 0.98, 0.1, 0.1, 0.1, skin);
  // Neck, face and helmet with a brim and goggles strap.
  part(w, root, 0, 2.38, 0, 0.22, 0.16, 0.22, skin);
  ball(w, root, 0, 2.58, 0.03, 0.24, 0.27, 0.25, skin);
  part(w, root, 0, 2.62, 0.25, 0.3, 0.07, 0.04, '#1d2422');
  if (key === 'sniper') {
    // Ghillie hood and shaggy shoulders break up the silhouette.
    ball(w, root, 0, 2.7, -0.03, 0.36, 0.3, 0.38, '#5f6e45');
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      part(
        w,
        root,
        Math.cos(a) * 0.42,
        2.1 + (i % 3) * 0.12,
        Math.sin(a) * 0.3,
        0.22,
        0.28,
        0.14,
        i % 2 ? '#6b7a4e' : '#56633d',
        0.3,
        a,
        0.4,
      );
    }
  } else {
    ball(w, root, 0, 2.74, 0, 0.33, 0.24, 0.35, paint);
    part(w, root, 0, 2.66, 0, 0.66, 0.05, 0.7, rig);
    if (key === 'assault' || key === 'operator')
      part(w, root, 0, 2.78, 0.3, 0.42, 0.1, 0.06, '#32514f');
  }
  // Backpack; heavier for support roles.
  const pack = key === 'machinegunner' || key === 'mog' || key === 'engineer' ? 0.85 : 0.6;
  part(w, root, 0, 1.95, -0.43, 0.68, pack, 0.32, '#4c5a44');
  part(w, root, 0, 2.2 + pack / 2, -0.43, 0.6, 0.14, 0.3, '#3d4a37');
  if (key !== 'atgm') weapon(w, root, key, dark);
  if (key === 'engineer') {
    part(w, root, -0.3, 2.15, -0.62, 0.12, 1.2, 0.1, '#7d6b4a', 0.2);
    part(w, root, -0.3, 2.85, -0.75, 0.38, 0.42, 0.06, '#59605a', 0.2);
  }
  if (key === 'operator') {
    part(w, root, -0.05, 1.62, 0.62, 0.7, 0.12, 0.42, '#263b38');
    part(w, root, 0.25, 1.95, 0.7, 0.03, 0.62, 0.03, '#a3b5a0');
    part(w, root, -0.32, 2.75, -0.5, 0.03, 0.9, 0.03, '#9bab98');
  }
  if (key === 'assault')
    for (const gx of [-0.3, 0.3]) ball(w, root, gx, 1.48, 0.36, 0.09, 0.11, 0.09, '#3e4a37');
  if (key === 'mog') part(w, root, -0.45, 1.3, 0.35, 0.35, 0.3, 0.45, '#485d47');
  if (key === 'atgm') buildInfantryAT(w, root, paint);
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
    this.corpses = [];
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
  // Fallen soldiers stay on the ground for a while; they are drawn from the same role pools.
  addCorpse(e, time) {
    if (!isInfantry(e.key)) return;
    this.corpses.push({
      key: e.key,
      side: e.side,
      x: e.x,
      z: e.z,
      yaw: e.yaw || 0,
      at: time,
      tilt: (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.25),
      roll: (Math.random() - 0.5) * 0.6,
      members: Math.max(1, GROUND_UNITS[e.key].members || 1),
    });
    if (this.corpses.length > CORPSE_LIMIT) this.corpses.shift();
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
  sync(units, time, visibleIds = null) {
    const camera = this.world.camera;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    for (const p of this.pools.values()) p.count = 0;
    let selected = 0;
    for (const u of units) {
      if (
        !isInfantry(u.key) ||
        !(visibleIds ? visibleIds.has(u.id) : groundVisible(this.world.state, 0, u))
      )
        continue;
      bounds.center.set(u.x, (u.y || 1) + 2, u.z);
      if (!frustum.intersectsSphere(bounds)) continue;
      const d = GROUND_UNITS[u.key],
        pool = this.pool(u.key, u.side),
        members = Math.max(1, Math.ceil(((d.members || 1) * u.hp) / u.maxHp)),
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
        const x = members > 1 ? (m - (members - 1) / 2) * 2.7 : 0,
          z = members > 1 ? (m % 2) * 2 - 1 : 0,
          c = Math.cos(angle),
          s = Math.sin(angle),
          wx = u.x + x * c + z * s,
          wz = u.z + z * c - x * s,
          index = pool.count++,
          // Firing from a halt: drop to a half-kneel and lean into the weapon.
          aiming = !u.moving && time - (u.lastFire ?? -100) < 1.6,
          height = crouch ? 0.67 : aiming ? 0.86 : 1;
        const stride = u.moving ? Math.sin(time * 12 + m * 1.7) : 0;
        const recoil = Math.exp(-Math.max(0, time - (u.lastFire ?? -100)) * 22) * 0.06;
        temp.position.set(
          wx - Math.sin(angle) * recoil,
          (u.y || 1) + Math.abs(stride) * 0.055,
          wz - Math.cos(angle) * recoil,
        );
        temp.rotation.set(u.moving ? 0.065 : aiming ? 0.09 : 0, angle, stride * 0.018);
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
    this.corpses = this.corpses.filter((c) => time - c.at < CORPSE_LIFE && time >= c.at - 1);
    for (const c of this.corpses) {
      bounds.center.set(c.x, 2, c.z);
      if (!frustum.intersectsSphere(bounds)) continue;
      const pool = this.pool(c.key, c.side),
        age = time - c.at,
        fall = Math.min(1, age / CORPSE_FALL),
        // Ease-out: the body drops fast, then settles.
        t = 1 - (1 - fall) * (1 - fall),
        sink = age > CORPSE_LIFE - 5 ? (age - (CORPSE_LIFE - 5)) / 5 : 0;
      for (let m = 0; m < c.members && pool.count < 512; m++) {
        const index = pool.count++,
          off = c.members > 1 ? (m - (c.members - 1) / 2) * 2.4 : 0,
          cs = Math.cos(c.yaw),
          sn = Math.sin(c.yaw);
        temp.position.set(c.x + off * cs, 0.55 + 0.1 * (1 - t) - sink * 0.9, c.z - off * sn);
        temp.rotation.set((-Math.PI / 2) * t + c.tilt * t, c.yaw + m, c.roll * t, 'YXZ');
        temp.scale.set(1, 1, 1);
        temp.updateMatrix();
        pool.body.setMatrixAt(index, temp.matrix);
        pool.body.userData.unitIds[index] = -1;
        for (let leg = 0; leg < 2; leg++) {
          temp.position.set(
            c.x + off * cs + (leg ? 0.3 : -0.3) * cs,
            0.35 - sink * 0.9,
            c.z - off * sn - (leg ? 0.3 : -0.3) * sn - 0.6 * t,
          );
          temp.rotation.set((-Math.PI / 2) * t, c.yaw, (leg ? 1 : -1) * 0.2 * t, 'YXZ');
          temp.scale.set(0.31, 1.22, 0.37);
          temp.updateMatrix();
          pool.legs.setMatrixAt(index * 2 + leg, temp.matrix);
          pool.legs.userData.unitIds[index * 2 + leg] = -1;
        }
      }
    }
    for (const u of units)
      if (
        !isInfantry(u.key) &&
        !u.carrierId &&
        (!visibleIds || visibleIds.has(u.id)) &&
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
      // Raycaster uses these bounds even though rendering frustum culling is manual.
      // A squad that moved outside its original bounds must remain clickable.
      if (p.count) {
        p.body.computeBoundingSphere();
        p.legs.computeBoundingSphere();
      }
    }
    this.selected.count = selected;
    this.selected.instanceMatrix.needsUpdate = true;
  }
}

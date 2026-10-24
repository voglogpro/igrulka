import { buildAPC } from './vehicles/apc.js';
import { buildTankDestroyer } from './vehicles/tank-destroyer.js';
import { buildBlenderVehicle } from './vehicles/blender-vehicles.js';
import { buildTrackedVehicle, animateVehicleDrive } from './vehicles/tracked-chassis.js';
import * as T from '../../../vendor/three/three.module.js';
import { batchStatic } from '../mesh-utils.js';
import { isInfantry, GROUND_UNITS, groundHeight } from '../../game/config.js';
import { mogModel } from './infantry/mog.js';
import { buildArmoredCar, buildMLRS, buildSupplyTruck } from './vehicles/light-vehicles.js';
// Shared hulls are rescaled to tell the weight classes apart at a glance.
const HULL_SCALE = { lighttank: 0.8, ifv: 0.9, heavytank: 1.14 };
const templates = new Map();
export function groundModel(world, u) {
  if (isInfantry(u.key) && u.key !== 'mog') {
    const root = new T.Group();
    root.userData.groundId = u.id;
    return root;
  }
  const signature = u.key + ':' + u.side + ':' + (u.level || 0);
  if (!templates.has(signature)) {
    const root = new T.Group(),
      own = u.side === 0,
      paint = own ? '#74836b' : '#8d7965',
      accent = own ? '#a4dfb1' : '#edab8d',
      dynamic = new Set();
    const box = (p, x, y, z, w, h, d, c) => world.box(p, x, y, z, w, h, d, c),
      cyl = (p, x, y, z, r, h, c) => world.cyl(p, x, y, z, r, h, c);
    if (buildBlenderVehicle(world, u, root, paint, accent, dynamic)) {
      // Blender parts retain the same shared geometry and named aiming hierarchy.
    } else if (u.key === 'mog') {
      mogModel(world, u, root, root);
      root.userData.turret.name = 'turret';
      root.userData.pitch.name = 'pitch';
      root.userData.turret.userData.backward = true;
      dynamic.add(root.userData.turret);
    } else if (u.key === 'apc') {
      buildAPC(world, root, paint, dynamic);
    } else if (u.key === 'armoredcar') {
      buildArmoredCar(world, root, paint, accent, dynamic);
    } else if (u.key === 'mlrs') {
      buildMLRS(world, root, paint, accent, dynamic);
    } else if (u.key === 'supplytruck' || u.key === 'tradetruck') {
      buildSupplyTruck(world, root, paint, accent, u.key === 'tradetruck');
    } else if (u.key === 'tankdestroyer') {
      buildTankDestroyer(world, root, paint, accent, dynamic);
    } else {
      buildTrackedVehicle(world, u, root, paint, accent, dynamic);
    }
    if (['gepard', 'shilka'].includes(u.key) && u.level > 0) {
      const turret = root.getObjectByName('turret');
      const optic = box(turret, -2.4, 2.3, 1, 1.2, 0.9, 1.8, '#354c45');
      optic.name = 'equipment-optic';
      box(turret, -2.4, 2.3, 2, 0.8, 0.5, 0.12, '#8cb7af');
      if (u.level > 1) {
        cyl(turret, 2.6, 2, -1, 0.12, 2.2, '#687d70');
        box(turret, 2.6, 4.2, -1, 1.8, 0.5, 0.9, accent);
      }
    }
    batchStatic(root, dynamic);
    if (HULL_SCALE[u.key]) root.scale.setScalar(HULL_SCALE[u.key]);
    root.traverse((o) => {
      if (o.geometry) world.sharedGeometries.add(o.geometry);
      if (o.material) world.sharedMaterials.add(o.material);
    });
    delete root.userData.turret;
    delete root.userData.pitch;
    templates.set(signature, root);
  }
  const root = templates.get(signature).clone(true);
  root.userData.groundId = u.id;
  const legs = root.getObjectByName('legs');
  if (legs) {
    legs.instanceMatrix.setUsage(T.DynamicDrawUsage);
    legs.userData.locations = root.userData.legLocations;
  }
  root.userData.fieldPosition = root.getObjectByName('field-position');
  root.userData.turret = root.getObjectByName('turret');
  root.userData.pitch = root.getObjectByName('pitch');
  root.userData.dish = root.getObjectByName('dish');
  root.userData.recoil = root.getObjectByName('recoil');
  return root;
}
const dummy = new T.Object3D();
export function animateGround(model, u, time, dt = 0) {
  model.position.set(u.x, u.y || 1, u.z);
  // Machines lean with the slope of a hill; soldiers stay upright.
  if (!isInfantry(u.key)) {
    const yaw = u.yaw || 0,
      fx = Math.sin(yaw) * 3,
      fz = Math.cos(yaw) * 3,
      pitch = Math.atan2(groundHeight(u.x + fx, u.z + fz) - groundHeight(u.x - fx, u.z - fz), 6),
      roll = Math.atan2(groundHeight(u.x + fz, u.z - fx) - groundHeight(u.x - fz, u.z + fx), 6);
    model.rotation.set(-pitch, yaw, roll, 'YXZ');
  } else model.rotation.y = u.yaw || 0;
  if (u.key === 'mog') {
    const field = model.userData.fieldPosition;
    if (field) {
      field.visible = !u.moving && (u.setup || 0) > 0.45;
      field.scale.y = Math.max(0.1, u.setup || 0);
    }
    if (model.userData.turret) model.userData.turret.visible = (u.setup || 0) >= 1;
  }
  const turret = model.userData.turret;
  if (turret && Number.isFinite(u.targetX)) {
    const desired =
      Math.atan2(u.targetX - u.x, u.targetZ - u.z) -
      model.rotation.y +
      (turret.userData.backward ? Math.PI : 0);
    turret.rotation.y +=
      (((desired - turret.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) *
      (1 - Math.exp(-12 * dt));
  }
  const pitch = model.userData.pitch;
  if (pitch && (u.key === 'howitzer' || u.key === 'mlrs')) {
    // A howitzer lobs its shells: elevation grows with range instead of pointing at the target.
    const range = Math.hypot((u.targetX ?? u.x) - u.x, (u.targetZ ?? u.z) - u.z),
      reach = GROUND_UNITS[u.key].groundRange,
      desired = Number.isFinite(u.targetX) ? 0.22 + Math.min(1, range / reach) * 0.62 : 0.05;
    pitch.rotation.x += (-desired - pitch.rotation.x) * (1 - Math.exp(-3 * dt));
  } else if (pitch)
    pitch.rotation.x =
      (turret?.userData.backward ? 1 : -1) *
      Math.atan2(
        (u.targetY ?? 5) - (u.y || 1) - (u.key === 'mog' ? 2.1 : 5.1),
        Math.hypot((u.targetX ?? u.x) - u.x, (u.targetZ ?? u.z) - u.z) || 1,
      );
  if (model.userData.recoil) {
    const age = Math.max(0, time - (u.lastFire ?? -100));
    const heavy = u.key === 'howitzer' ? 1.6 : 0.65,
      span = u.key === 'howitzer' ? 0.9 : 0.32;
    model.userData.recoil.position.z = age < span ? -Math.sin((Math.PI * age) / span) * heavy : 0;
  }
  if (u.moving && dt > 0) {
    model.userData.drivePhase = (model.userData.drivePhase || 0) + dt * 8;
    animateVehicleDrive(model, model.userData.drivePhase);
  }
  const dish = model.userData.dish;
  if (dish) dish.rotation.y = time * 1.4;
  const legs = model.getObjectByName('legs');
  if (legs) {
    for (let i = 0; i < 10; i++) {
      const p = legs.userData.locations[Math.floor(i / 2)],
        swing = u.moving
          ? Math.sin(time * 12 + Math.floor(i / 2) * 1.8 + (i % 2) * Math.PI) * 0.55
          : 0;
      dummy.position.set(p.x + (i % 2 ? 0.25 : -0.25), 0.65, p.z);
      dummy.rotation.set(swing, 0, 0);
      dummy.scale.set(0.32, 1.25, 0.38);
      dummy.updateMatrix();
      legs.setMatrixAt(i, dummy.matrix);
    }
    legs.instanceMatrix.needsUpdate = true;
  }
}

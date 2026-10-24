import * as T from '../../../../vendor/three/three.module.js';
import { batchStatic } from '../../mesh-utils.js';
import { buildLeopardTurret } from './leopard.js';
import { buildAntiAirTurret } from './anti-air.js';
import { buildHowitzerTurret } from './howitzer.js';
import { buildLightTurret, addHeavyArmor } from './light-vehicles.js';
import { armor, hatch } from './geometry.js';
export function buildTrackedVehicle(world, u, root, paint, accent, dynamic) {
  const box = (...args) => world.box(...args),
    cyl = (...args) => world.cyl(...args);

  const wheels = new T.InstancedMesh(world.cylGeo, world.mat('#2c3930'), 12);
  wheels.name = 'road-wheels';
  const spokes = new T.InstancedMesh(world.boxGeo, world.mat('#8a947b'), 24);
  spokes.name = 'drive-spokes';
  const links = new T.InstancedMesh(world.boxGeo, world.mat('#566050'), 80);
  links.name = 'track-links';
  for (const mesh of [wheels, spokes, links]) {
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
  }
  for (const sign of [-1, 1]) {
    box(root, sign * 4.25, 0.28, 0, 1.8, 1.95, 10.2, '#25322b');
    for (let i = 0; i < 6; i++) {
      const hub = new T.Mesh(world.cylGeo, world.mat('#64765d'));
      hub.rotation.z = Math.PI / 2;
      hub.scale.set(0.55, 0.13, 0.55);
      hub.position.set(sign * 5.24, 1.25, -4.5 + i * 1.8);
      root.add(hub);
    }
    for (let i = 0; i < 5; i++) {
      const skirt = box(
        root,
        sign * 4,
        2.45,
        -4.25 + i * 2.05,
        0.32,
        1.2,
        1.95,
        i % 3 === 1 ? '#465c46' : paint,
      );
      skirt.rotation.z = sign * 0.12;
      box(root, sign * 4.2, 2.6, -4.25 + i * 2.05, 0.08, 0.12, 1.55, '#a3a58b');
    }
  }
  armor(world, root, 0, 1.45, 0, 7.7, 2, 11.3, paint, 0.92, 0.83);
  armor(world, root, 0, 3.4, 0.55, 7.1, 0.65, 8.6, paint, 0.85, 0.72);
  box(root, 0, 3.53, -4, 6.2, 0.25, 2.4, '#3e4f40');
  for (let i = 0; i < 9; i++) box(root, -2.7 + i * 0.67, 3.82, -4, 0.18, 0.11, 1.95, '#25372c');
  for (const x of [-2.6, 2.6]) {
    box(root, x, 2.05, -5.6, 0.7, 0.55, 0.35, '#313f34');
    cyl(root, x, 3.85, -3.25, 0.15, 0.3, '#97a38b');
  }
  hatch(world, root, 1.3, 3.92, 3.5, 0.65, paint);
  box(root, 1.3, 4.27, 4, 0.65, 0.14, 0.17, '#24424a');
  box(root, 0, 2.1, 5.35, 1.8, 0.25, 0.15, accent);
  const turret = new T.Group();
  turret.name = 'turret';
  turret.position.y = 4.1;
  root.add(turret);
  dynamic.add(turret);
  if (u.key === 'leopard') buildLeopardTurret(world, turret, paint, dynamic);
  else if (u.key === 'heavytank') {
    buildLeopardTurret(world, turret, paint, dynamic);
    addHeavyArmor(world, turret);
  } else if (u.key === 'howitzer') buildHowitzerTurret(world, turret, paint, dynamic);
  else if (u.key === 'lighttank' || u.key === 'ifv')
    buildLightTurret(world, turret, paint, dynamic, u.key === 'ifv');
  else buildAntiAirTurret(world, u, turret, paint, dynamic);
  for (const x of [-3, 3]) {
    box(root, x, 2.5, 5.4, 0.6, 0.4, 0.25, '#ffddaa');
    box(root, x, 2.5, -5.4, 0.5, 0.3, 0.2, '#ca886e');
  }
  cyl(root, -2.5, 4, -3, 0.055, 4, '#9aa994');
  batchStatic(turret, new Set([...dynamic].filter((v) => v !== turret)));
  animateVehicleDrive(root, 0);
}

const dummy = new T.Object3D();
function trackPoint(distance) {
  const radius = 1.05,
    arc = Math.PI * radius,
    perimeter = 18 + 2 * arc;
  let s = ((distance % perimeter) + perimeter) % perimeter;
  if (s < 9) return { y: 2.3, z: -4.5 + s, angle: 0 };
  s -= 9;
  if (s < arc) {
    const a = s / radius;
    return { y: 1.25 + Math.cos(a) * radius, z: 4.5 + Math.sin(a) * radius, angle: a };
  }
  s -= arc;
  if (s < 9) return { y: 0.2, z: 4.5 - s, angle: Math.PI };
  const a = (s - 9) / radius + Math.PI;
  return { y: 1.25 + Math.cos(a) * radius, z: -4.5 + Math.sin(a) * radius, angle: a };
}

export function animateVehicleDrive(root, phase) {
  const wheels = root.getObjectByName('road-wheels');
  if (!wheels) return;
  const spokes = root.getObjectByName('drive-spokes'),
    links = root.getObjectByName('track-links');
  for (let side = 0; side < 2; side++) {
    const sign = side ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      dummy.position.set(sign * 4.25, 1.25, -4.5 + i * 1.8);
      dummy.rotation.set(phase, 0, Math.PI / 2);
      dummy.scale.set(0.96, 1.9, 0.96);
      dummy.updateMatrix();
      wheels.setMatrixAt(side * 6 + i, dummy.matrix);
      for (let cross = 0; cross < 2; cross++) {
        dummy.position.x = sign * 5.33;
        dummy.rotation.set(phase + (cross * Math.PI) / 2, 0, 0);
        dummy.scale.set(0.06, 0.8, 0.1);
        dummy.updateMatrix();
        spokes.setMatrixAt(side * 12 + i * 2 + cross, dummy.matrix);
      }
    }
    for (let i = 0; i < 40; i++) {
      const p = trackPoint((i * (18 + Math.PI * 2.1)) / 40 + phase);
      dummy.position.set(sign * 4.25, p.y, p.z);
      dummy.rotation.set(p.angle, 0, 0);
      dummy.scale.set(1.98, 0.16, 0.5);
      dummy.updateMatrix();
      links.setMatrixAt(side * 40 + i, dummy.matrix);
    }
  }
  for (const mesh of [wheels, spokes, links]) mesh.instanceMatrix.needsUpdate = true;
}

import * as T from '../../../../vendor/three/three.module.js';
import { batchStatic } from '../../mesh-utils.js';
import { armor, barrel, hatch } from './geometry.js';

function wheels(world, root, positions, radius, paint) {
  for (const [x, z] of positions) {
    const wheel = new T.Mesh(world.cylGeo, world.mat('#252f2a'));
    wheel.rotation.z = Math.PI / 2;
    wheel.scale.set(radius, 0.9, radius);
    wheel.position.set(x, radius, z);
    root.add(wheel);
    const hub = new T.Mesh(world.cylGeo, world.mat('#77866c'));
    hub.rotation.z = Math.PI / 2;
    hub.scale.set(radius * 0.45, 0.16, radius * 0.45);
    hub.position.set(x + Math.sign(x) * 0.5, radius, z);
    root.add(hub);
    world.box(root, x, radius * 2 + 0.05, z, 1.1, 0.16, radius * 1.9, paint);
  }
}

function turretGroup(root, dynamic, y, z = 0) {
  const turret = new T.Group();
  turret.name = 'turret';
  turret.position.set(0, y, z);
  root.add(turret);
  dynamic.add(turret);
  const pitch = new T.Group();
  pitch.name = 'pitch';
  turret.add(pitch);
  dynamic.add(pitch);
  return { turret, pitch };
}

// Four-wheeled scout car with a small machine-gun turret.
export function buildArmoredCar(world, root, paint, accent, dynamic) {
  const box = (...args) => world.box(...args);
  armor(world, root, 0, 1.2, 0, 4.6, 1.9, 8.4, paint, 0.86, 0.66);
  armor(world, root, 0, 3.05, -0.4, 4, 0.9, 5, paint, 0.82, 0.74);
  wheels(
    world,
    root,
    [
      [-2.45, -2.6],
      [2.45, -2.6],
      [-2.45, 2.7],
      [2.45, 2.7],
    ],
    1.05,
    paint,
  );
  for (const x of [-0.9, 0.9]) {
    const glass = box(root, x, 3.15, 2.05, 1.35, 0.5, 0.1, '#1f3d43');
    glass.rotation.x = -0.45;
  }
  box(root, 0, 1.5, 4.25, 3.4, 0.5, 0.25, '#3a4a3b');
  for (const x of [-1.6, 1.6]) box(root, x, 1.9, 4.3, 0.5, 0.3, 0.12, '#e6d9a3');
  box(root, 0, 2.2, 4.33, 1.2, 0.2, 0.1, accent);
  box(root, 0, 2.1, -4.2, 2.6, 1.2, 0.3, '#56664d');
  const { turret, pitch } = turretGroup(root, dynamic, 3.95, -0.6);
  world.cyl(turret, 0, 0, 0, 1.1, 0.75, '#4f6449');
  pitch.position.y = 0.55;
  barrel(world, pitch, 0, 0, 1.6, 0.11, 2.4, '#1f2d27');
  box(pitch, 0, -0.18, 0.2, 0.42, 0.42, 0.9, '#2b3a32');
  box(pitch, 0.35, -0.1, 0.1, 0.3, 0.32, 0.5, '#6f7a56');
  pitch.userData.muzzles = [[0, 0, 2.85]];
  batchStatic(pitch);
  batchStatic(turret, new Set([pitch]));
}

// Compact two-man turret with a 30 mm cannon; the IFV variant adds an ATGM launcher.
export function buildLightTurret(world, turret, paint, dynamic, ifv = false) {
  const box = (...args) => world.box(...args);
  world.cyl(turret, 0, -0.15, 0, 2, 0.3, '#2a3c33');
  armor(world, turret, 0, 0, -0.2, 4.1, 1.45, 4.3, paint, 0.78, 0.68);
  hatch(world, turret, -0.85, 1.45, -0.6, 0.6, paint);
  box(turret, 1.05, 1.5, 0.1, 0.6, 0.45, 0.6, '#4c624c');
  box(turret, 1.05, 1.62, 0.42, 0.42, 0.22, 0.05, '#2a5054');
  for (const sign of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const tube = barrel(world, turret, sign * 2.05, 0.9, -0.4 - i * 0.35, 0.11, 0.4, '#293c31');
      tube.rotation.set(Math.PI * 0.3, 0, sign * -0.5);
    }
  if (ifv) {
    box(turret, -2.25, 0.55, 0.1, 0.55, 0.65, 2.6, '#4a5c45');
    box(turret, -2.25, 0.88, 1.42, 0.45, 0.45, 0.08, '#1e2a26');
  }
  const pitch = new T.Group();
  pitch.name = 'pitch';
  pitch.position.set(0.3, 0.72, 1.8);
  turret.add(pitch);
  dynamic.add(pitch);
  armor(world, pitch, 0, -0.32, 0, 1.1, 0.68, 0.9, '#62745c', 0.8, 0.8);
  barrel(world, pitch, 0, 0, 2.6, 0.13, 4.6, '#1f2b26');
  barrel(world, pitch, 0, 0, 1.2, 0.24, 1.3, '#495a44');
  barrel(world, pitch, 0, 0, 4.9, 0.19, 0.45, '#2c3a31');
  pitch.userData.muzzles = [[0, 0, 5.2]];
  batchStatic(pitch);
}

// Explosive reactive armour bricks bolted onto the main turret of the heavy tank.
export function addHeavyArmor(world, turret) {
  for (const sign of [-1, 1])
    for (let i = 0; i < 4; i++)
      world.box(turret, sign * 2.85, 0.35, 2.6 - i * 0.95, 0.5, 0.9, 0.8, '#5f6b55');
  for (let i = 0; i < 5; i++)
    world.box(turret, -1.8 + i * 0.9, 1.85, 2.4, 0.75, 0.25, 0.9, '#58654f');
}

// Six-wheeled truck carrying a traversing rack of twelve rocket tubes.
export function buildMLRS(world, root, paint, accent, dynamic) {
  const box = (...args) => world.box(...args);
  box(root, 0, 1.2, 0, 4.4, 0.8, 12.4, '#2e3a32');
  armor(world, root, 0, 1.9, 4.4, 4.6, 2.6, 3.4, paint, 0.9, 0.6);
  for (const x of [-1.1, 1.1]) {
    const glass = box(root, x, 3.55, 5.9, 1.6, 0.75, 0.1, '#1f3d43');
    glass.rotation.x = -0.4;
  }
  box(root, 0, 2.2, 6.15, 3.6, 0.4, 0.15, accent);
  for (const x of [-1.7, 1.7]) box(root, x, 2.6, 6.15, 0.5, 0.3, 0.1, '#e6d9a3');
  box(root, 0, 2, -1.6, 4.4, 0.5, 8.6, paint);
  for (const sign of [-1, 1]) box(root, sign * 2.3, 2.5, -1.6, 0.18, 0.6, 8.2, '#4b5a45');
  wheels(
    world,
    root,
    [
      [-2.3, 4.3],
      [2.3, 4.3],
      [-2.3, -1.4],
      [2.3, -1.4],
      [-2.3, -3.9],
      [2.3, -3.9],
    ],
    1.15,
    paint,
  );
  const { turret, pitch } = turretGroup(root, dynamic, 2.6, -2.4);
  world.cyl(turret, 0, 0, 0, 1.4, 0.6, '#3d4c3a');
  box(turret, 0, 0.5, 0, 1.4, 1.1, 1.4, '#4c5c46');
  pitch.position.set(0, 1.7, -1.6);
  const muzzles = [];
  box(pitch, 0, -0.75, 1.6, 3.7, 0.25, 5.6, '#3b4a38');
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++) {
      const x = -1.35 + col * 0.9,
        y = -0.5 + row * 0.75;
      barrel(world, pitch, x, y, 1.6, 0.36, 5.4, row === 1 ? '#56674f' : paint);
      barrel(world, pitch, x, y, 4.3, 0.3, 0.05, '#101914');
      muzzles.push([x, y, 4.4]);
    }
  for (const z of [0, 3.2]) box(pitch, 0, 1.75, z, 3.8, 0.2, 0.35, '#2f3b30');
  pitch.userData.muzzles = muzzles;
  batchStatic(pitch);
  batchStatic(turret, new Set([pitch]));
}

// Covered supply truck: cab, cargo box with a red cross, small crane and spare wheel.
export function buildSupplyTruck(world, root, paint, accent, trade = false) {
  const box = (...args) => world.box(...args);
  box(root, 0, 1.2, 0, 4.4, 0.8, 12.2, '#2e3a32');
  armor(world, root, 0, 1.9, 4.4, 4.6, 2.5, 3.3, paint, 0.9, 0.6);
  for (const x of [-1.1, 1.1]) {
    const glass = box(root, x, 3.5, 5.8, 1.6, 0.7, 0.1, '#1f3d43');
    glass.rotation.x = -0.4;
  }
  box(root, 0, 2.2, 6.1, 3.6, 0.4, 0.15, accent);
  for (const x of [-1.7, 1.7]) box(root, x, 2.6, 6.1, 0.5, 0.3, 0.1, '#e6d9a3');
  // Cargo box with a tarpaulin roof.
  box(root, 0, 2, -1.6, 4.5, 2.6, 7.4, trade ? '#d9d2b4' : '#6d7a5e');
  box(root, 0, 4.5, -1.6, 4.2, 0.35, 7, trade ? '#ece7d2' : '#556247');
  for (const sign of [-1, 1]) {
    if (trade) {
      // Blue stripe and a coin-like round emblem instead of the medical cross.
      box(root, sign * 2.27, 2.6, -1.6, 0.05, 0.7, 7.2, '#3f6f8f');
      const coin = new T.Mesh(world.cylGeo, world.mat('#d9b44a'));
      coin.rotation.z = Math.PI / 2;
      coin.scale.set(0.9, 0.08, 0.9);
      coin.position.set(sign * 2.32, 3.9, -1.6);
      root.add(coin);
      continue;
    }
    box(root, sign * 2.27, 3, -1.6, 0.06, 1.3, 1.9, '#e8e9e0');
    box(root, sign * 2.31, 3.5, -1.6, 0.04, 0.3, 1.1, '#b8352f');
    box(root, sign * 2.31, 3.1, -1.6, 0.04, 1.1, 0.3, '#b8352f');
  }
  // Crane arm and spare wheel at the back.
  if (!trade) {
    box(root, 0, 4.8, -4.6, 0.5, 2.6, 0.5, '#3d4a3a');
    const arm = box(root, 0, 7, -3.2, 0.35, 0.35, 3.2, '#3d4a3a');
    arm.rotation.x = 0.35;
  }
  const spare = new T.Mesh(world.cylGeo, world.mat('#252f2a'));
  spare.rotation.x = Math.PI / 2;
  spare.scale.set(1.1, 0.5, 1.1);
  spare.position.set(0, 2.2, -5.4);
  root.add(spare);
  wheels(
    world,
    root,
    [
      [-2.3, 4.3],
      [2.3, 4.3],
      [-2.3, -1.2],
      [2.3, -1.2],
      [-2.3, -3.8],
      [2.3, -3.8],
    ],
    1.15,
    paint,
  );
}

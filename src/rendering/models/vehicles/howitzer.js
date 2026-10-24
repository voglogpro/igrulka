import * as T from '../../../../vendor/three/three.module.js';
import { batchStatic } from '../../mesh-utils.js';
import { armor, barrel, hatch } from './geometry.js';

// Large boxy turret set back on the hull with a long 152 mm-class barrel and a muzzle brake.
export function buildHowitzerTurret(world, turret, paint, dynamic) {
  const box = (...args) => world.box(...args);
  turret.position.z = -1.2;
  world.cyl(turret, 0, -0.18, 0, 2.9, 0.3, '#2a3c33');
  armor(world, turret, 0, 0, 0, 6.8, 2.7, 7.4, paint, 0.9, 0.86);
  armor(world, turret, 0, 2.55, -0.3, 6.1, 0.35, 6.4, '#62755c', 0.92, 0.9);
  // Ammunition boxes and stowage on the turret sides and rear.
  for (const sign of [-1, 1]) {
    box(turret, sign * 3.55, 0.6, -0.6, 0.45, 1.5, 4.2, '#59694f');
    for (let i = 0; i < 3; i++)
      box(turret, sign * 3.82, 0.85, -2 + i * 1.4, 0.12, 0.9, 1.1, '#3f4e3b');
  }
  box(turret, 0, 0.6, -4, 5.6, 1.6, 0.9, '#4d5f49');
  for (const x of [-2, 0, 2]) box(turret, x, 1.5, -4.48, 1.3, 0.1, 0.1, '#a8ab92');
  hatch(world, turret, -1.6, 2.75, -1.4, 0.75, paint);
  hatch(world, turret, 1.5, 2.75, -1.8, 0.62, paint);
  box(turret, 1.5, 3.2, 0.9, 0.9, 0.55, 0.8, '#506650');
  box(turret, 1.5, 3.35, 1.32, 0.6, 0.26, 0.06, '#24474b');
  world.cyl(turret, -2.6, 3.4, -3, 0.04, 3.2, '#c1c2a6');
  const pitch = new T.Group();
  pitch.name = 'pitch';
  pitch.position.set(0, 1.25, 3.4);
  turret.add(pitch);
  dynamic.add(pitch);
  armor(world, pitch, 0, -0.55, 0.2, 2.4, 1.4, 1.8, '#68795f', 0.8, 0.85);
  const recoil = new T.Group();
  recoil.name = 'recoil';
  recoil.userData.dynamic = true;
  pitch.add(recoil);
  barrel(world, recoil, 0, 0, 6.8, 0.3, 11.6, '#4b5e48');
  barrel(world, recoil, 0, 0, 1.8, 0.46, 2.6, paint);
  // Fume extractor and the double-baffle muzzle brake.
  barrel(world, recoil, 0, 0, 7.6, 0.44, 1.5, '#6d7d63');
  box(recoil, 0, 0, 12.9, 1.05, 0.62, 1.2, '#33463a');
  for (const z of [12.55, 13.25]) box(recoil, 0, 0, z, 1.25, 0.72, 0.16, '#26372e');
  barrel(world, recoil, 0, 0, 13.5, 0.2, 0.05, '#0e1a17');
  for (const z of [3.2, 5.2, 10.4]) barrel(world, recoil, 0, 0, z, 0.34, 0.1, '#9b9e81');
  // Muzzle effects start at the brake in pitch space.
  pitch.userData.muzzles = [[0, 0, 13.6]];
  batchStatic(recoil);
  batchStatic(pitch, new Set([recoil]));
}

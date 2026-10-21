import * as T from '../../../../vendor/three/three.module.js';
import { batchStatic } from '../../mesh-utils.js';
import { armor, barrel, hatch } from './geometry.js';

export function buildLeopardTurret(world, turret, paint, dynamic) {
  const box = (...args) => world.box(...args);
  world.cyl(turret, 0, -0.18, 0, 2.7, 0.3, '#2a3c33');
  armor(world, turret, 0, 0, -0.35, 6.3, 1.95, 6.5, paint, 0.78, 0.7);
  for (const sign of [-1, 1]) {
    const cheek = armor(world, turret, sign * 2, 0.15, 1.6, 2.1, 1.55, 3.1, '#819078', 0.7, 0.55);
    cheek.rotation.y = sign * -0.18;
    box(turret, sign * 2.8, 0.45, -1.7, 0.5, 1, 2.8, '#5a6a53');
    for (let i = 0; i < 4; i++) {
      const tube = barrel(world, turret, sign * 2.85, 1.3, -0.7 - i * 0.4, 0.15, 0.55, '#293c31');
      tube.rotation.set(Math.PI * 0.32, 0, sign * -0.4);
    }
  }
  box(turret, 0, 0.3, -3.6, 5, 1.05, 1.1, '#52654f');
  for (const x of [-2.35, 0, 2.35]) box(turret, x, 1.35, -3.7, 0.12, 0.5, 1.05, '#acb29b');
  box(turret, 0, 1.75, -3.7, 4.8, 0.1, 1.05, '#7c8a71');
  hatch(world, turret, -1.1, 1.9, -0.6, 0.83, paint);
  hatch(world, turret, 1.25, 1.9, -0.65, 0.7, paint);
  for (const x of [-1.7, -1.1, -0.5, 0.8, 1.3, 1.8])
    box(turret, x, 2.05, 0.1, 0.28, 0.25, 0.22, '#1d3438');
  box(turret, 1.25, 2.2, 0.6, 0.75, 0.5, 0.65, '#556c55');
  box(turret, 1.25, 2.38, 0.95, 0.5, 0.22, 0.06, '#24474b');
  barrel(world, turret, -1.1, 2.43, 0.65, 0.075, 1.8, '#25382e');
  world.cyl(turret, -2.4, 1.7, -2.5, 0.035, 3.5, '#c1c2a6');
  const pitch = new T.Group();
  pitch.name = 'pitch';
  pitch.position.set(0, 1.02, 2.2);
  turret.add(pitch);
  dynamic.add(pitch);
  armor(world, pitch, 0, -0.5, 0, 1.7, 1.05, 1.6, '#66795f', 0.8, 0.85);
  const recoil = new T.Group();
  recoil.name = 'recoil';
  recoil.userData.dynamic = true;
  pitch.add(recoil);
  barrel(world, recoil, 0, 0, 4.75, 0.22, 9, '#4b604a');
  barrel(world, recoil, 0, 0, 2.15, 0.32, 2.3, paint);
  barrel(world, recoil, 0, 0, 5.1, 0.34, 1.35, '#738269');
  barrel(world, recoil, 0, 0, 9.3, 0.27, 0.45, '#344938');
  barrel(world, recoil, 0, 0, 9.55, 0.18, 0.04, '#101e1b');
  for (const z of [1.1, 3.25, 6, 8.7]) barrel(world, recoil, 0, 0, z, 0.25, 0.09, '#9b9e81');
  batchStatic(recoil);
  batchStatic(pitch, new Set([recoil]));
}

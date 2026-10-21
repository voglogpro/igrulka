import * as T from '../../../../vendor/three/three.module.js';
import { batchStatic } from '../../mesh-utils.js';
import { armor, barrel, hatch } from './geometry.js';
export function buildAntiAirTurret(world, u, turret, paint, dynamic) {
  const box = (...args) => world.box(...args),
    cyl = (...args) => world.cyl(...args);

  armor(world, turret, 0, 0, -0.4, 5.2, 2.5, 5, paint, 0.79, 0.8);
  hatch(world, turret, 0, 2.5, 0.3, 0.7, paint);
  for (const x of [-2.4, 2.4]) {
    box(turret, x, 0.5, -1.6, 0.6, 1.3, 2, '#566e54');
    for (let i = 0; i < 3; i++)
      box(turret, x * 1.08, 1.6, -1.8 + i * 0.45, 0.12, 0.3, 0.22, '#283c31');
  }
  const pitch = new T.Group();
  pitch.name = 'pitch';
  pitch.position.y = 1.4;
  turret.add(pitch);
  dynamic.add(pitch);
  const barrels =
    u.key === 'shilka'
      ? [
          [-0.55, -0.4],
          [0.55, -0.4],
          [-0.55, 0.4],
          [0.55, 0.4],
        ]
      : [
          [-2.8, 0],
          [2.8, 0],
        ];
  for (const [x, y] of barrels) {
    barrel(world, pitch, x, y, 3.9, 0.14, 7.8, '#273c32');
    barrel(world, pitch, x, y, 2.25, 0.25, 2.4, '#6e8066');
    barrel(world, pitch, x, y, 7.6, 0.21, 0.65, '#969c80');
    barrel(world, pitch, x, y, 7.95, 0.13, 0.06, '#172a24');
    box(pitch, x, y - 0.3, 0.4, 0.65, 0.6, 2.4, paint);
    for (let i = 0; i < 4; i++) box(pitch, x, y + 0.24, 1.4 + i * 0.5, 0.2, 0.07, 0.15, '#293c30');
  }
  const radar = new T.Group();
  radar.name = 'dish';
  radar.position.set(0, 3.1, -1);
  cyl(radar, 0, 0, 0, 0.2, 1.8, '#344c3b');
  const dish = new T.Mesh(world.sphereGeo, world.mat('#8f9e85'));
  dish.position.y = 1.6;
  dish.scale.set(u.key === 'gepard' ? 2.35 : 1.55, 1.05, 0.32);
  radar.add(dish);
  for (let i = -3; i <= 3; i++) box(radar, i * 0.45, 1.1, -0.33, 0.06, 1, 0.06, '#526b52');
  box(radar, 0, 1.55, -0.38, 2.8, 0.08, 0.1, '#c1c6aa');
  batchStatic(pitch);
  batchStatic(radar);
  turret.add(radar);
  dynamic.add(radar);
}

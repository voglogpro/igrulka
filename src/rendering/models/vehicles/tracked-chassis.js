import * as T from '../../../../vendor/three/three.module.js';
import { batchStatic } from '../../mesh-utils.js';
import { buildLeopardTurret } from './leopard.js';
import { buildAntiAirTurret } from './anti-air.js';
export function buildTrackedVehicle(world, u, root, paint, accent, dynamic) {
  const box = (...args) => world.box(...args),
    cyl = (...args) => world.cyl(...args);

  for (const x of [-4.3, 4.3]) {
    box(root, x, 0.3, 0, 2, 1.8, 11.5, '#26332f');
    for (let i = 0; i < 6; i++) {
      const wheel = new T.Mesh(world.cylGeo, world.mat('#4d5a47'));
      wheel.rotation.z = Math.PI / 2;
      wheel.scale.set(0.95, 2.1, 0.95);
      wheel.position.set(x, 1.3, -4.5 + i * 1.8);
      wheel.castShadow = true;
      root.add(wheel);
    }
    for (let i = 0; i < 12; i++) box(root, x, 0.1, -5.4 + i * 0.95, 2.05, 0.24, 0.35, '#5d6656');
  }
  box(root, 0, 1.5, 0, 7.2, 2.1, 10.5, paint);
  box(root, 0, 3.5, 1, 6.5, 0.7, 7.7, paint);
  box(root, 0, 3.4, -4.2, 6.2, 0.35, 2, '#3e4f40');
  for (let i = 0; i < 5; i++) box(root, -2.5 + i * 1.25, 3.8, -3.9, 0.65, 0.15, 1.8, '#29392f');
  box(root, 0, 2.1, 5.35, 3, 0.8, 0.2, accent);
  const turret = new T.Group();
  turret.name = 'turret';
  turret.position.y = 4.1;
  root.add(turret);
  dynamic.add(turret);
  if (u.key === 'leopard') buildLeopardTurret(world, turret, paint);
  else buildAntiAirTurret(world, u, turret, paint, dynamic);
  for (const x of [-3, 3]) {
    box(root, x, 2.5, 5.4, 0.6, 0.4, 0.25, '#ffddaa');
    box(root, x, 2.5, -5.4, 0.5, 0.3, 0.2, '#ca886e');
  }
  cyl(root, -2.5, 4, -3, 0.055, 4, '#9aa994');
  batchStatic(turret, new Set([...dynamic].filter((v) => v !== turret)));
}

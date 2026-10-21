import * as T from '../../../../vendor/three/three.module.js';
import { armor, barrel, hatch } from './geometry.js';
import { batchStatic } from '../../mesh-utils.js';
export function buildAPC(world, root, paint, dynamic) {
  const box = (...args) => world.box(...args),
    cyl = (...args) => world.cyl(...args);

  armor(world, root, 0, 1, 0, 6.7, 2.8, 11.4, paint, 0.87, 0.78);
  armor(world, root, 0, 3.6, 0.5, 5.8, 1.15, 8.2, paint, 0.85, 0.73);
  for (const x of [-1.25, 1.25]) {
    const glass = box(root, x, 3.78, 4.1, 1.9, 0.72, 0.13, '#203e44');
    glass.rotation.x = -0.3;
    box(root, x, 3.5, 4.27, 2.05, 0.13, 0.2, '#a4ad90');
  }
  for (const x of [-3.5, 3.5])
    for (const z of [-4, -1.4, 1.4, 4]) {
      const wheel = new T.Mesh(world.cylGeo, world.mat('#26352e'));
      wheel.rotation.z = Math.PI / 2;
      wheel.scale.set(1.35, 1.1, 1.35);
      wheel.position.set(x, 1.4, z);
      root.add(wheel);
      const hub = new T.Mesh(world.cylGeo, world.mat('#7c8c70'));
      hub.rotation.z = Math.PI / 2;
      hub.scale.set(0.65, 0.18, 0.65);
      hub.position.set(x + (x < 0 ? -0.62 : 0.62), 1.4, z);
      root.add(hub);
      box(root, x, 2.8, z, 1.3, 0.2, 2.2, paint);
    }
  for (let i = 0; i < 4; i++) box(root, -2.4 + i * 1.6, 4.1, -2.5, 1.1, 0.18, 2.5, '#50624b');
  box(root, 0, 2, -5.6, 3.4, 2.3, 0.2, '#63745a');
  hatch(world, root, 0, 4.73, -2.3, 0.85, paint);
  for (const x of [-2.6, 2.6]) {
    box(root, x, 2.2, -5.55, 0.4, 0.3, 0.2, '#ca8164');
    box(root, x, 2.7, 5.1, 0.55, 0.35, 0.15, '#e5d7a1');
    box(root, x, 3.5, -1.7, 0.18, 0.4, 3.2, '#99a28b');
    box(root, x, 2.1, -3, 0.18, 0.15, 3.4, '#384f3e');
  }
  cyl(root, -2, 4.6, -3, 0.04, 3, '#b6bca0');
  const turret = new T.Group();
  turret.name = 'turret';
  turret.position.set(0, 4.7, 1.1);
  root.add(turret);
  dynamic.add(turret);
  armor(world, turret, 0, 0, 0, 2, 0.8, 2.2, '#566e52');
  barrel(world, turret, 0, 0.6, 2, 0.12, 3.3, '#263b30');
  box(turret, 0.6, 0.4, 0.5, 0.7, 0.5, 1, '#8c956f');
  batchStatic(turret);
}

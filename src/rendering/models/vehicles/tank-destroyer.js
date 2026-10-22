import * as T from '../../../../vendor/three/three.module.js';
import { armor, hatch } from './geometry.js';
import { batchStatic } from '../../mesh-utils.js';

export function buildTankDestroyer(world, root, paint, accent, dynamic) {
  armor(world, root, 0, 1.15, 0, 6.2, 2.4, 9.7, paint, 0.85, 0.75);
  armor(world, root, 0, 3.4, 1.3, 5.6, 0.8, 5.5, '#60745c', 0.82, 0.75);
  for (const x of [-3.3, 3.3])
    for (const z of [-3.2, 0, 3.2]) {
      const wheel = world.cyl(root, x, 1.2, z, 1.1, 0.9, '#28382f');
      wheel.rotation.z = Math.PI / 2;
      wheel.position.y = 1.2;
      world.box(root, x, 2.5, z, 1.1, 0.18, 2.2, paint);
    }
  for (const x of [-1.2, 1.2]) {
    world.box(root, x, 3.6, 3.4, 1.8, 0.5, 0.18, '#254148');
    world.box(root, x * 2.1, 2.3, 4.7, 0.55, 0.35, 0.16, '#e2d6a7');
  }
  world.box(root, 0, 2.1, 4.9, 1.8, 0.3, 0.15, accent);
  hatch(world, root, 0, 4.18, 2.2, 0.7, paint);
  const turret = new T.Group();
  turret.name = 'turret';
  turret.position.set(0, 3.85, -1.1);
  root.add(turret);
  dynamic.add(turret);
  world.box(turret, 0, 0, 0, 2.9, 0.5, 2.8, '#445d49');
  const pitch = new T.Group();
  pitch.name = 'pitch';
  pitch.position.y = 1;
  turret.add(pitch);
  dynamic.add(pitch);
  for (const x of [-1.3, 1.3])
    for (const y of [0, 0.95]) {
      world.box(pitch, x, y, 0.5, 1.05, 0.85, 4.9, paint);
      world.box(pitch, x, y + 0.1, 2.99, 0.78, 0.64, 0.12, '#263b32');
      world.box(pitch, x, y + 0.55, -1.4, 0.85, 0.12, 0.45, '#a3ac8c');
    }
  world.box(pitch, 0, 0.25, 1.7, 0.7, 0.6, 1.5, '#3b5551');
  world.box(pitch, 0, 0.46, 2.49, 0.5, 0.24, 0.12, '#96c1b4');
  batchStatic(pitch);
  batchStatic(turret, new Set([pitch]));
}

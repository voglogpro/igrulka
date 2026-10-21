import * as T from '../../../../vendor/three/three.module.js';
export function buildAPC(world, root, paint) {
  const box = (...args) => world.box(...args),
    cyl = (...args) => world.cyl(...args);

  box(root, 0, 1, 0, 6.5, 2.7, 11, paint);
  box(root, 0, 3.7, 2.3, 5.6, 1.4, 5, paint);
  box(root, 0, 3.3, 5.6, 4.8, 1.2, 0.15, '#2b4446');
  for (const x of [-3.5, 3.5])
    for (const z of [-3.8, -0.8, 3.5]) {
      const wheel = new T.Mesh(world.cylGeo, world.mat('#26352e'));
      wheel.rotation.z = Math.PI / 2;
      wheel.scale.set(1.35, 1.1, 1.35);
      wheel.position.set(x, 1.4, z);
      root.add(wheel);
    }
  for (let i = 0; i < 4; i++) box(root, -2.4 + i * 1.6, 4.1, -2.5, 1.1, 0.18, 2.5, '#50624b');
  box(root, 0, 2, -5.6, 3.4, 2.3, 0.2, '#63745a');
  box(root, 0, 4.7, 2, 0.22, 0.25, 4, '#2b3b30');
  box(root, 0, 4.5, 0, 1.4, 0.8, 1.5, '#56684e');
}

import * as T from '../../../../vendor/three/three.module.js';
export function buildAntiAirTurret(world, u, turret, paint, dynamic) {
  const box = (...args) => world.box(...args),
    cyl = (...args) => world.cyl(...args);

  box(turret, 0, 0, 0, 4.8, 2.5, 4.8, paint);
  const pitch = new T.Group();
  pitch.name = 'pitch';
  pitch.position.y = 1.4;
  turret.add(pitch);
  dynamic.add(pitch);
  const barrels = u.key === 'shilka' ? [-1.2, -0.4, 0.4, 1.2] : [-2.8, 2.8];
  for (const x of barrels) {
    box(pitch, x, -0.1, 3.8, 0.3, 0.3, 8, '#283b32');
    box(pitch, x, -0.25, 0.4, 0.65, 0.6, 2.8, paint);
    box(pitch, x, -0.18, 7.4, 0.48, 0.45, 0.8, '#9a9c7f');
  }
  const radar = new T.Group();
  radar.name = 'dish';
  radar.position.set(0, 3.1, -1);
  cyl(radar, 0, 0, 0, 0.2, 1.8, '#344c3b');
  box(radar, 0, 1.4, 0, u.key === 'gepard' ? 4.4 : 2.8, 1.6, 0.5, '#9baf98');
  turret.add(radar);
  dynamic.add(radar);
}

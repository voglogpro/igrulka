export function buildLeopardTurret(world, turret, paint) {
  const box = (...args) => world.box(...args),
    cyl = (...args) => world.cyl(...args);

  box(turret, 0, 0, 0, 5.5, 2, 5.6, paint);
  box(turret, 0, 1.8, -0.5, 4.6, 0.35, 4.5, paint);
  box(turret, 0, 0.6, 6, 0.55, 0.55, 10, '#586752');
  box(turret, 0, 0.55, 10, 0.85, 0.7, 1.8, paint);
  box(turret, 2.9, 0.3, 0, 0.45, 1.7, 5, '#8a9277');
  cyl(turret, -1, 2.1, -1, 1, 0.3, '#4a5d4b');
  box(turret, -1.2, 2.4, 0.6, 0.16, 0.3, 2.3, '#26352d');
}

// Added to the role's shared body geometry, then drawn by InfantryBatch.
export function buildInfantryAT(world, root, paint) {
  const tube = world.cyl(root, 0.62, 1.95, 0.7, 0.27, 2.4, paint);
  tube.rotation.x = Math.PI / 2;
  tube.position.y = 1.95;
  const muzzle = world.cyl(root, 0.62, 1.95, 2.02, 0.22, 0.14, '#253a32');
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.y = 1.95;
  world.box(root, 0.85, 2.08, 0.65, 0.3, 0.22, 0.55, '#25454a');
  world.box(root, -0.1, 1.4, -0.65, 0.55, 1.4, 0.55, '#596c50');
}

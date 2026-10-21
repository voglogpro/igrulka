import * as T from '../../../../vendor/three/three.module.js';

// Small procedural armour pieces are shared by all copies of the vehicle template.
export function armor(
  world,
  parent,
  x,
  y,
  z,
  width,
  height,
  length,
  color,
  taper = 0.76,
  nose = 0.7,
) {
  const geometry = new T.BoxGeometry(width, height, length);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * taper);
      p.setZ(i, p.getZ(i) * (p.getZ(i) > 0 ? nose : 0.92));
    }
  }
  geometry.computeVertexNormals();
  world.sharedGeometries.add(geometry);
  const mesh = new T.Mesh(geometry, world.mat(color));
  mesh.position.set(x, y + height / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function barrel(world, parent, x, y, z, radius, length, color) {
  const mesh = new T.Mesh(world.cylGeo, world.mat(color));
  mesh.rotation.x = Math.PI / 2;
  mesh.scale.set(radius, length, radius);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export function hatch(world, parent, x, y, z, radius, color) {
  world.cyl(parent, x, y, z, radius, 0.18, '#28362f');
  world.cyl(parent, x, y + 0.18, z, radius * 0.91, 0.15, color);
  world.box(parent, x, y + 0.36, z, radius * 0.8, 0.12, 0.12, '#b1b4a0');
}

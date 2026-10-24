import * as T from '../../../../vendor/three/three.module.js';
import { VEHICLE_MESHES } from '../generated/vehicle-meshes.js';
import { animateVehicleDrive } from './tracked-chassis.js';

const geometries = new Map(),
  materials = new Map();
// Treat these buffers as immutable: all templates and instances share them.
export function blenderVehicleGeometry(key) {
  if (geometries.has(key)) return geometries.get(key);
  const source = VEHICLE_MESHES[key];
  if (!source) return null;
  const count = source.vertices.length / 7;
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3),
    colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions.set(source.vertices.slice(i * 7, i * 7 + 3), i * 3);
    normals.set(source.vertices.slice(i * 7 + 3, i * 7 + 6), i * 3);
    colors.fill(source.vertices[i * 7 + 6], i * 3, i * 3 + 3);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  geometry.setIndex(source.indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometries.set(key, geometry);
  return geometry;
}

export function buildBlenderVehicle(world, u, root, paint, accent, dynamic) {
  if (u.key !== 'leopard' && u.key !== 'mlrs') return false;
  if (!materials.has(paint))
    materials.set(
      paint,
      new T.MeshStandardMaterial({
        color: paint,
        vertexColors: true,
        roughness: 0.82,
        metalness: 0.18,
      }),
    );
  const material = materials.get(paint);
  const mesh = (parent, part) => {
    const object = new T.Mesh(blenderVehicleGeometry(`${u.key}_${part}`), material);
    object.castShadow = object.receiveShadow = true;
    parent.add(object);
    return object;
  };
  mesh(root, 'body');
  const turret = new T.Group(),
    pitch = new T.Group();
  turret.name = 'turret';
  pitch.name = 'pitch';
  turret.position.set(0, u.key === 'leopard' ? 4.1 : 2.5, u.key === 'mlrs' ? -2 : 0);
  root.add(turret);
  turret.add(pitch);
  dynamic.add(turret);
  dynamic.add(pitch);
  mesh(turret, 'turret');
  mesh(pitch, 'pitch');
  if (u.key === 'leopard') {
    pitch.position.set(0, 1.02, 2.2);
    const recoil = new T.Group();
    recoil.name = 'recoil';
    recoil.userData.dynamic = true;
    pitch.add(recoil);
    dynamic.add(recoil);
    mesh(recoil, 'recoil');
    pitch.userData.muzzles = [[0, 0, 9.56]];
    // Existing continuous wheel/link animation retains its names and dimensions.
    for (const [name, geometry, color, count] of [
      ['road-wheels', world.cylGeo, '#2c3930', 12],
      ['drive-spokes', world.boxGeo, '#8a947b', 24],
      ['track-links', world.boxGeo, '#566050', 80],
    ]) {
      const wheels = new T.InstancedMesh(geometry, world.mat(color), count);
      wheels.name = name;
      wheels.instanceMatrix.setUsage(T.DynamicDrawUsage);
      wheels.castShadow = wheels.receiveShadow = true;
      wheels.frustumCulled = false;
      root.add(wheels);
    }
    animateVehicleDrive(root, 0);
  } else {
    pitch.position.y = 1;
    pitch.userData.muzzles = Array.from({ length: 12 }, (_, i) => [
      ((i % 4) - 1.5) * 1.05,
      0.55 + Math.floor(i / 4) * 1.03,
      3.06,
    ]);
    for (const x of [-2.5, 2.5])
      for (const z of [-4, -1.3, 3.6]) {
        const wheel = mesh(root, 'wheel');
        wheel.position.set(x, 1.1, z);
      }
  }
  root.userData.turret = turret;
  root.userData.pitch = pitch;
  return true;
}

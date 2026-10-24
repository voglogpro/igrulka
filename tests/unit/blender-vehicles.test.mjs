import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { VEHICLE_MESHES } from '../../src/rendering/models/generated/vehicle-meshes.js';
import {
  blenderVehicleGeometry,
  buildBlenderVehicle,
} from '../../src/rendering/models/vehicles/blender-vehicles.js';

test('Blender export has finite indexed triangles, unit normals and bounded triangle budget', () => {
  let triangles = 0;
  for (const [key, source] of Object.entries(VEHICLE_MESHES)) {
    const g = blenderVehicleGeometry(key);
    assert.equal(g, blenderVehicleGeometry(key));
    assert.equal(source.vertices.length % 7, 0);
    assert.equal(source.indices.length % 3, 0);
    assert.ok(source.vertices.every(Number.isFinite));
    for (const i of source.indices) assert.ok(i >= 0 && i < source.vertices.length / 7);
    for (let i = 0; i < source.vertices.length; i += 7) {
      assert.ok(Math.abs(Math.hypot(...source.vertices.slice(i + 3, i + 6)) - 1) < 0.001);
    }
    const p = g.attributes.position,
      a = new T.Vector3(),
      b = new T.Vector3(),
      c = new T.Vector3();
    for (let i = 0; i < source.indices.length; i += 3) {
      a.fromBufferAttribute(p, source.indices[i]);
      b.fromBufferAttribute(p, source.indices[i + 1]);
      c.fromBufferAttribute(p, source.indices[i + 2]);
      assert.ok(b.sub(a).cross(c.sub(a)).lengthSq() > 1e-12, key);
    }
    triangles += source.indices.length / 3;
  }
  assert.ok(triangles < 14000, triangles);
});

test('Vehicle instances share assets, fit original scale and preserve articulation/muzzle contracts', () => {
  const world = {
    cylGeo: new T.CylinderGeometry(1, 1, 1, 8),
    boxGeo: new T.BoxGeometry(),
    mat: () => new T.MeshStandardMaterial(),
  };
  for (const key of ['leopard', 'mlrs']) {
    const a = new T.Group(),
      b = new T.Group(),
      dynamic = new Set();
    assert.equal(buildBlenderVehicle(world, { key }, a, '#74836b', '#ffffff', dynamic), true);
    buildBlenderVehicle(world, { key }, b, '#74836b', '#ffffff', new Set());
    assert.equal(a.children[0].geometry, b.children[0].geometry);
    assert.equal(a.children[0].material, b.children[0].material);
    const turret = a.getObjectByName('turret'),
      pitch = a.getObjectByName('pitch');
    assert.ok(dynamic.has(turret) && dynamic.has(pitch));
    assert.equal(pitch.parent, turret);
    assert.equal(pitch.userData.muzzles.length, key === 'mlrs' ? 12 : 1);
    a.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(a),
      size = bounds.getSize(new T.Vector3());
    assert.ok(bounds.min.y >= -0.01);
    assert.ok(size.x > 4 && size.x < 12);
    assert.ok(size.z > 10 && size.z < 20);
    assert.ok(size.y > 4 && size.y < 10);
    if (key === 'leopard') {
      assert.ok(a.getObjectByName('recoil'));
      assert.equal(a.getObjectByName('road-wheels').count, 12);
      assert.equal(a.getObjectByName('track-links').count, 80);
    }
    const before = pitch.localToWorld(new T.Vector3(...pitch.userData.muzzles[0]));
    turret.rotation.y = 0.8;
    pitch.rotation.x = -0.3;
    a.updateMatrixWorld(true);
    const after = pitch.localToWorld(new T.Vector3(...pitch.userData.muzzles[0]));
    assert.ok(before.distanceTo(after) > 1);
  }
  assert.equal(buildBlenderVehicle(world, { key: 'ifv' }, new T.Group(), '', '', new Set()), false);
});

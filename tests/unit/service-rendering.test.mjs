import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { ServiceFleet } from '../../src/rendering/service-fleet.js';
import { serviceStationModel } from '../../src/rendering/models/city/service-station.js';

const vehicle = (id, side = 0, state = 'outbound') => ({
  id,
  side,
  state,
  x: id,
  z: -id,
  yaw: 0.4,
});

test('service fleet mirrors simulation coordinates, respects fog and caps each side', () => {
  const scene = new T.Scene(),
    fleet = new ServiceFleet(scene, {
      height: () => 2,
      visible: (_state, v) => v.id !== 30,
    }),
    vehicles = Array.from({ length: 14 }, (_, i) => vehicle(i));
  vehicles.push(...Array.from({ length: 12 }, (_, i) => vehicle(30 + i, 1, 'repairing')));
  const state = { time: 3, serviceVehicles: vehicles };
  fleet.sync(state);
  assert.deepEqual(fleet.diagnostics(), {
    vehicles: 16,
    repairing: 8,
    capacity: 32,
    drawCalls: 5,
    disposed: false,
  });
  const matrix = new T.Matrix4();
  fleet.body.getMatrixAt(8, matrix);
  assert.equal(matrix.elements[12], 31);
  assert.equal(matrix.elements[14], -31);
  assert.ok(Math.abs(matrix.elements[13] - 2.5) < 1e-5);
  // Real asphalt in terrain/roads.js spans -0.05 .. 0.55 above the terrain.
  const roadTop = 2 + (-0.05 + 0.6);
  fleet.body.geometry.computeBoundingBox();
  const vanBounds = fleet.body.geometry.boundingBox.clone().applyMatrix4(matrix);
  assert.ok(vanBounds.min.y > roadTop, 'van tires must clear the asphalt surface');
  fleet.work.getMatrixAt(0, matrix);
  fleet.work.geometry.computeBoundingBox();
  const workBounds = fleet.work.geometry.boundingBox.clone().applyMatrix4(matrix);
  assert.ok(matrix.elements[13] > roadTop, 'repair marker center must be above asphalt');
  assert.ok(workBounds.min.y > roadTop, 'entire repair marker must clear asphalt while pulsing');
  const body = Array.from(fleet.body.instanceMatrix.array),
    beacon = Array.from(fleet.beacons.instanceMatrix.array);
  fleet.update(4);
  assert.deepEqual(Array.from(fleet.body.instanceMatrix.array), body);
  assert.notDeepEqual(Array.from(fleet.beacons.instanceMatrix.array), beacon);
  const paused = Array.from(fleet.beacons.instanceMatrix.array);
  fleet.update(4);
  assert.deepEqual(Array.from(fleet.beacons.instanceMatrix.array), paused);
  assert.equal(scene.children.filter((o) => o.isLight).length, 0);
  fleet.sync({ time: 5, serviceVehicles: [] });
  assert.ok(fleet.meshes.every((m) => m.count === 0));
  fleet.dispose();
});

test('ammo fleet uses the same bounded batches and follows current-frame field positions', () => {
  const scene = new T.Scene(),
    fleet = new ServiceFleet(scene, { collection: 'ammoVehicles', paint: '#74836c' });
  const v = { id: 900, side: 0, x: -1000, z: 150, yaw: 0.2, status: 'outbound' };
  fleet.sync({ time: 0, ammoVehicles: [v], serviceVehicles: [vehicle(1)] });
  const body = new T.Matrix4(),
    shadow = new T.Matrix4();
  fleet.body.getMatrixAt(0, body);
  fleet.shadows.mesh.getMatrixAt(0, shadow);
  assert.equal(body.elements[12], v.x);
  assert.equal(shadow.elements[12], v.x);
  const storage = fleet.body.instanceMatrix.array;
  v.x += 31;
  v.z += 12;
  v.status = 'unloading';
  fleet.sync({ time: 1, ammoVehicles: [v] });
  fleet.body.getMatrixAt(0, body);
  fleet.shadows.mesh.getMatrixAt(0, shadow);
  assert.equal(body.elements[12], v.x);
  assert.equal(shadow.elements[12], v.x);
  assert.equal(body.elements[14], v.z);
  assert.equal(fleet.body.castShadow, false);
  assert.equal(fleet.body.instanceMatrix.array, storage);
  assert.equal(fleet.diagnostics().repairing, 1);
  v.hp = 0;
  fleet.sync({ time: 1.5, ammoVehicles: [v] });
  assert.equal(fleet.body.count, 0, 'destroyed slots stay in logistics but have no live van mesh');
  fleet.sync({ time: 2, ammoVehicles: [] });
  assert.equal(fleet.shadows.mesh.count, 0);
  fleet.dispose();
  assert.equal(scene.children.length, 0);
});
test('all four city fleets are visible and independently bounded in the same shared draw batches', () => {
  const scene = new T.Scene(),
    fleet = new ServiceFleet(scene);
  const vehicles = Array.from({ length: 4 }, (_, side) =>
    Array.from({ length: 10 }, (_, i) => vehicle(side * 100 + i, side)),
  ).flat();
  fleet.sync({ time: 0, serviceVehicles: vehicles });
  assert.equal(fleet.diagnostics().vehicles, 32);
  assert.equal(fleet.diagnostics().drawCalls, 4);
  const matrix = new T.Matrix4();
  for (const side of [0, 1, 2, 3]) {
    fleet.body.getMatrixAt(side * 8, matrix);
    assert.equal(matrix.elements[12], side * 100);
  }
  fleet.dispose();
});

test('empty and paused fleets retain GPU data and hide zero-count meshes without losing later arrivals', () => {
  const fleet = new ServiceFleet(new T.Scene()),
    meshes = [...fleet.meshes, fleet.shadows.mesh],
    state = { time: 7.25, serviceVehicles: [] };
  fleet.sync(state, 4.2);
  const emptyVersions = meshes.map((m) => m.instanceMatrix.version);
  for (let i = 0; i < 60; i++) fleet.sync(state, 4.2);
  assert.deepEqual(
    meshes.map((m) => m.instanceMatrix.version),
    emptyVersions,
  );
  assert.ok(meshes.every((m) => m.count === 0 && !m.visible));
  state.serviceVehicles = [vehicle(12, 0, 'repairing')];
  fleet.sync(state, 4.2);
  assert.ok(meshes.every((m) => m.count === 1 && m.visible));
  for (const mesh of meshes) {
    mesh.computeBoundingSphere();
    mesh.instanceMatrix.clearUpdateRanges();
  }
  const versions = meshes.map((m) => m.instanceMatrix.version),
    data = meshes.map((m) => m.instanceMatrix.array.slice()),
    bounds = meshes.map((m) => m.boundingSphere);
  for (let i = 0; i < 60; i++) fleet.sync(state, 4.2);
  assert.deepEqual(
    meshes.map((m) => m.instanceMatrix.version),
    versions,
  );
  assert.deepEqual(
    meshes.map((m) => m.instanceMatrix.array),
    data,
  );
  assert.deepEqual(
    meshes.map((m) => m.boundingSphere),
    bounds,
  );
  fleet.update(4.3);
  assert.deepEqual(
    meshes.slice(0, 2).map((m) => m.instanceMatrix.version),
    versions.slice(0, 2),
  );
  assert.ok(fleet.beacons.instanceMatrix.version > versions[2]);
  assert.ok(fleet.work.instanceMatrix.version > versions[3]);
  assert.deepEqual(fleet.beacons.instanceMatrix.updateRanges, [{ start: 0, count: 16 }]);
  state.serviceVehicles = [];
  fleet.sync(state, 4.3);
  assert.ok(meshes.every((m) => !m.visible && m.count === 0));
  fleet.dispose();
});

test('one final battle-clock fleet sync matches the former snapshot-then-animation poses exactly', () => {
  const old = new ServiceFleet(new T.Scene()),
    current = new ServiceFleet(new T.Scene()),
    vehicles = [vehicle(12, 0, 'repairing'), vehicle(55, 1, 'outbound')],
    state = { time: 1000, serviceVehicles: vehicles };
  for (const time of [0, 0.016, 4.2, 4.2, 9.33]) {
    old.sync(state);
    old.update(time);
    current.sync(state, time);
    assert.deepEqual(
      [...current.meshes, current.shadows.mesh].map((m) => m.instanceMatrix.array),
      [...old.meshes, old.shadows.mesh].map((m) => m.instanceMatrix.array),
    );
    assert.deepEqual(current.diagnostics(), old.diagnostics());
  }
  // Existing callers without a visual clock keep snapshot-time animation.
  old.sync(state);
  current.sync(state);
  assert.deepEqual(current.beacons.instanceMatrix.array, old.beacons.instanceMatrix.array);
  old.dispose();
  current.dispose();
});

test('service fleet retains shared buffers across snapshots and disposes every resource once', () => {
  const scene = new T.Scene(),
    fleet = new ServiceFleet(scene);
  const buffers = fleet.meshes.map((m) => m.instanceMatrix.array);
  const resources = new Set(fleet.meshes.flatMap((m) => [m.geometry, m.material, m]));
  let disposed = 0;
  for (const resource of resources) resource.addEventListener('dispose', () => disposed++);
  for (let i = 0; i < 30; i++) {
    fleet.sync({ time: i, serviceVehicles: [vehicle(i, i % 2, 'repairing')] });
    assert.ok(fleet.meshes.every((m, index) => m.instanceMatrix.array === buffers[index]));
    assert.ok(fleet.meshes.every((m) => m.instanceMatrix.array.every(Number.isFinite)));
  }
  fleet.dispose();
  assert.equal(disposed, resources.size);
  fleet.dispose();
  fleet.sync({ time: 0, serviceVehicles: [vehicle(4)] });
  fleet.update(2);
  assert.equal(disposed, resources.size);
  assert.equal(scene.children.length, 0);
  assert.equal(fleet.diagnostics().vehicles, 0);
});

test('service workshop details fit its 26 m lot and remain static for city batching', () => {
  const content = new T.Group(),
    geometry = new T.BoxGeometry(1, 1, 1),
    cylinder = new T.CylinderGeometry(1, 1, 1, 8),
    material = new T.MeshStandardMaterial();
  const add = (parent, geo, x, y, z, width, height, depth) => {
    const mesh = new T.Mesh(geo, material);
    mesh.position.set(x, y + height / 2, z);
    mesh.scale.set(width, height, depth);
    parent.add(mesh);
    return mesh;
  };
  const world = {
    box: (parent, x, y, z, width, height, depth) =>
      add(parent, geometry, x, y, z, width, height, depth),
    cyl: (parent, x, y, z, radius, height) =>
      add(parent, cylinder, x, y, z, radius, height, radius),
  };
  serviceStationModel(world, content, '#a8c4b0');
  const bounds = new T.Box3().setFromObject(content);
  assert.ok(bounds.min.x >= -13 && bounds.max.x <= 13);
  assert.ok(bounds.min.z >= -13 && bounds.max.z <= 13);
  assert.ok(bounds.max.y < 13);
  assert.ok(content.children.length > 45);
  assert.ok(content.children.every((o) => !o.userData.dynamic && !o.isLight));
  geometry.dispose();
  cylinder.dispose();
  material.dispose();
});

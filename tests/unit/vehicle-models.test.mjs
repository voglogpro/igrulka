import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { RTSWorld } from '../../src/rendering/world.js';
import { groundModel, animateGround } from '../../src/rendering/models/ground.js';

// Exercise the real model builders and batching without needing a GPU or browser globals.
const world = {
  boxGeo: new T.BoxGeometry(1, 1, 1),
  cylGeo: new T.CylinderGeometry(1, 1, 1, 12),
  sphereGeo: new T.IcosahedronGeometry(1, 1),
  materials: new Map(),
  sharedGeometries: new Set(),
  sharedMaterials: new Set(),
  mat: RTSWorld.prototype.mat,
  box: RTSWorld.prototype.box,
  cyl: RTSWorld.prototype.cyl,
};
const unit = (id, key = 'leopard') => ({
  id,
  key,
  side: 0,
  x: -400,
  y: 1,
  z: 0,
  yaw: 0,
  hp: 500,
  maxHp: 500,
  setup: 1,
  targetX: -320,
  targetY: 15,
  targetZ: 100,
});
const geometryIds = (model) => {
  const ids = new Set();
  model.traverse((object) => {
    if (object.geometry) ids.add(object.geometry.uuid);
  });
  return [...ids].sort();
};

test('detailed vehicles retain live turrets/barrels and share geometry across fifty copies', () => {
  const first = groundModel(world, unit(1));
  assert.ok(first.userData.turret?.parent, 'the rotating turret must survive static batching');
  assert.ok(first.userData.pitch?.parent, 'barrel elevation must survive static batching');
  assert.equal(first.userData.recoil?.parent, first.userData.pitch);
  const geometries = geometryIds(first),
    materials = world.sharedMaterials.size;
  for (let i = 2; i <= 51; i++)
    assert.deepEqual(geometryIds(groundModel(world, unit(i))), geometries);
  assert.equal(world.sharedMaterials.size, materials, 'copies must not allocate private materials');
});

test('vehicle drive instances are independent and moving a copy does not animate its neighbour', () => {
  const a = groundModel(world, unit(101)),
    b = groundModel(world, unit(102));
  const aLinks = a.getObjectByName('track-links'),
    bLinks = b.getObjectByName('track-links');
  assert.equal(aLinks.geometry, bLinks.geometry);
  assert.notEqual(aLinks.instanceMatrix.array, bLinks.instanceMatrix.array);
  const stationary = [...bLinks.instanceMatrix.array];
  animateGround(a, { ...unit(101), moving: true }, 1, 0.05);
  assert.deepEqual([...bLinks.instanceMatrix.array], stationary);
  assert.notDeepEqual([...aLinks.instanceMatrix.array], stationary);
  const phase = a.userData.drivePhase;
  animateGround(a, { ...unit(101), moving: true }, 1, 0);
  assert.equal(a.userData.drivePhase, phase, 'a paused battle cannot advance the tracks');
});

test('vehicle turret tracking reaches the same pose at thirty and one hundred twenty frames', () => {
  const u = unit(201),
    a = groundModel(world, u),
    b = groundModel(world, unit(202));
  for (let i = 1; i <= 30; i++) animateGround(a, u, i / 30, 1 / 30);
  for (let i = 1; i <= 120; i++) animateGround(b, u, i / 120, 1 / 120);
  assert.ok(Math.abs(a.userData.turret.rotation.y - b.userData.turret.rotation.y) < 1e-9);
  const paused = a.userData.turret.rotation.y;
  animateGround(a, { ...u, targetX: -700 }, 1, 0);
  assert.equal(a.userData.turret.rotation.y, paused);
  for (const key of ['apc', 'gepard', 'shilka', 'mog']) {
    const model = groundModel(world, unit(300, key));
    assert.ok(model.userData.turret?.parent, `${key} must retain its aiming node`);
  }
});

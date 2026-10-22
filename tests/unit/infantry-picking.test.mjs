import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import * as E from '../../src/game/index.js';
import { RTSWorld } from '../../src/rendering/world.js';
import { InfantryBatch } from '../../src/rendering/models/infantry/soldiers.js';
test('an instanced soldier stays ray selectable after moving far outside the first picking bounds', () => {
  const s = E.createGame(830),
    u = E.makeGround(s, 0, 'infantry', -500, 250);
  s.groundUnits.push(u);
  const world = {
    state: s,
    armySelection: [],
    scene: new T.Scene(),
    boxGeo: new T.BoxGeometry(),
    cylGeo: new T.CylinderGeometry(1, 1, 1, 12),
    materials: new Map(),
    sharedGeometries: new Set(),
    sharedMaterials: new Set(),
    mat: RTSWorld.prototype.mat,
    box: RTSWorld.prototype.box,
    cyl: RTSWorld.prototype.cyl,
    camera: new T.OrthographicCamera(-1000, 1000, 1000, -1000, 0.1, 3000),
  };
  world.camera.position.set(0, 1500, 0);
  world.camera.up.set(0, 0, -1);
  world.camera.lookAt(0, 0, 0);
  const batch = new InfantryBatch(world),
    ray = new T.Raycaster();
  const pick = () => {
    batch.sync(s.groundUnits, s.time);
    world.scene.updateMatrixWorld(true);
    ray.set(new T.Vector3(u.x, 30, u.z), new T.Vector3(0, -1, 0));
    const hits = ray.intersectObjects(batch.meshes);
    return hits.map((hit) => hit.object.userData.unitIds[hit.instanceId]);
  };
  assert.ok(pick().includes(u.id));
  u.x = 500;
  assert.ok(pick().includes(u.id));
  const pool = batch.pools.get('infantry0');
  assert.ok(pool.body.boundingSphere.center.x > 490);
});

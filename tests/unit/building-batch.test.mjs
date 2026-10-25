import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { RTSWorld } from '../../src/rendering/world.js';
import { BuildingBatch } from '../../src/rendering/performance/building-batch.js';
import { model } from '../../src/rendering/models/buildings.js';

function fixture() {
  return {
    scene: new T.Scene(),
    facade: new T.Texture(),
    emission: new T.Texture(),
    glowTexture: new T.Texture(),
    boxGeo: new T.BoxGeometry(),
    cylGeo: new T.CylinderGeometry(1, 1, 1, 12),
    sphereGeo: new T.IcosahedronGeometry(1, 1),
    materials: new Map(),
    sharedGeometries: new Set(),
    sharedMaterials: new Set(),
    height: () => 0,
    clearTrees() {},
    mat: RTSWorld.prototype.mat,
    box: RTSWorld.prototype.box,
    cyl: RTSWorld.prototype.cyl,
  };
}
test('one hundred ordinary buildings share assets and opaque draws while preserving picking and shadows', () => {
  const w = fixture(),
    batch = new BuildingBatch(w.scene),
    models = new Map();
  for (let i = 0; i < 100; i++)
    models.set(
      i,
      model.call(w, {
        id: i,
        key: 'housing',
        side: 0,
        x: i * 40,
        z: 0,
        level: 0,
        hp: 300,
        progress: 1,
      }),
    );
  const geometry = new Set();
  for (const m of models.values())
    m.root.traverse((o) => {
      if (o.geometry) geometry.add(o.geometry.uuid);
    });
  assert.ok(geometry.size < 12, `shared geometry count ${geometry.size}`);
  for (const m of models.values()) m.scaffold.visible = false;
  batch.sync(models);
  assert.equal(batch.diagnostics().proxies, 100);
  assert.ok(batch.diagnostics().batches < 10);
  assert.ok([...batch.groups.values()].some((g) => g.mesh.castShadow && g.mesh.count === 100));
  const versions = [...batch.groups.values()].map((g) => g.mesh.instanceMatrix.version);
  for (let i = 0; i < 20; i++) batch.sync(models);
  assert.deepEqual(
    [...batch.groups.values()].map((g) => g.mesh.instanceMatrix.version),
    versions,
    'static frames do not upload identical buffers',
  );
  w.scene.updateMatrixWorld(true);
  const ray = new T.Raycaster(new T.Vector3(0, 100, 0), new T.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(models.get(0).root, true).length, 'logical proxy remains pickable');
  const before = [...batch.groups.values()].reduce((n, g) => n + g.count, 0);
  models.get(0).content.visible = false;
  batch.sync(models);
  assert.ok(
    [...batch.groups.values()].reduce((n, g) => n + g.count, 0) < before,
    'ruined content disappears from instances',
  );
  models.clear();
  batch.sync(models);
  assert.equal(batch.diagnostics().proxies, 0);
  assert.equal(batch.diagnostics().batches, 0);
  const meshes = [...batch.groups.values()].map((g) => g.mesh);
  batch.dispose();
  assert.ok(meshes.every((m) => m.parent === null));
  assert.equal(batch.groups.size, 0);
});

test('dynamic defense turrets remain outside the static city batch', () => {
  const w = fixture(),
    batch = new BuildingBatch(w.scene);
  const defense = model.call(w, { id: 1, key: 'sam', side: 0, x: 0, z: 0, hp: 300, progress: 1 });
  batch.sync(new Map([[1, defense]]));
  assert.equal(batch.diagnostics().proxies, 0);
  assert.ok(defense.root.userData.turret);
  let visible = 0;
  defense.root.traverse((o) => {
    if (o.isMesh && o.visible) visible++;
  });
  assert.ok(visible > 0);
});

test('city culling includes offscreen shadow casters but excludes proxies outside both frusta', () => {
  const w = fixture(),
    batch = new BuildingBatch(w.scene),
    models = new Map();
  for (const [id, x] of [0, 400, 1000].entries()) {
    const m = model.call(w, { id, key: 'housing', side: 0, x, z: 0, hp: 300, progress: 1 });
    m.scaffold.visible = false;
    models.set(id, m);
  }
  const camera = new T.OrthographicCamera(-100, 100, 100, -100, 1, 500);
  camera.position.set(0, 200, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  const sun = new T.DirectionalLight();
  sun.position.set(400, 200, 0);
  sun.target.position.set(400, 0, 0);
  Object.assign(sun.shadow.camera, {
    left: -100,
    right: 100,
    top: 100,
    bottom: -100,
    near: 1,
    far: 500,
  });
  sun.shadow.camera.updateProjectionMatrix();
  batch.sync(models, camera, sun);
  assert.equal(batch.diagnostics().entities, 2);
  batch.sync(models, camera);
  assert.equal(batch.diagnostics().entities, 1);
  w.scene.updateMatrixWorld(true);
  const ray = new T.Raycaster(new T.Vector3(1000, 100, 0), new T.Vector3(0, -1, 0));
  assert.ok(
    ray.intersectObject(models.get(2).root, true).length,
    'culled proxy still exists for independent picking',
  );
});

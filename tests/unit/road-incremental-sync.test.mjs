import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { sync } from '../../src/rendering/sync.js';
import { road } from '../../src/rendering/terrain/roads.js';
import { RTSWorld } from '../../src/rendering/world.js';
import { RoadVisualCache } from '../../src/rendering/performance/road-visual-cache.js';
import { VehicleBatch } from '../../src/rendering/performance/vehicle-batch.js';

const segment = (id, ax, az, bx, bz) => ({ id, side: 0, ax, az, bx, bz, hp: 100, maxHp: 100 });
function world(roads) {
  const w = {
    state: {
      roads,
      buildings: [],
      units: [],
      groundUnits: [],
      projectiles: [],
      events: [],
      time: 0,
    },
    scene: new T.Scene(),
    boxGeo: new T.BoxGeometry(),
    cylGeo: new T.CylinderGeometry(),
    materials: new Map(),
    sharedGeometries: new Set(),
    sharedMaterials: new Set(),
    glowTexture: new T.Texture(),
    models: new Map(),
    unitModels: new Map(),
    groundModels: new Map(),
    roadModels: new Map(),
    roadVisuals: new Map(),
    roadView: new RoadVisualCache(),
    renderer: { shadowMap: {} },
    camera: new T.PerspectiveCamera(),
    groundVisibility: { sync: () => new Set() },
    infantry: { sync() {}, meshes: [] },
    vehicleBatch: { sync() {} },
    contactShadows: { sync() {} },
    syncTrenches() {},
    combatFX: { updateTracers() {} },
    armySelection: [],
    callbacks: {},
    clearTrees() {},
    mat: RTSWorld.prototype.mat,
    box: RTSWorld.prototype.box,
    cyl: RTSWorld.prototype.cyl,
    built: [],
    road(r, network) {
      this.built.push(r.id);
      return road.call(this, r, network);
    },
  };
  w.sharedGeometries.add(w.boxGeo);
  w.sharedGeometries.add(w.cylGeo);
  w.roadBatch = new VehicleBatch(w.scene);
  return w;
}

test('one far road builds one real decorated model and preserves 500 existing models and bounded draws', () => {
  const roads = Array.from({ length: 500 }, (_, i) => segment(i + 1, i * 80, 0, i * 80, 60));
  const w = world(roads);
  let disposed = 0;
  w.boxGeo.addEventListener('dispose', () => disposed++);
  w.cylGeo.addEventListener('dispose', () => disposed++);
  sync.call(w);
  const originals = new Map(w.roadModels),
    draws = w.roadBatch.diagnostics().batches;
  const bounds = new Map(
    [...originals].map(([id, model]) => [id, new T.Box3().setFromObject(model).clone()]),
  );
  w.built.length = 0;
  roads.push(segment(501, 100000, 100000, 100000, 100060));
  sync.call(w);
  assert.deepEqual(w.built, [501]);
  for (const [id, model] of originals) {
    assert.equal(w.roadModels.get(id), model);
    assert.deepEqual(new T.Box3().setFromObject(model), bounds.get(id));
  }
  assert.equal(w.roadBatch.diagnostics().batches, draws);
  assert.equal(disposed, 0, 'adding a remote road never disposes cold road geometry');
  w.built.length = 0;
  const layout = w.streetLayout,
    buffers = [
      w.roadView.roads,
      w.roadView.changed,
      w.roadView.removed,
      w.roadView.footprints,
      w.roadView.dirty,
    ];
  const footprints = new Map([...w.roadView.records].map(([id, record]) => [id, record.bounds]));
  for (let i = 0; i < 10; i++) {
    sync.call(w);
    assert.equal(w.streetLayout, layout);
    assert.deepEqual(
      [
        w.roadView.roads,
        w.roadView.changed,
        w.roadView.removed,
        w.roadView.footprints,
        w.roadView.dirty,
      ].map((buffer, index) => buffer === buffers[index]),
      [true, true, true, true, true],
    );
    for (const [id, record] of w.roadView.records) assert.equal(record.bounds, footprints.get(id));
  }
  assert.deepEqual(w.built, []);
});

const bytes = (attribute) =>
  attribute
    ? [
        ...new Uint8Array(
          attribute.array.buffer,
          attribute.array.byteOffset,
          attribute.array.byteLength,
        ),
      ]
    : null;
function appearance(root) {
  root.updateMatrixWorld(true);
  const nodes = [];
  root.traverse((m) =>
    nodes.push({
      type: m.type,
      matrix: [...m.matrixWorld.elements],
      visible: m.visible,
      renderOrder: m.renderOrder,
      castShadow: m.castShadow,
      receiveShadow: m.receiveShadow,
      geometry: m.geometry
        ? {
            attributes: Object.fromEntries(
              Object.entries(m.geometry.attributes).map(([key, value]) => [key, bytes(value)]),
            ),
            index: bytes(m.geometry.index),
          }
        : null,
      material: m.material
        ? {
            type: m.material.type,
            color: m.material.color?.toArray(),
            emissive: m.material.emissive?.toArray(),
            emissiveIntensity: m.material.emissiveIntensity,
            opacity: m.material.opacity,
            transparent: m.material.transparent,
            depthWrite: m.material.depthWrite,
            polygonOffset: m.material.polygonOffset,
            polygonOffsetFactor: m.material.polygonOffsetFactor,
            polygonOffsetUnits: m.material.polygonOffsetUnits,
            map: !!m.material.map,
          }
        : null,
    }),
  );
  return nodes;
}
function matchesFullRebuild(w) {
  const fresh = world(structuredClone(w.state.roads));
  sync.call(fresh);
  assert.deepEqual([...w.roadModels.keys()].sort(), [...fresh.roadModels.keys()].sort());
  for (const [id, model] of w.roadModels)
    assert.deepEqual(
      appearance(model),
      appearance(fresh.roadModels.get(id)),
      `road ${id} differs from a fresh full decorated network`,
    );
  assert.equal(w.roadBatch.diagnostics().batches, fresh.roadBatch.diagnostics().batches);
}

test('adding/removing an intersection clips and restores real curb/paint geometry exactly like a full network rebuild', () => {
  const a = segment(1, 0, 0, 100, 0),
    far = segment(3, 1000, 0, 1100, 0),
    w = world([a, far]);
  sync.call(w);
  const original = appearance(w.roadModels.get(1)),
    farModel = w.roadModels.get(3);
  const crossing = segment(2, 50, -50, 50, 50);
  w.state.roads.push(crossing);
  w.built.length = 0;
  sync.call(w);
  assert.deepEqual(w.built, [1, 2]);
  assert.notDeepEqual(appearance(w.roadModels.get(1)), original);
  assert.equal(w.roadModels.get(3), farModel);
  matchesFullRebuild(w);
  const removedModel = w.roadModels.get(2);
  crossing.removed = true;
  w.built.length = 0;
  sync.call(w);
  assert.deepEqual(w.built, [1]);
  assert.equal(w.roadModels.has(2), false);
  assert.equal(removedModel.parent, null);
  assert.deepEqual(
    appearance(w.roadModels.get(1)),
    original,
    'removal restores every old curb and paint mark',
  );
  matchesFullRebuild(w);
  crossing.removed = false;
  sync.call(w);
  matchesFullRebuild(w);
  w.state.roads.splice(w.state.roads.indexOf(crossing), 1);
  sync.call(w);
  assert.deepEqual(appearance(w.roadModels.get(1)), original);
  matchesFullRebuild(w);
});

test('moving a road invalidates old and new neighbours while connector width and health stay local and visually exact', () => {
  const a = segment(1, 0, 0, 100, 0),
    crossing = segment(2, 50, -50, 50, 50),
    b = segment(3, 200, 0, 300, 0),
    far = segment(4, 1000, 0, 1100, 0),
    w = world([a, crossing, b, far]);
  sync.call(w);
  const farModel = w.roadModels.get(4);
  crossing.ax = crossing.bx = 250;
  w.built.length = 0;
  sync.call(w);
  assert.deepEqual(w.built, [1, 2, 3]);
  assert.equal(w.roadModels.get(4), farModel);
  matchesFullRebuild(w);
  for (const connector of [9, undefined]) {
    crossing.connectorTo = connector;
    w.built.length = 0;
    sync.call(w);
    assert.deepEqual(w.built, [2, 3]);
    matchesFullRebuild(w);
  }
  for (const hp of [99, 0, 100]) {
    const neighbour = w.roadModels.get(3);
    crossing.hp = hp;
    w.built.length = 0;
    sync.call(w);
    assert.deepEqual(w.built, [2]);
    assert.equal(w.roadModels.get(3), neighbour, 'health does not change the junction footprint');
    matchesFullRebuild(w);
  }
  crossing.ax = 240;
  crossing.az = -40;
  crossing.bx = 270;
  crossing.bz = 40;
  sync.call(w);
  matchesFullRebuild(w);
  assert.equal(w.roadModels.get(4), farModel);
});

test('default road proxies and batches never cast sun shadows or invalidate dry empty-road shadow maps', () => {
  const r = segment(1, 0, 0, 100, 0),
    w = world([r]);
  for (const mutate of [
    () => {},
    () => {
      r.hp = 0;
    },
    () => {
      r.removed = true;
    },
  ]) {
    mutate();
    w.renderer.shadowMap.needsUpdate = false;
    sync.call(w);
    assert.equal(w.renderer.shadowMap.needsUpdate, false);
    for (const root of w.roadModels.values())
      root.traverse((part) => {
        if (part.isMesh) {
          assert.equal(part.castShadow, false);
          assert.equal(part.visible, false);
        }
      });
    for (const group of w.roadBatch.groups.values()) assert.equal(group.mesh.castShadow, false);
  }
  w.renderer.shadowMap.needsUpdate = true;
  r.removed = false;
  sync.call(w);
  assert.equal(
    w.renderer.shadowMap.needsUpdate,
    true,
    'road work must preserve another caster invalidation',
  );
});

test('a real instanced forest cut still invalidates shadows and tree matrices through the default road builder', () => {
  const r = segment(1, 0, 0, 100, 0),
    w = world([r]);
  const trees = new T.InstancedMesh(new T.BoxGeometry(), new T.MeshStandardMaterial(), 2);
  trees.castShadow = true;
  trees.setMatrixAt(0, new T.Matrix4().makeTranslation(50, 1, 0));
  trees.setMatrixAt(1, new T.Matrix4().makeTranslation(1000, 1, 0));
  w.scene.add(trees);
  w.trees = [
    { x: 50, z: 0, index: 0, meshes: [trees] },
    { x: 1000, z: 0, index: 1, meshes: [trees] },
  ];
  w.clearTrees = RTSWorld.prototype.clearTrees;
  w.renderer.shadowMap.needsUpdate = false;
  const version = trees.instanceMatrix.version;
  sync.call(w);
  assert.equal(w.trees[0].cleared, true);
  assert.equal(w.trees[1].cleared, undefined);
  assert.equal(w.renderer.shadowMap.needsUpdate, true);
  assert.ok(trees.instanceMatrix.version > version);
  const matrix = new T.Matrix4();
  trees.getMatrixAt(0, matrix);
  assert.equal(matrix.elements[0], 0);
  assert.equal(matrix.elements[5], 0);
  trees.getMatrixAt(1, matrix);
  assert.equal(matrix.elements[12], 1000);
  const clearedVersion = trees.instanceMatrix.version;
  w.renderer.shadowMap.needsUpdate = false;
  r.hp = 0;
  sync.call(w);
  assert.equal(
    w.renderer.shadowMap.needsUpdate,
    false,
    'already cleared trees must not regenerate another shadow map',
  );
  assert.equal(trees.instanceMatrix.version, clearedVersion);
});

test('an explicitly shadow-casting road batch still invalidates the sun map on addition, health and removal', () => {
  const r = segment(1, 0, 0, 100, 0),
    w = world([r]);
  w.roadBatch = new VehicleBatch(w.scene, { castShadows: true });
  for (const mutate of [
    () => {},
    () => {
      r.hp = 0;
    },
    () => {
      r.removed = true;
    },
  ]) {
    mutate();
    w.renderer.shadowMap.needsUpdate = false;
    sync.call(w);
    assert.equal(w.renderer.shadowMap.needsUpdate, true);
  }
});

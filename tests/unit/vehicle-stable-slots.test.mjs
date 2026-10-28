import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { VehicleBatch } from '../../src/rendering/performance/vehicle-batch.js';
import { groundModel, animateGround } from '../../src/rendering/models/ground.js';
import { RTSWorld } from '../../src/rendering/world.js';

const geometry = new T.BoxGeometry(),
  material = new T.MeshStandardMaterial();
function source(id, count = 3, tagged = true, capacity = count) {
  const root = new T.Group(),
    parent = new T.Group(),
    mesh = new T.InstancedMesh(geometry, material, capacity);
  root.userData.groundId = id;
  mesh.userData.versionedDrive = tagged;
  mesh.count = count;
  for (let i = 0; i < capacity; i++)
    mesh.setMatrixAt(i, new T.Matrix4().makeTranslation(i * 3, 0, 0));
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
  root.add(parent);
  return root;
}
const instance = (root) => {
  let result;
  root.traverse((m) => {
    if (m.isInstancedMesh && !result) result = m;
  });
  return result;
};
function cloneProxy(root) {
  const clone = root.clone(true);
  for (const [field, name] of [
    ['fieldPosition', 'field-position'],
    ['turret', 'turret'],
    ['pitch', 'pitch'],
    ['dish', 'dish'],
    ['recoil', 'recoil'],
  ]) {
    const node = clone.getObjectByName(name);
    if (node) clone.userData[field] = node;
  }
  return clone;
}
function pair(roots) {
  return {
    actual: new VehicleBatch(new T.Scene()),
    reference: new VehicleBatch(new T.Scene()),
    a: new Map(roots.map((r) => [r.userData.groundId, r])),
    b: new Map(roots.map((r) => [r.userData.groundId, cloneProxy(r)])),
  };
}
function compare(p) {
  assert.deepEqual([...p.actual.groups.keys()].sort(), [...p.reference.groups.keys()].sort());
  for (const [key, group] of p.actual.groups) {
    const ref = p.reference.groups.get(key);
    assert.equal(group.count, ref.count);
    assert.deepEqual(
      group.mesh.instanceMatrix.array.slice(0, group.count * 16),
      ref.mesh.instanceMatrix.array.slice(0, ref.count * 16),
    );
    assert.deepEqual(group.mesh.instanceMatrix.updateRanges, ref.mesh.instanceMatrix.updateRanges);
    assert.equal(group.mesh.instanceMatrix.version, ref.mesh.instanceMatrix.version);
    assert.deepEqual(group.mesh.boundingBox, ref.mesh.boundingBox);
    assert.deepEqual(group.mesh.boundingSphere, ref.mesh.boundingSphere);
  }
}
function syncPair(p, camera = null, include = null) {
  // The reference always executes the pre-existing generic expansion/writer.
  for (const root of p.b.values())
    root.traverse((m) => {
      if (m.isInstancedMesh) m.userData.versionedDrive = false;
    });
  p.actual.sync(p.a, camera, include);
  p.reference.sync(p.b, camera, include);
  compare(p);
}
function both(p, id, fn) {
  fn(p.a.get(id));
  fn(p.b.get(id));
}
function countReads(p) {
  let reads = 0;
  for (const root of p.a.values())
    root.traverse((m) => {
      if (!m.isInstancedMesh) return;
      const get = m.getMatrixAt;
      m.getMatrixAt = function (...args) {
        reads++;
        return get.apply(this, args);
      };
    });
  return {
    get: () => reads,
    reset: () => {
      reads = 0;
    },
  };
}
function seedBounds(p) {
  for (const batch of [p.actual, p.reference])
    for (const group of batch.groups.values()) {
      group.mesh.boundingSphere = new T.Sphere(new T.Vector3(), 10);
      group.mesh.boundingBox = new T.Box3(new T.Vector3(-1, -1, -1), new T.Vector3(1, 1, 1));
    }
}

test('generic untagged proxies still expose raw setMatrixAt writes without needsUpdate', () => {
  const p = pair([source(1, 2, false)]);
  syncPair(p);
  both(p, 1, (root) => instance(root).setMatrixAt(0, new T.Matrix4().makeTranslation(17, 0, 0)));
  syncPair(p);
  assert.equal([...p.actual.groups.values()][0].mesh.instanceMatrix.array[12], 17);
});

test('tagged slots preserve exact transforms, source replacements, counts, Float32 dirtiness and picking', () => {
  const p = pair([source(1, 3, true, 5)]),
    reads = countReads(p);
  both(p, 1, (r) => {
    r.position.x = 1000;
  });
  syncPair(p);
  reads.reset();
  seedBounds(p);
  syncPair(p);
  assert.equal(reads.get(), 0);
  both(p, 1, (r) => {
    r.position.x += 1e-12;
  });
  const version = [...p.actual.groups.values()][0].mesh.instanceMatrix.version;
  syncPair(p);
  assert.equal(
    reads.get(),
    3,
    'exact world changes must fall through even below Float32 resolution',
  );
  assert.equal([...p.actual.groups.values()][0].mesh.instanceMatrix.version, version);
  assert.ok([...p.actual.groups.values()][0].mesh.boundingSphere);
  for (const mutate of [
    (r) => {
      r.children[0].rotation.y = 0.35;
    },
    (r) => {
      const m = instance(r);
      m.setMatrixAt(1, new T.Matrix4().makeTranslation(5, 1, 0));
      m.instanceMatrix.needsUpdate = true;
    },
    (r) => {
      const m = instance(r),
        old = m.instanceMatrix;
      m.instanceMatrix = old.clone();
      m.instanceMatrix.version = old.version;
      m.instanceMatrix.array[12] += 1;
    },
    (r) => {
      const m = instance(r);
      m.instanceMatrix.array = m.instanceMatrix.array.slice();
      m.instanceMatrix.array[12] += 2;
    },
    (r) => {
      instance(r).count = 2;
    },
    (r) => {
      instance(r).count = 5;
    },
  ]) {
    both(p, 1, mutate);
    seedBounds(p);
    syncPair(p);
  }
  for (const batch of [p.actual, p.reference])
    for (const group of batch.groups.values())
      group.mesh.instanceMatrix = new T.InstancedBufferAttribute(
        new Float32Array(group.mesh.instanceMatrix.array.length),
        16,
      );
  syncPair(p);
  const local = new T.Matrix4(),
    mesh = instance(p.a.get(1));
  mesh.getMatrixAt(0, local);
  const center = new T.Vector3().setFromMatrixPosition(
    new T.Matrix4().multiplyMatrices(mesh.matrixWorld, local),
  );
  const ray = new T.Raycaster(center.clone().add(new T.Vector3(0, 0, 20)), new T.Vector3(0, 0, -1));
  const hits = (root) => ray.intersectObject(root, true).map((h) => [h.instanceId, h.distance]);
  assert.deepEqual(hits(p.a.get(1)), hits(p.b.get(1)));
  assert.ok(hits(p.a.get(1)).length > 0);
});

test('packed offsets, reordering, visibility gaps, camera reentry and group growth match uncached buffers', () => {
  const p = pair([source(1, 2), source(2, 2)]);
  both(p, 2, (r) => {
    r.position.x = 20;
  });
  syncPair(p);
  syncPair(p);
  // Root 1 disappears; root 2 overwrites its old slot. Returning root 1 must rewrite it.
  both(p, 1, (r) => {
    r.visible = false;
  });
  syncPair(p);
  both(p, 1, (r) => {
    r.visible = true;
  });
  syncPair(p);
  both(p, 1, (r) => {
    r.children[0].visible = false;
  });
  syncPair(p);
  both(p, 1, (r) => {
    r.children[0].visible = true;
  });
  syncPair(p);
  p.a = new Map([...p.a].reverse());
  p.b = new Map([...p.b].reverse());
  syncPair(p);
  syncPair(p, null, (root) => root.userData.groundId !== 1);
  syncPair(p);
  both(p, 2, (r) => {
    r.position.x = 200;
  });
  const camera = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 30);
  camera.lookAt(0, 0, 0);
  syncPair(p, camera);
  assert.equal(p.actual.visibleEntities, 1);
  camera.position.x = 200;
  camera.lookAt(200, 0, 0);
  syncPair(p, camera);
  assert.equal(p.actual.visibleEntities, 1);
  camera.position.x = 0;
  camera.lookAt(0, 0, 0);
  syncPair(p, camera);
  assert.equal(p.actual.visibleEntities, 1);
  const large = source(3, 300);
  p.a.set(3, large);
  p.b.set(3, large.clone(true));
  syncPair(p);
  assert.ok([...p.actual.groups.values()][0].capacity >= 512);
  p.a.delete(3);
  p.b.delete(3);
  syncPair(p);
  assert.equal(p.actual.records.has(large), false);
});

function modelWorld() {
  return {
    scene: new T.Scene(),
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
}
test('94 real tracked models skip 10904 expansions while real drive, turret, recoil and dish animation stay identical', () => {
  const world = modelWorld(),
    units = [],
    roots = [];
  for (let i = 0; i < 94; i++) {
    const u = {
      id: i + 1,
      key: i % 2 ? 'shilka' : 'leopard',
      side: 0,
      level: 0,
      x: i * 20,
      z: 0,
      y: 1,
      yaw: 0,
      moving: false,
      setup: 1,
      hp: 100,
      maxHp: 100,
    };
    units.push(u);
    const root = groundModel(world, u);
    world.scene.add(root);
    animateGround(root, u, 0, 0);
    roots.push(root);
    for (const name of ['road-wheels', 'drive-spokes', 'track-links'])
      assert.equal(root.getObjectByName(name).userData.versionedDrive, true);
  }
  const p = pair(roots),
    reads = countReads(p),
    referenceReads = countReads({ a: p.b });
  syncPair(p);
  syncPair(p);
  reads.reset();
  referenceReads.reset();
  syncPair(p);
  assert.equal(reads.get(), 0);
  assert.equal(referenceReads.get(), 10904);
  assert.equal(
    [...p.reference.records.values()]
      .flat()
      .filter((r) => r.mesh.isInstancedMesh)
      .reduce((n, r) => n + r.mesh.count, 0),
    10904,
  );
  let bytes = 0;
  for (const parts of p.actual.records.values())
    for (const part of parts) if (part.stable) bytes += part.stable.world.byteLength;
  assert.equal(bytes, 94 * 3 * 16 * 8);
  for (const [time, dt, moving] of [
    [0.1, 0.1, true],
    [0.15, 0.05, true],
    [0.2, 0, false],
    [0.4, 0.2, false],
  ]) {
    for (const u of units) {
      Object.assign(u, { moving, targetX: u.x + 100, targetY: 20, targetZ: 50, lastFire: 0.1 });
      animateGround(p.a.get(u.id), u, time, dt);
      animateGround(p.b.get(u.id), u, time, dt);
    }
    syncPair(p);
  }
});

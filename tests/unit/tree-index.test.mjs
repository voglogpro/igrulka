import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as T from '../../vendor/three/three.module.js';
import { treesNear } from '../../src/rendering/performance/tree-index.js';
import { clearTrees } from '../../src/rendering/terrain/environment.js';

function forest(points) {
  const calls = [];
  const meshes = ['trunk', 'crown'].map((name) => {
    const matrix = new Float32Array(points.length * 16);
    for (let i = 0; i < points.length; i++)
      matrix.set(new T.Matrix4().makeTranslation(points[i].x, 2, points[i].z).elements, i * 16);
    return {
      name,
      matrix,
      instanceMatrix: {
        set needsUpdate(value) {
          calls.push(['upload', name, value]);
        },
      },
      setMatrixAt(index, transform) {
        calls.push(['matrix', name, index, [...transform.elements]]);
        matrix.set(transform.elements, index * 16);
      },
    };
  });
  return {
    calls,
    meshes,
    trees: points.map((p, index) => ({ ...p, index, meshes: meshes.slice(0, p.parts ?? 2) })),
    renderer: {
      shadowMap: {
        set needsUpdate(value) {
          calls.push(['shadow', value]);
        },
      },
    },
  };
}

// The previous full-forest algorithm is the behavioral reference, including
// strict Math.hypot comparison and update order, rather than a squared-distance rewrite.
function clearReference(x, z, radius) {
  if (!this.trees) return;
  let changed = false;
  for (const tree of this.trees)
    if (!tree.cleared && Math.hypot(x - tree.x, z - tree.z) < radius) {
      tree.cleared = true;
      for (const mesh of tree.meshes) {
        mesh.setMatrixAt(tree.index, new T.Matrix4().makeScale(0, 0, 0));
        mesh.instanceMatrix.needsUpdate = true;
      }
      changed = true;
    }
  if (changed && this.renderer) this.renderer.shadowMap.needsUpdate = true;
}

function equalForests(actual, expected) {
  assert.deepEqual(actual.calls, expected.calls);
  assert.deepEqual(
    actual.trees.map((tree) => tree.cleared),
    expected.trees.map((tree) => tree.cleared),
  );
  for (let i = 0; i < actual.meshes.length; i++)
    assert.deepEqual(
      Buffer.from(actual.meshes[i].matrix.buffer),
      Buffer.from(expected.meshes[i].matrix.buffer),
      'instance matrix bytes must match the full-forest implementation',
    );
}

test('indexed clearing retains strict circle boundary, source order, live flags and exact matrix/shadow updates', () => {
  const points = [
    { x: 64, z: 0 },
    { x: -64, z: -64 },
    { x: -61, z: -60 }, // Exactly radius 5 from (-64,-64): must remain.
    { x: -61, z: -60.000001 },
    { x: -64.001, z: -64, cleared: true },
    { x: 0, z: 0, parts: 1 },
    { x: -61, z: -59.999999 },
    { x: -64, z: -63, cleared: 0, parts: 0 },
    { x: 63.999, z: 0 },
    { x: -128, z: -128 },
  ];
  const indexed = forest(points);
  const reference = forest(points);
  for (const query of [
    [-64, -64, 5],
    [0, 0, 64],
    [-128, -128, 0.001],
    [0, 0, 500],
  ]) {
    clearTrees.call(indexed, ...query);
    clearReference.call(reference, ...query);
    equalForests(indexed, reference);
  }
  assert.equal(indexed.trees[2].cleared, true, 'later large clearance can remove a boundary tree');
  const firstMatrices = indexed.calls.filter((call) => call[0] === 'matrix').slice(0, 4);
  assert.deepEqual(
    firstMatrices.map((call) => [call[1], call[2]]),
    [
      ['trunk', 1],
      ['crown', 1],
      ['trunk', 3],
      ['crown', 3],
    ],
  );
});

test('negative cell edges and corner queries match the full forest across many deterministic clearances', () => {
  const points = [];
  for (let z = -5; z <= 5; z++)
    for (let x = -5; x <= 5; x++)
      points.unshift({ x: x * 64 + (z % 3) * 0.001, z: z * 64 - (x % 3) * 0.001 });
  const indexed = forest(points);
  const reference = forest(points);
  for (const query of [
    [-64, -64, 0.01],
    [-63.999, -128.001, 64],
    [0, 0, 90.51],
    [127.999, -192, 96],
    [-256.001, 255.999, 128],
    [0, 0, 1000],
  ]) {
    clearTrees.call(indexed, ...query);
    clearReference.call(reference, ...query);
    equalForests(indexed, reference);
  }
});

test('quiet repeat does not upload matrices or shadows; externally changed cleared flags remain live', () => {
  const world = forest([
    { x: 0, z: 0 },
    { x: 64, z: 64 },
  ]);
  clearTrees.call(world, 0, 0, 5);
  const calls = world.calls.length;
  for (let i = 0; i < 15; i++) clearTrees.call(world, 0, 0, 5);
  assert.equal(world.calls.length, calls);
  world.trees[0].cleared = false;
  clearTrees.call(world, 0, 0, 5);
  assert.equal(world.calls.length, calls * 2);
  assert.equal(world.trees[1].cleared, undefined);
  clearTrees.call({}, 0, 0, 5);
  clearTrees.call({ trees: [] }, 0, 0, 5);
});

test('replacement and append rebuild derived indices without leaking between worlds', () => {
  const first = forest([{ x: -200, z: -200 }]);
  const second = forest([{ x: 100, z: 100 }]);
  assert.deepEqual(treesNear(first, -200, -200, 5), first.trees);
  assert.deepEqual(treesNear(second, 100, 100, 5), second.trees);
  const previous = first.trees[0];
  first.trees = [{ x: 800, z: 800, index: 0, meshes: first.meshes }];
  clearTrees.call(first, 800, 800, 5);
  assert.equal(first.trees[0].cleared, true);
  assert.equal(previous.cleared, undefined);
  first.trees.push({ x: -500, z: 500, index: 0, meshes: first.meshes });
  clearTrees.call(first, -500, 500, 5);
  assert.equal(first.trees[1].cleared, true);
  assert.equal(second.trees[0].cleared, undefined);
  clearTrees.call(second, 100, 100, 5);
  assert.equal(second.trees[0].cleared, true);
});

test('huge and nonfinite query bounds terminate and preserve full-scan clearing semantics', () => {
  // An unsafe integer bucket must not enter a loop whose ix++ cannot advance.
  // Isolate this guard so a regression fails with a timeout instead of hanging QA.
  const moduleURL = new URL('../../src/rendering/terrain/environment.js', import.meta.url).href;
  const script = `import assert from 'node:assert/strict';
    import {clearTrees} from ${JSON.stringify(moduleURL)};
    const queries = [[1e20,0,1], [0,-1e308,1], [1e308,1e308,1e308],
      [0,0,Infinity], [Infinity,0,Infinity], [NaN,0,4], [0,0,NaN], [0,0,-1], [0,0,0]];
    const points = [[0,0], [-64,-64], [1e20,0], [Infinity,0], [NaN,0]];
    for(const [x,z,radius] of queries) {
      const trees = points.map(([x,z]) => ({x,z,meshes:[]}));
      clearTrees.call({trees},x,z,radius);
      assert.deepEqual(trees.map(t=>!!t.cleared), points.map(([tx,tz])=>Math.hypot(x-tx,z-tz)<radius));
    }
    console.log('bounds-ok');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    timeout: 10000,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /bounds-ok/);
});

test('fifteen local road clearances read only local coordinates after one 50000-tree index build', (t) => {
  let indexedReads = 0;
  let referenceReads = 0;
  const makeTrees = (read) =>
    Array.from({ length: 50000 }, (_, index) => {
      const x = (index % 250) * 16 - 2000;
      const z = Math.floor(index / 250) * 16 - 1600;
      return {
        index,
        meshes: [],
        get x() {
          read();
          return x;
        },
        get z() {
          read();
          return z;
        },
      };
    });
  const indexed = { trees: makeTrees(() => indexedReads++) };
  const reference = { trees: makeTrees(() => referenceReads++) };
  treesNear(indexed, 0, 0, 1);
  assert.equal(indexedReads, 100000, 'one initial build reads each static coordinate once');
  indexedReads = 0;
  for (let step = 0; step < 15; step++) {
    const query = [-112 + step * 16, 8, 12];
    clearTrees.call(indexed, ...query);
    clearReference.call(reference, ...query);
  }
  assert.deepEqual(
    indexed.trees.map((tree) => tree.cleared),
    reference.trees.map((tree) => tree.cleared),
  );
  assert.ok(indexedReads < 2000, `local coordinate reads: ${indexedReads}`);
  assert.ok(
    indexedReads * 100 < referenceReads,
    `indexed ${indexedReads} versus full-scan ${referenceReads}`,
  );
  t.diagnostic(
    `15 local clearances: ${indexedReads} indexed coordinate reads vs ${referenceReads} full-scan reads`,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { AmmoCrateView } from '../../src/rendering/terrain/ammo-crates.js';
import { ammoCrateInspectorHTML } from '../../src/ui/ammo-crate.js';
import * as E from '../../src/game/index.js';

test('field crates share five bounded draws, stable IDs and matrices without reading private stocks', () => {
  const scene = new T.Scene(),
    view = new AmmoCrateView(scene),
    s = {
      ammoCrates: Array.from({ length: 32 }, (_, i) => ({
        id: i + 1,
        side: i % 4,
        hp: 100,
        maxHp: 100,
        x: i * 15,
        z: 0,
      })),
    };
  for (const c of s.ammoCrates)
    Object.defineProperty(c, 'stock', {
      get() {
        throw Error('renderer must not inspect stock');
      },
    });
  view.sync(s);
  assert.equal(view.diagnostics().crates, 32);
  assert.equal(view.diagnostics().draws, 5);
  const versions = view.meshes.map((m) => m.instanceMatrix.version);
  for (let i = 0; i < 10; i++) view.sync(s);
  assert.deepEqual(
    view.meshes.map((m) => m.instanceMatrix.version),
    versions,
  );
  scene.updateMatrixWorld(true);
  assert.equal(view.pick(new T.Raycaster(new T.Vector3(0, 50, 0), new T.Vector3(0, -1, 0))), 1);
  s.ammoCrates[0].hp = 0;
  view.sync(s);
  assert.equal(view.ids[0], 2);
  assert.equal(view.diagnostics().crates, 31);
  view.dispose();
  view.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(view.diagnostics().disposed, true);
});

test('a crate on a road clears asphalt and returns to ground after road removal', () => {
  const view = new AmmoCrateView(new T.Scene()),
    s = {
      networkRevision: 1,
      ammoCrates: [{ id: 1, side: 0, hp: 100, x: 0, z: 0 }],
      roads: [{ ax: -10, az: 0, bx: 10, bz: 0, hp: 100 }],
    };
  const matrix = new T.Matrix4();
  view.sync(s);
  view.meshes[0].getMatrixAt(0, matrix);
  assert.ok(matrix.elements[13] - 1.4 > 0.55);
  s.roads = [];
  s.networkRevision++;
  view.sync(s);
  view.meshes[0].getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[13] - 1.5) < 1e-6);
  view.dispose();
});

test('new crates remain pickable after a first ray cached bounds without any buffer growth', () => {
  const scene = new T.Scene(),
    view = new AmmoCrateView(scene),
    s = { ammoCrates: [{ id: 1, side: 0, hp: 100, x: 0, z: 0 }] };
  view.sync(s);
  scene.updateMatrixWorld(true);
  assert.equal(view.pick(new T.Raycaster(new T.Vector3(0, 50, 0), new T.Vector3(0, -1, 0))), 1);
  const original = view.meshes[0];
  assert.ok(original.boundingSphere);
  s.ammoCrates.push({ id: 2, side: 0, hp: 100, x: 400, z: 0 });
  view.sync(s);
  scene.updateMatrixWorld(true);
  assert.equal(view.meshes[0], original);
  assert.equal(view.diagnostics().capacity, 32);
  assert.equal(view.pick(new T.Raycaster(new T.Vector3(400, 50, 0), new T.Vector3(0, -1, 0))), 2);
  view.dispose();
});

test('eighty crates grow shared instance buffers, keep late IDs pickable and never reallocate on shrink', () => {
  const scene = new T.Scene(),
    view = new AmmoCrateView(scene),
    oldMeshes = [...view.meshes];
  let disposed = 0;
  for (const m of oldMeshes) m.addEventListener('dispose', () => disposed++);
  const s = {
    ammoCrates: Array.from({ length: 80 }, (_, i) => ({
      id: i + 1,
      side: i % 4,
      hp: 100,
      x: i * 15,
      z: 0,
    })),
  };
  view.sync(s);
  assert.equal(disposed, 5);
  assert.ok(oldMeshes.every((m) => m.parent === null));
  assert.equal(view.diagnostics().capacity, 128);
  assert.equal(view.diagnostics().crates, 80);
  assert.equal(view.diagnostics().draws, 5);
  assert.equal(view.meshes[0].geometry, oldMeshes[0].geometry);
  assert.equal(view.meshes[0].material, oldMeshes[0].material);
  scene.updateMatrixWorld(true);
  assert.equal(
    view.pick(new T.Raycaster(new T.Vector3(79 * 15, 50, 0), new T.Vector3(0, -1, 0))),
    80,
  );
  const grown = [...view.meshes];
  s.ammoCrates = s.ammoCrates.slice(0, 3);
  view.sync(s);
  for (let i = 0; i < 10; i++) view.sync(s);
  assert.deepEqual(view.meshes, grown);
  assert.equal(view.diagnostics().capacity, 128);
  assert.equal(view.diagnostics().crates, 3);
  assert.equal(scene.children.length, 5);
  view.dispose();
});

test('crate inspector exposes own stock but never reads or prints foreign stock', () => {
  const s = E.createGame(811),
    own = {
      id: s.nextId++,
      key: 'ammo-crate',
      side: 0,
      x: -900,
      z: 0,
      hp: 100,
      maxHp: 100,
      stock: { small: 17, shell: 5, rocket: 2, sam: 1 },
    };
  s.ammoCrates = [own];
  assert.match(ammoCrateInspectorHTML(s, own), /17 \/ /);
  const enemy = { ...own, id: own.id + 1, side: 1 };
  Object.defineProperty(enemy, 'stock', {
    get() {
      throw Error('private');
    },
  });
  const html = ammoCrateInspectorHTML(s, enemy);
  assert.match(html, /Запас противника/);
  assert.match(html, /100 \/ 100/);
  assert.doesNotMatch(html, /17 \/|Патроны|Снаряды/);
});

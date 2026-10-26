import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { FortificationView } from '../../src/rendering/defense/fortifications.js';
import { FrontlineView } from '../../src/rendering/defense/frontline-view.js';

test('fortifications use bounded shared batches, advance stages and remove stale instances', () => {
  const scene = new T.Scene();
  const view = new FortificationView(scene, { visible: (_, t) => t.side === 0 });
  const state = {
    trenches: [
      { id: 1, side: 0, x: 0, z: 0, progress: 0.4 },
      { id: 2, side: 0, x: 10, z: 0, progress: 1, fortificationWork: 30 },
      { id: 3, side: 0, x: 20, z: 0, progress: 1, fortificationWork: 90 },
      { id: 4, side: 1, x: 30, z: 0, progress: 1, fortificationWork: 90 },
    ],
  };
  const resources = view.pools.map((p) => [p.geometry, p.material, p.instanceMatrix.array]);
  assert.equal(view.sync(state), true);
  assert.deepEqual(view.diagnostics().stages, [3, 2, 1]);
  assert.equal(view.sync(state), false);
  for (let i = 0; i < 20; i++) {
    state.trenches[0].progress += 0.01;
    view.sync(state);
  }
  assert.equal(scene.children.length, 6);
  resources.forEach(([geometry, material, matrices], i) => {
    assert.equal(view.pools[i].geometry, geometry);
    assert.equal(view.pools[i].material, material);
    assert.equal(view.pools[i].instanceMatrix.array, matrices);
  });
  state.trenches = Array.from({ length: 300 }, (_, i) => ({
    id: i + 10,
    side: 0,
    x: i,
    z: 0,
    progress: 1,
    fortificationWork: 90,
  }));
  view.sync(state);
  assert.deepEqual(view.diagnostics().stages, [240, 240, 240]);
  assert.equal(view.models.has(1), false);
  state.trenches = [];
  view.sync(state);
  assert.equal(view.models.size, 0);
  assert.ok(view.pools.every((p) => p.count === 0));
  let disposed = 0;
  for (const p of view.pools) p.geometry.addEventListener('dispose', () => disposed++);
  view.dispose();
  assert.equal(disposed, 3);
  assert.equal(scene.children.length, 0);
});

test('frontline distinguishes observations from estimates, respects hiding and reuses fixed buffers', () => {
  const scene = new T.Scene();
  const view = new FrontlineView(scene, () => 2);
  const solidArray = view.solid.geometry.attributes.position.array;
  const makeReport = (offset = 0) => ({
    sectors: Array.from({ length: 5 }, (_, i) => ({
      pressure: i === 4 ? 2 : 0.5,
      knowledge: i < 2 ? 'observed' : 'estimated',
    })),
    polyline: Array.from({ length: 5 }, (_, i) => ({
      x: offset + i * 10,
      z: i * 200,
      knowledge: i < 2 ? 'observed' : 'estimated',
    })),
  });
  view.update(makeReport());
  assert.equal(view.solid.geometry.drawRange.count, 24);
  assert.equal(view.estimated.geometry.drawRange.count, 72);
  assert.equal(view.diagnostics().segments, 48);
  view.setVisible(false);
  view.update(makeReport(50));
  assert.equal(view.solid.visible, false);
  assert.equal(view.estimated.visible, false);
  assert.equal(view.solid.geometry.attributes.position.array, solidArray);
  assert.equal(solidArray[0], 50);
  assert.ok(Math.abs(solidArray[1] - 2.9) < 0.00001);
  view.setVisible(true);
  assert.equal(view.solid.visible, true);
  view.update(null);
  assert.equal(view.diagnostics().segments, 0);
  view.dispose();
  assert.equal(scene.children.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import * as E from '../../src/game/index.js';
import { frontlineSegments } from '../../src/rendering/defense/frontline-segments.js';
import { FrontlineView } from '../../src/rendering/defense/frontline-view.js';

test('world and minimap share two independent shore-to-edge segments, hidden until enabled', () => {
  const s = E.createGame(88),
    report = E.frontlineReport(s, 0);
  const segments = frontlineSegments(report);
  assert.equal(segments.length, 2);
  for (const { a, b, sector } of segments) {
    assert.equal(a.sectorId, b.sectorId);
    assert.equal(sector.id, a.sectorId);
    assert.ok(a.z * b.z > 0, 'never connect across the sea');
  }
  const scene = new T.Scene(),
    view = new FrontlineView(scene, E.groundHeight);
  assert.equal(view.enabled, false);
  assert.equal(view.solid.visible, false);
  view.update(report);
  assert.equal(view.segments, 24);
  assert.equal(view.estimated.visible, false);
  const geometry = view.estimated.geometry;
  view.setVisible(true);
  view.update(report);
  assert.equal(view.estimated.visible, true);
  assert.equal(view.estimated.geometry, geometry, 'toggling reuses the fixed pool');
  view.dispose();
  assert.equal(scene.children.length, 0);
});

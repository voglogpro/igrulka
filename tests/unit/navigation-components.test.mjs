import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

function wall() {
  const s = E.createGame(8112);
  for (let x = -E.FIELD.x - 20; x <= E.FIELD.x + 20; x += 18)
    s.buildings.push({
      id: s.nextId++,
      side: 1,
      key: 'radar',
      x,
      z: -1080,
      hp: 100,
      maxHp: 100,
      progress: 1,
    });
  s.networkRevision++;
  return s;
}

test('disconnected mask queries stop before A*; ruins stay blocked and demolition reconnects the same field', () => {
  const s = wall();
  const a = { x: -1100, z: -100 },
    b = { x: -420, z: -1360 };
  for (const radius of [1.5, 2.52, 3, 6, 9]) assert.deepEqual(E.groundPath(s, a, b, radius), []);
  for (const building of s.buildings) if (building.key === 'radar') building.hp = 0;
  s.networkRevision++;
  assert.deepEqual(E.groundPath(s, a, b, 2.52), [], 'ruins remain physical obstacles');
  for (const building of s.buildings)
    if (building.key === 'radar' && Math.abs(building.x - a.x) < 50) building.demolished = true;
  s.networkRevision++;
  const route = E.groundPath(s, a, b, 2.52);
  assert.ok(route.length > 1, 'a newly cleared passage invalidates the component cache');
  assert.deepEqual(route.at(-1), b);
});

test('component pruning preserves local direct routes and valid corner detours', () => {
  const s = E.createGame(8112);
  const a = { x: -1100, z: -300 },
    b = { x: -1060, z: -320 };
  assert.deepEqual(E.groundPath(s, a, b), [b]);
  s.buildings.push({
    id: s.nextId++,
    side: 0,
    key: 'housing',
    x: -1200,
    z: -500,
    hp: 100,
    maxHp: 100,
    progress: 1,
  });
  s.networkRevision++;
  const from = { x: -1240, z: -540 },
    to = { x: -1160, z: -460 },
    radius = 3;
  const route = E.groundPath(s, from, to, radius);
  assert.ok(route.length > 1);
  assert.deepEqual(route.at(-1), to);
  let previous = from;
  for (const p of route) {
    const steps = Math.ceil(Math.hypot(p.x - previous.x, p.z - previous.z) / 3);
    for (let i = 0; i <= steps; i++) {
      const t = i / (steps || 1);
      assert.ok(
        E.walkable(
          s,
          previous.x + (p.x - previous.x) * t,
          previous.z + (p.z - previous.z) * t,
          radius,
        ),
      );
    }
    previous = p;
  }
});

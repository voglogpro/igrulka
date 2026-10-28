import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { coverInfo } from '../../src/game/units/infantry/cover.js';
import { guardGround } from '../../src/game/units/ground/guard.js';
import { commandUnits } from '../../src/game/units/ground/orders.js';
import {
  availableTrenchSlots,
  persistentDefensePoint,
  trenchContested,
} from '../../src/game/defense/positions.js';
import {
  prepareDefensivePosition,
  updateFortification,
} from '../../src/game/defense/fortifications.js';
import { invalidateStaticGeometry } from '../../src/game/shared/static-spatial.js';
import { invalidateTrenchLinks } from '../../src/game/defense/trench-links.js';
import {
  trenchRenderPieces,
  trenchLinkCoverFactor,
  trenchContains,
} from '../../src/game/defense/trench-footprint.js';

function fresh() {
  const s = E.createGame(8131);
  s.mode = 'multiplayer';
  s.groundUnits = [];
  s.trenches = [];
  for (const f of s.sides) {
    f.credits = 1e6;
    f.materials = 1e5;
  }
  return s;
}
function trench(s, extra = {}) {
  const t = {
    id: s.nextId++,
    side: 0,
    x: -1100,
    z: -100,
    yaw: 0,
    progress: 1,
    fortificationWork: 90,
    ...extra,
  };
  s.trenches.push(t);
  invalidateStaticGeometry(s, 'trenches');
  invalidateTrenchLinks(s);
  return t;
}
function troop(s, x = -1100, z = -130, side = 0) {
  const u = E.makeGround(s, side, 'infantry', x, z);
  s.groundUnits.push(u);
  return u;
}
function at(t, along, across = 0) {
  return {
    x: t.x + Math.cos(t.yaw) * along + Math.sin(t.yaw) * across,
    z: t.z - Math.sin(t.yaw) * along + Math.cos(t.yaw) * across,
  };
}

test('actual cover follows both ends and thin sides of the rotated 18m capsule', () => {
  for (const yaw of [0, Math.PI / 2, 0.73]) {
    const s = fresh(),
      t = trench(s, { yaw });
    for (const [along, across, inside] of [
      [8.9, 0, true],
      [-8.9, 0, true],
      [6, 2.1, true],
      [-6, -2.1, true],
      [0, 2.3, false],
      [9.1, 0, false],
      [8.8, 1.5, false],
    ]) {
      const p = { key: 'infantry', ...at(t, along, across) };
      assert.equal(coverInfo(s, p).cover === 0.82, inside, JSON.stringify({ yaw, along, across }));
    }
  }
});

test('three current slots reserve before arrival, free on death/departure, and remain stable', () => {
  const s = fresh(),
    t = trench(s),
    units = [];
  for (let i = 0; i < 3; i++) {
    const u = troop(s, -1100, -140 - i * 10),
      p = persistentDefensePoint(s, u, t);
    assert.ok(trenchContains(t, p.x, p.z));
    u.guard = p;
    units.push(u);
  }
  assert.equal(new Set(units.map((u) => u.guard.x + ':' + u.guard.z)).size, 3);
  const spare = troop(s, -1100, -180);
  assert.equal(availableTrenchSlots(s, spare, t).length, 0);
  assert.equal(
    persistentDefensePoint(s, spare, t),
    null,
    'a fourth defender cannot reserve an occupied place',
  );
  for (const u of units) assert.deepEqual(persistentDefensePoint(s, u, t), u.guard);
  const old = { ...units[1].guard };
  units[1].hp = 0;
  assert.deepEqual(persistentDefensePoint(s, spare, t), old);
  spare.guard = old;
  units[0].guard = null;
  units[0].x = -1200;
  units[0].z = -200;
  assert.equal(availableTrenchSlots(s, units[2], t).length, 2);
});

test('manual real guard orders occupy three physical places and a replacement uses the casualty slot', () => {
  const s = fresh(),
    t = trench(s),
    units = [troop(s, -1106, -125), troop(s, -1100, -125), troop(s, -1094, -125)];
  assert.equal(
    guardGround(
      s,
      0,
      units.map((u) => u.id),
      t,
    ),
    3,
  );
  for (const u of units) assert.ok(trenchContains(t, u.guard.x, u.guard.z));
  assert.equal(new Set(units.map((u) => u.guard.x + ':' + u.guard.z)).size, 3);
  const lost = { ...units[1].guard };
  units[1].hp = 0;
  const replacement = troop(s, -1100, -130);
  assert.equal(guardGround(s, 0, [replacement.id], t), 1);
  assert.deepEqual(replacement.guard, lost);
});

test('physical and observed contested tests use capsule edges without revealing unseen enemies', () => {
  const s = fresh(),
    t = trench(s),
    enemy = troop(s, t.x + 8.8, t.z, 1);
  assert.equal(trenchContested(s, t, 0), true);
  assert.equal(trenchContested(s, t, 0, null, true), false);
  s.frontlineMemory[0].seen.push({ id: enemy.id, x: enemy.x, z: enemy.z, time: s.time });
  assert.equal(trenchContested(s, t, 0, null, true), true);
  enemy.z = t.z + 3;
  s.frontlineMemory[0].seen[0].z = enemy.z;
  assert.equal(trenchContested(s, t, 0), false);
  assert.equal(trenchContested(s, t, 0, null, true), false);
});

test('edge digging reuses ownership/work, contested trenches never create duplicates', () => {
  const s = fresh(),
    t = trench(s, { side: 1 }),
    u = troop(s, t.x + 8, t.z),
    enemy = troop(s, t.x - 8, t.z, 1);
  u.guard = { x: u.x, z: u.z };
  assert.equal(prepareDefensivePosition(s, u), null);
  assert.equal(s.trenches.length, 1);
  enemy.hp = 0;
  updateFortification(s, u, 0.05);
  assert.equal(u.trenchId, t.id);
  assert.equal(t.side, 0);
  assert.equal(t.fortificationWork, 90);
  assert.equal(commandUnits(s, 0, [u.id], 'dig'), 1);
  assert.equal(s.trenches.length, 1);
  assert.equal(u.trenchId, t.id);
});

test('same-time geometry invalidation updates cover and defensive-position caches for move/rotation', () => {
  const s = fresh(),
    t = trench(s),
    u = troop(s, t.x + 8, t.z);
  u.guard = { x: u.x, z: u.z };
  assert.equal(coverInfo(s, u).cover, 0.82);
  assert.equal(prepareDefensivePosition(s, u), t);
  t.yaw = Math.PI / 2;
  invalidateStaticGeometry(s, 'trenches');
  invalidateTrenchLinks(s);
  assert.notEqual(coverInfo(s, u).cover, 0.82);
  t.x += 200;
  invalidateStaticGeometry(s, 'trenches');
  invalidateTrenchLinks(s);
  assert.notEqual(coverInfo(s, u).cover, 0.82);
  const next = prepareDefensivePosition(s, u);
  assert.notEqual(next, t);
  assert.equal(s.trenches.length, 2);
});

test('shared link sections use full cover; low walkways use narrow reduced cover only', () => {
  const s = fresh(),
    a = trench(s, { z: -150 }),
    b = trench(s, { z: -70 });
  const pieces = trenchRenderPieces(a, b),
    full = pieces.find((p) => !p.narrow),
    narrow = pieces.find((p) => p.narrow);
  assert.ok(full && narrow);
  assert.equal(trenchRenderPieces(a, b), pieces, 'stable endpoints reuse layout array');
  const check = (piece, across, factor) => {
    const x = a.x + across,
      z = a.z + (piece.from + piece.to) / 2;
    assert.equal(trenchLinkCoverFactor(a, b, x, z), factor);
    const baseline = coverInfo(fresh(), { key: 'infantry', x, z });
    const actual = coverInfo(s, { key: 'infantry', x, z });
    assert.equal(actual.cover, Math.max(baseline.cover, 0.82 * factor));
    assert.equal(actual.concealment, Math.max(baseline.concealment, 0.65 * factor));
  };
  check(full, 2.1, 1);
  check(full, 2.3, 0);
  check(narrow, 0.98, 0.45);
  check(narrow, 1.01, 0);
  check(narrow, 2.1, 0);
  a.yaw = 0.5;
  assert.notEqual(trenchRenderPieces(a, b), pieces, 'rotation refreshes derived layout');
  const rotated = trenchRenderPieces(a, b);
  b.x += 1;
  assert.notEqual(trenchRenderPieces(a, b), rotated, 'movement refreshes derived layout');
});

test('allied city guards share physical slots without ownership transfer', () => {
  const s = fresh();
  s.sides.push({ ...s.sides[0] }, { ...s.sides[1] });
  const t = trench(s, { side: 2 }),
    ally = troop(s, t.x, t.z, 2);
  ally.guard = { x: t.x, z: t.z };
  const u = troop(s, t.x - 6, t.z);
  u.guard = { x: u.x, z: u.z };
  assert.equal(availableTrenchSlots(s, u, t).length, 2);
  assert.equal(prepareDefensivePosition(s, u), t);
  assert.equal(t.side, 2);
});

test('save/reconnect derives the same free slots without any slot ledger', () => {
  const s = fresh(),
    t = trench(s, { yaw: 0.5 }),
    u = troop(s),
    ally = troop(s);
  ally.guard = { x: t.x, z: t.z };
  ally.x = t.x;
  ally.z = t.z;
  const before = availableTrenchSlots(s, u, t);
  const restored = E.load(E.save(s)),
    rt = restored.trenches.find((v) => v.id === t.id),
    ru = restored.groundUnits.find((v) => v.id === u.id);
  assert.deepEqual(availableTrenchSlots(restored, ru, rt), before);
  assert.deepEqual(Object.keys(rt).sort(), Object.keys(t).sort());
  assert.equal(rt.fortificationWork, 90);
  assert.equal(rt.side, 0);
});

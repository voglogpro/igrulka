import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  updateGuard,
  guardMetrics,
  GUARD_PATHS_PER_STEP,
} from '../../src/game/units/ground/guard.js';
import { hostile } from '../../src/game/factions.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function referenceThreat(s, u) {
  const posts = s.groundUnits.filter(
    (v) => v.side === u.side && v.hp > 0 && v.guard && distance(v.guard, u.guard) <= 68,
  );
  return s.groundUnits
    .filter(
      (v) =>
        hostile(s, v.side, u.side) &&
        v.hp > 0 &&
        !v.carrierId &&
        distance(v, u.guard) <= 145 &&
        E.groundVisible(s, u.side, v) &&
        (distance(v, u.guard) <= 95 ||
          posts.some((p) => p.id !== u.id && distance(v, p.guard) <= 55)) &&
        E.lineOfSight(s, u, v),
    )
    .sort((a, b) => distance(a, u.guard) - distance(b, u.guard) || a.id - b.id)[0];
}

test('guard threat choice keeps the nearest visible target, assistance range and ID ties', () => {
  const s = E.createGame(8111, { mode: 'coop' });
  const guard = E.makeGround(s, 0, 'infantry', -1200, -320);
  guard.guard = { x: guard.x, z: guard.z };
  const assist = E.makeGround(s, 0, 'infantry', -1140, -320);
  assist.guard = { x: assist.x, z: assist.z };
  s.groundUnits.push(guard, assist);
  for (let i = 0; i < 120; i++) {
    const angle = i * 2.399963229728653;
    const range = 45 + (i % 8) * 15;
    s.groundUnits.push(
      E.makeGround(
        s,
        i % 6 === 0 ? 2 : 1,
        i % 3 === 0 ? 'infantry' : 'apc',
        guard.x + Math.cos(angle) * range,
        guard.z + Math.sin(angle) * range,
      ),
    );
  }
  // Re-evaluate after deaths, movement, allies and transport occupancy changes.
  for (let pass = 0; pass < 24; pass++) {
    s.time += 0.5;
    guard.guardNextThink = 0;
    const expected = referenceThreat(s, guard);
    updateGuard(s, guard);
    assert.equal(guard.guardTargetId ?? null, expected?.id ?? null);
    if (expected) {
      if (pass % 2) expected.hp = 0;
      else expected.carrierId = assist.id;
    }
  }
});

test('guard skips terrain rays for farther visible enemies once its nearest threat is found', () => {
  const s = E.createGame(8112);
  const guard = E.makeGround(s, 0, 'infantry', -1300, -300);
  guard.guard = { x: guard.x, z: guard.z };
  s.groundUnits.push(guard);
  for (let i = 0; i < 90; i++)
    s.groundUnits.push(E.makeGround(s, 1, 'apc', guard.x + 20 + i * 0.5, guard.z));
  let reads = 0;
  const wall = {
    id: s.nextId++,
    side: 0,
    key: 'housing',
    get x() {
      reads++;
      return guard.x + 55;
    },
    z: guard.z + 45,
    hp: 100,
    maxHp: 100,
    progress: 1,
  };
  s.buildings.push(wall);
  // Populate the static centre index before measuring per-guard sight work.
  E.lineOfSight(s, guard, s.groundUnits[1]);
  reads = 0;
  updateGuard(s, guard);
  assert.equal(guard.guardTargetId, s.groundUnits[1].id);
  assert.ok(reads < 10, `one guard must not cast ninety city/terrain rays: ${reads}`);
});

test('500 defenders never rescan the whole army for peaceful or remote enemy checks', () => {
  for (const remote of [0, 100]) {
    const s = E.createGame(812),
      guards = [];
    s.mode = 'multiplayer';
    for (let i = 0; i < 500; i++) {
      const u = E.makeGround(
        s,
        0,
        'infantry',
        -1750 + (i % 20) * 24,
        -850 + Math.floor(i / 20) * 24,
      );
      u.guard = { x: u.x, z: u.z };
      u.order = { ...u.guard, mode: 'guard' };
      guards.push(u);
      s.groundUnits.push(u);
    }
    for (let i = 0; i < remote; i++)
      s.groundUnits.push(
        E.makeGround(s, 1, 'infantry', 1000 + (i % 10) * 10, -500 + Math.floor(i / 10) * 10),
      );
    let reads = 0;
    s.groundUnits = new Proxy(s.groundUnits, {
      get(array, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(array, key, receiver);
      },
    });
    for (let pass = 0; pass < 2; pass++) {
      reads = 0;
      for (const u of guards) updateGuard(s, u);
      const metrics = guardMetrics(s);
      assert.ok(reads <= s.groundUnits.length * 3, `full-army read storm: ${reads}`);
      assert.equal(metrics.enemyChecks, 0, 'remote cells and friendly troops are not candidates');
      assert.equal(metrics.postChecks, 0);
      assert.equal(metrics.visibilityTests, 0);
      assert.equal(metrics.paths, 0);
      assert.ok(guards.every((u) => u.guardTargetId == null));
      s.time += 0.5;
    }
  }
});

test('assistance follows the same-city assigned post rather than a moving ally body or co-op ally', () => {
  const s = E.createGame(812, { mode: 'coop' }),
    u = E.makeGround(s, 0, 'infantry', -1000, 250),
    assist = E.makeGround(s, 0, 'infantry', -1500, 250),
    ally = E.makeGround(s, 2, 'infantry', -940, 250),
    enemy = E.makeGround(s, 1, 'apc', -890, 250);
  u.guard = { x: u.x, z: u.z };
  assist.guard = { x: -940, z: 250 };
  ally.guard = { x: -940, z: 250 };
  s.groundUnits.push(u, assist, ally, enemy);
  assert.ok(E.lineOfSight(s, u, enemy));
  updateGuard(s, u);
  assert.equal(u.guardTargetId, enemy.id, 'the distant body still lends its nearby assigned post');
  assist.hp = 0;
  s.time += 0.5;
  updateGuard(s, u);
  assert.equal(u.guardTargetId, null, 'the other co-op city does not lend a private guard post');
  assist.hp = assist.maxHp;
  assist.x = -940;
  assist.guard = { x: -1500, z: 250 };
  s.time += 0.5;
  updateGuard(s, u);
  assert.equal(u.guardTargetId, null, 'a close body cannot extend the assigned post leash');
});

test('guard compatibility retains equal-distance ID ties and unfinished live troop records', () => {
  const s = E.createGame(812),
    u = E.makeGround(s, 0, 'infantry', -1000, 250),
    first = E.makeGround(s, 1, 'apc', -950, 250),
    second = E.makeGround(s, 1, 'apc', -1050, 250);
  u.guard = { x: u.x, z: u.z };
  first.progress = 0.5;
  s.groundUnits.push(second, u, first);
  assert.ok(E.lineOfSight(s, u, first));
  assert.ok(E.lineOfSight(s, u, second));
  updateGuard(s, u);
  assert.equal(u.guardTargetId, first.id, 'same Math.hypot distance must break ties by ID');
});

test('mass guard intercepts and return retries share two searches with city fairness', () => {
  const s = E.createGame(812, { mode: 'coop' }),
    groups = [[], []];
  s.mode = 'multiplayer';
  for (let group = 0; group < 2; group++) {
    const side = group * 2,
      x = group ? 1280 : -1280,
      z = group ? 300 : -300;
    for (let i = 0; i < 60; i++) {
      const u = E.makeGround(s, side, 'infantry', x, z);
      u.guard = { x, z };
      u.order = { x, z, mode: 'guard' };
      groups[group].push(u);
      s.groundUnits.push(u);
    }
    s.groundUnits.push(E.makeGround(s, side + 1, 'apc', x + (group ? -94 : 94), z));
  }
  for (let step = 0; step < 80; step++) {
    s.time += 0.05;
    for (const group of groups) for (const u of group) updateGuard(s, u);
    const metrics = guardMetrics(s);
    if (metrics) {
      assert.ok(metrics.paths <= GUARD_PATHS_PER_STEP);
      assert.ok((metrics.bySide[0] || 0) <= 1);
      assert.ok((metrics.bySide[2] || 0) <= 1);
    }
  }
  assert.ok(groups.flat().every((u) => u.order.mode === 'guardIntercept' && u.path.length));
  for (const u of s.groundUnits) if ([1, 3].includes(u.side)) u.hp = 0;
  for (const u of groups.flat()) {
    u.x += 25;
    u.path = [];
  }
  for (let step = 0; step < 100; step++) {
    s.time += 0.05;
    for (const group of groups) for (const u of group) updateGuard(s, u);
    const metrics = guardMetrics(s);
    if (metrics) assert.ok(metrics.paths <= GUARD_PATHS_PER_STEP);
  }
  assert.ok(groups.flat().every((u) => u.order.mode === 'guard' && u.path.length));
});

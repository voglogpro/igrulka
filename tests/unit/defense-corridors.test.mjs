import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { corridorGeometry } from '../../src/game/defense/geometry.js';
import { updateArmyAI } from '../../src/game/ai/army-ai.js';
import { playerView } from '../../src/network/perspective.js';

function fresh(seed = 881) {
  const s = E.createGame(seed);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 1e5;
    f.materials = 1e4;
    f.rearAuto = false;
  }
  return s;
}
function unit(s, side, key, x, z, auto = true) {
  const u = E.makeGround(s, side, key, x, z);
  u.holdFire = true;
  u.guard = { x, z };
  u.order = { x, z, mode: 'guard' };
  u.autoDefense = auto;
  s.groundUnits.push(u);
  return u;
}
function army(s, side, count = 20) {
  return Array.from({ length: count }, (_, i) =>
    unit(s, side, 'infantry', side ? 900 : -900, (i - count / 2) * 5),
  );
}
function ownDistricts(s, side) {
  for (const line of corridorGeometry(s, side))
    s.districts.find((d) => d.id === line.districtId).owner = side;
}

test('two independent terrain lines stay still when troops move, and change only with public territorial control', () => {
  const s = fresh(),
    u = unit(s, 0, 'infantry', -900, 0, false);
  const initial = structuredClone(E.frontlineReport(s, 0));
  assert.equal(initial.lines.length, 2);
  assert.equal(initial.sectors.length, 2);
  assert.equal(initial.polyline.filter((p) => p.breakBefore).length, 1);
  assert.equal(E.orderGround(s, 0, [u.id], { x: -1100, z: 0 }), 1);
  E.advance(s, 5);
  assert.deepEqual(E.frontlineReport(s, 0).polyline, initial.polyline);
  const hidden = unit(s, 1, 'leopard', 1100, 0, false);
  E.advance(s, 1.1);
  hidden.x = 1300;
  hidden.z = 100;
  E.advance(s, 1.1);
  assert.deepEqual(E.frontlineReport(s, 0).polyline, initial.polyline);
  ownDistricts(s, 0);
  E.advance(s, 1.1);
  const advanced = E.frontlineReport(s, 0);
  assert.ok(advanced.lines.every((line) => line.points.every((p) => p.x > -E.FRONTLINE.homeLineX)));
  assert.ok(advanced.posts.every((p) => E.walkable(s, p.x, p.z, 12)));
  assert.ok(advanced.sectors.every((v) => v.enemy === 0 && v.knowledge === 'unknown'));
});

test('twelve real volunteers capture both depots, retain inner garrisons and report remaining outer gaps', () => {
  for (const side of [0, 1]) {
    const s = fresh(),
      troops = army(s, side, 12),
      initial = troops.map((u) => ({ x: u.x, z: u.z }));
    E.step(s, 0.05);
    assert.ok(troops.filter((u) => u.defensePost).length <= 2);
    troops.forEach((u, i) =>
      assert.ok(
        Math.hypot(u.x - initial[i].x, u.z - initial[i].z) <=
          E.GROUND_UNITS[u.key].speed * 0.05 + 1e-6,
      ),
    );
    E.advance(s, 210);
    const report = E.frontlineReport(s, side);
    for (const line of corridorGeometry(s, side))
      assert.equal(s.districts.find((d) => d.id === line.districtId).owner, side);
    assert.equal(
      s.districts.filter((d) => d.owner === side).length,
      2,
      'the far enemy-side resource site is not a hidden economic target',
    );
    assert.equal(new Set(troops.map((u) => `${u.guard.x},${u.guard.z}`)).size, 12);
    assert.ok(troops.every((u) => !u.path.length && !u.defenseCapture));
    for (const sector of report.sectors) {
      assert.equal(sector.coverage.weak, true);
      const positions = troops.filter((u) => u.defensePost.corridorId === sector.id);
      const depot = E.DISTRICTS.find((d) => d.id === `${sector.id}-depot`);
      const inner = positions.filter(
        (u) => u.defensePost.row === 2 && Math.hypot(u.x - depot.x, u.z - depot.z) < depot.radius,
      );
      const outer = positions.filter((u) => u.defensePost.row === 0);
      assert.ok(inner.length >= 2, 'capturing sections must remain as the physical depot garrison');
      assert.ok(outer.length > 0 && outer.length < 6);
      assert.equal(sector.coverage.arrived, outer.length);
      assert.ok(sector.coverage.maxGap > 80);
    }
    for (const u of troops) assert.ok(E.walkable(s, u.x, u.z, E.GROUND_UNITS[u.key].size * 0.42));
  }
});

test('a small force spreads to distant flank posts and explicitly reports incomplete coverage', () => {
  const s = fresh();
  ownDistricts(s, 0);
  const troops = army(s, 0, 4);
  E.advance(s, 140);
  const report = E.frontlineReport(s, 0);
  for (const sector of report.sectors) {
    const assigned = troops.filter((u) => u.defensePost.corridorId === sector.id);
    assert.equal(assigned.length, 2);
    assert.ok(Math.abs(assigned[0].guard.z - assigned[1].guard.z) > 300);
    assert.equal(sector.coverage.weak, true);
    assert.equal(sector.coverage.occupied, 2);
  }
});

test('an explicit automatic recruit whose initial local guard failed leaves idle base, while a manual stop remains pinned', () => {
  const s = fresh(),
    waiting = unit(s, 0, 'infantry', -900, 50),
    stopped = unit(s, 0, 'infantry', -910, 60);
  waiting.guard = null;
  waiting.order = null;
  assert.equal(E.commandUnits(s, 0, [stopped.id], 'stop'), 1);
  const initial = { x: waiting.x, z: waiting.z };
  E.step(s, 0.05);
  assert.ok(waiting.defensePost && waiting.guard && waiting.path.length > 0);
  assert.ok(
    Math.hypot(waiting.x - initial.x, waiting.z - initial.z) <=
      E.GROUND_UNITS.infantry.speed * 0.05 + 1e-6,
  );
  E.advance(s, 3);
  assert.ok(Math.hypot(waiting.x - initial.x, waiting.z - initial.z) > 20);
  assert.equal(stopped.autoDefense, false);
  assert.equal(stopped.guard, null);
  assert.equal(stopped.order, null);
  assert.equal(stopped.x, -910);
  assert.equal(stopped.z, 60);
});

test('the shore endpoint touches actual water at the line x and a real coastal bypass crosses the covered dry barrier', () => {
  for (const side of [0, 1]) {
    const s = fresh();
    ownDistricts(s, side);
    for (const line of corridorGeometry(s, side)) {
      const sign = line.id === 'north' ? -1 : 1,
        shore = line.points[0];
      assert.ok(
        E.isWater(line.x, shore.z - sign * 20),
        'the endpoint is attached to this coastline, not the sea centre',
      );
      assert.ok(line.slots.every((p) => E.walkable(s, p.x, p.z, 12)));
      const start = { x: 500, z: shore.z - sign * 100 },
        end = { x: -900, z: shore.z - sign * 100 };
      const path = E.groundPath(s, start, end, 1);
      assert.ok(path.length > 0);
      let previous = start,
        crossings = 0;
      for (const point of path) {
        if ((previous.x - line.x) * (point.x - line.x) <= 0 && previous.x !== point.x) {
          const t = (line.x - previous.x) / (point.x - previous.x),
            z = previous.z + (point.z - previous.z) * t;
          assert.ok(
            Math.min(...line.slots.map((p) => Math.abs(p.z - z))) <=
              E.GROUND_UNITS.infantry.groundRange,
            'the actual route cannot slip between the coast and the nearest firing post',
          );
          crossings++;
        }
        previous = point;
      }
      assert.ok(crossings > 0);
    }
  }
});

test('a real casualty opens a primary slot and a spare infantry unit physically fills it without moving the neighbours', () => {
  const s = fresh();
  ownDistricts(s, 0);
  const troops = army(s, 0, 20);
  E.advance(s, 170);
  const fallen = troops.find((u) => u.defensePost?.row === 0),
    reference = { ...fallen.defensePost };
  const neighbours = troops
    .filter((u) => u.defensePost?.row === 0 && u !== fallen)
    .map((u) => ({ id: u.id, guard: { ...u.guard } }));
  fallen.hp = 0;
  E.advance(s, 1.1);
  const replacement = s.groundUnits.find(
    (u) =>
      u.defensePost?.corridorId === reference.corridorId &&
      u.defensePost.slot === reference.slot &&
      u.defensePost.row === 0,
  );
  assert.ok(replacement);
  assert.notEqual(replacement.id, fallen.id);
  assert.ok(replacement.path.length > 0);
  E.advance(s, 35);
  assert.ok(
    Math.hypot(replacement.x - replacement.guard.x, replacement.z - replacement.guard.z) < 4,
  );
  for (const old of neighbours)
    assert.deepEqual(s.groundUnits.find((u) => u.id === old.id).guard, old.guard);
});

function breakthrough(side = 0) {
  const s = fresh();
  ownDistricts(s, side);
  const troops = army(s, side, 28);
  E.advance(s, 170);
  const target = E.frontlineReport(s, side).posts.find(
    (p) => p.corridorId === 'north' && p.slot === 2,
  );
  const enemies = Array.from({ length: 5 }, (_, i) =>
    unit(
      s,
      1 - side,
      'leopard',
      target.x + (side ? -1 : 1) * (65 + i * 8),
      target.z + i * 3,
      false,
    ),
  );
  assert.ok(
    enemies.some((u) => E.groundVisible(s, side, u)),
    'the breakthrough is actually observed',
  );
  return { s, troops, enemies, target };
}

test('five observed tanks receive staged reserves without stripping either primary line or teleporting the support', () => {
  const { s, troops } = breakthrough();
  const primary = troops
    .filter((u) => u.defensePost.row === 0)
    .map((u) => ({ id: u.id, guard: { ...u.guard } }));
  const positions = new Map(troops.map((u) => [u.id, { x: u.x, z: u.z }]));
  E.advance(s, 18);
  const tasks = troops.filter((u) => u.defenseTask);
  assert.ok(tasks.length >= 3 && tasks.length <= 6);
  const events = s.events.filter((e) => e.type === 'defenseRedeployed');
  assert.equal(events.length, tasks.length);
  for (let i = 1; i < events.length; i++)
    assert.ok(events[i].time - events[i - 1].time >= 3 - 1e-6);
  for (const previous of primary)
    assert.deepEqual(troops.find((u) => u.id === previous.id).guard, previous.guard);
  for (const u of tasks) {
    assert.ok(
      Math.hypot(u.x - positions.get(u.id).x, u.z - positions.get(u.id).z) <=
        E.GROUND_UNITS[u.key].speed * 18 + 1e-6,
    );
    assert.ok(u.defensePost.row > 0);
  }
  assert.equal(new Set(tasks.map((u) => `${u.guard.x},${u.guard.z}`)).size, tasks.length);
  assert.ok(E.frontlineReport(s, 0).sectors.every((v) => !v.coverage.weak));
});

test('reserve return, manual override, both owners, pause, game over and save/load preserve real defense journeys', () => {
  for (const side of [0, 1]) {
    const { s, troops, enemies } = breakthrough(side);
    E.advance(s, 8);
    const tasks = troops.filter((u) => u.defenseTask);
    assert.ok(tasks.length > 0);
    const overridden = tasks[0];
    assert.equal(E.commandUnits(s, side, [overridden.id], 'stop'), 1);
    assert.equal(overridden.autoDefense, false);
    assert.equal(overridden.defensePost, null);
    const loaded = E.load(E.save(s));
    assert.deepEqual(loaded.frontlineMemory, s.frontlineMemory);
    assert.deepEqual(loaded.groundUnits, s.groundUnits);
    const frozen = E.save(loaded);
    E.step(loaded, 0);
    E.step(loaded, NaN);
    for (let i = 0; i < 20; i++) E.frontlineReport(loaded, side);
    assert.equal(E.save(loaded), frozen);
    // Clear contacts by observed lethal damage rather than revealing hidden authority deaths.
    for (const enemy of enemies) {
      enemy.hp = 0;
    }
    E.advance(s, 110);
    assert.ok(troops.every((u) => !u.defenseTask));
    assert.equal(overridden.guard, null, 'the direct stop is never overwritten');
    const ended = structuredClone(s);
    ended.result = 'victory';
    const before = E.save(ended);
    E.advance(ended, 10);
    assert.equal(E.save(ended), before);
  }
});

test('defense persistence validates structural fields, whitelists extras and migrates old guards without consenting them', () => {
  const s = fresh();
  army(s, 0, 12);
  E.advance(s, 5);
  const raw = JSON.parse(E.save(s));
  const assigned = raw.groundUnits.find((u) => u.defensePost);
  assigned.defensePost.secret = 'ignored';
  assert.equal(
    E.load(JSON.stringify(raw)).groundUnits.find((u) => u.id === assigned.id).defensePost.secret,
    undefined,
  );
  for (const corrupt of [
    (v) => (v.groundUnits[0].defensePost.slot = 999),
    (v) => (v.groundUnits[0].defensePost.corridorId = 'constructor'),
    (v) => (v.groundUnits[0].defensePost.row = -1),
    (v) => (v.groundUnits[0].defenseCapture = { districtId: '__proto__', assignedAt: 0 }),
    (v) => (v.frontlineMemory[0].nextReinforce = 1e9),
  ]) {
    const copy = structuredClone(raw);
    corrupt(copy);
    assert.throws(() => E.load(JSON.stringify(copy)));
  }
  const old = structuredClone(raw);
  old.version = 13;
  for (const u of old.groundUnits) {
    u.autoDefense = false;
    delete u.defensePost;
    delete u.defenseCapture;
  }
  const migrated = E.load(JSON.stringify(old));
  assert.ok(migrated.groundUnits.every((u) => u.autoDefense === false && !u.defensePost));
});

test('solo AI commits all idle combat troops to the shared depot planner without changing its economic bonus', () => {
  const s = fresh();
  delete s.mode;
  s.time = E.difficultyOf(s).armyFrom + 1;
  s.ai.nextArmy = 0;
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextResearch = 1e9;
  const troops = Array.from({ length: 10 }, (_, i) => {
    const u = E.makeGround(s, 1, i < 3 ? 'machinegunner' : 'infantry', 900 + i * 6, 80);
    u.holdFire = true;
    s.groundUnits.push(u);
    return u;
  });
  const bonus = E.economy(s, 1).bonus;
  updateArmyAI(s, { random: E.random });
  assert.ok(troops.every((u) => u.autoDefense && u.stance?.mode === 'defend'));
  assert.ok(troops.every((u) => u.order?.mode !== 'attackmove'));
  const initial = new Map(troops.map((u) => [u.id, { x: u.x, z: u.z }]));
  E.advance(s, 2);
  assert.ok(
    troops.some(
      (u) =>
        u.defensePost &&
        u.guard &&
        Math.hypot(u.x - initial.get(u.id).x, u.z - initial.get(u.id).z) > 5,
    ),
  );
  assert.equal(E.economy(s, 1).bonus, bonus);
});

test('both network perspectives reproduce corridor geometry and hide foreign capture, post and reinforcement plans', () => {
  const s = fresh();
  army(s, 0, 14);
  army(s, 1, 14);
  E.advance(s, 5);
  const visible = [unit(s, 0, 'infantry', -900, -700), unit(s, 1, 'infantry', -850, -700)];
  for (const u of visible) {
    u.defensePost = { corridorId: 'north', slot: 0, row: 2 };
    u.defenseCapture = { districtId: 'north-depot', assignedAt: s.time };
  }
  for (const side of [0, 1]) {
    const report = E.frontlineReport(s, side),
      view = playerView(s, side),
      projected = E.frontlineReport(view, 0);
    assert.deepEqual(projected.lines, report.lines);
    assert.equal(projected.counts.capturing, report.counts.capturing);
    const own = view.groundUnits.filter((u) => u.side === 0);
    assert.ok(own.some((u) => u.defensePost));
    assert.ok(
      view.groundUnits.some((u) => u.id === visible[1 - side].id),
      'privacy is checked on an actually visible opponent',
    );
    for (const enemy of view.groundUnits.filter((u) => u.side === 1))
      for (const field of ['defensePost', 'defenseCapture', 'defenseTask', 'autoDefense'])
        assert.equal(Object.hasOwn(enemy, field), false);
    assert.deepEqual(view.frontlineMemory[1], { nextThink: 0, seen: [] });
  }
});

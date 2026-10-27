import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { COVER_PATCHES, coverInfo } from '../../src/game/units/infantry/cover.js';
import { damageGround } from '../../src/game/units/ground/combat.js';
import { recordThreat, updateGroundTactics } from '../../src/game/units/ground/tactics.js';
import { tacticalBudgetMetrics } from '../../src/game/units/ground/tactical-budget.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fresh(mode = 'multiplayer') {
  const s = E.createGame(812, { mode });
  s.rules.rear = false;
  s.rules.oil = false;
  return s;
}
function troop(s, side, key, p) {
  const u = E.makeGround(s, side, key, p.x, p.z);
  s.groundUnits.push(u);
  return u;
}
function guard(u) {
  u.autoDefense = true;
  u.guard = { x: u.x, z: u.z };
  u.order = { ...u.guard, mode: 'guard' };
  u.stance = { mode: 'defend', post: 'auto' };
  return u;
}
function tick(s, seconds = 0.05) {
  for (let elapsed = 0; elapsed < seconds - 1e-8; elapsed += 0.05) {
    // Keep strategic planning one legal cadence ahead to isolate an assigned
    // guard's combat reaction. Real targeting, shots, movement, damage, reload,
    // supplies, fortification and economy still run through E.step.
    for (const m of s.frontlineMemory) m.nextThink = s.time + E.FRONTLINE.cadence;
    E.step(s, 0.05);
  }
}
function clearing(s) {
  for (const p of COVER_PATCHES)
    for (const sign of [1, -1]) {
      const spot = { x: p.x + sign * (p.r + 14), z: p.z };
      const enemy = { x: spot.x + sign * 70, z: spot.z };
      if (
        p.forest &&
        E.walkable(s, spot.x, spot.z, 3) &&
        E.walkable(s, enemy.x, enemy.z, 3) &&
        coverInfo(s, { key: 'infantry', ...spot }).cover === 0 &&
        E.lineOfSight(s, { key: 'infantry', ...spot }, { key: 'infantry', ...enemy })
      )
        return { spot, enemy };
    }
  throw Error('No open firing line next to cover');
}
function firefight() {
  const s = fresh(),
    p = clearing(s);
  const u = guard(troop(s, 0, 'infantry', p.spot));
  const enemy = troop(s, 1, 'infantry', p.enemy);
  u.groundAmmo = 0;
  enemy.groundAmmo = 3;
  enemy.ammoReserve = 0;
  return { s, u, enemy };
}

test('an automatic rifleman physically reloads in nearby cover under actual fire and rejoins his unchanged post', () => {
  const { s, u, enemy } = firefight();
  const post = { ...u.guard },
    stance = { ...u.stance };
  const initialAmmo = u.groundAmmo + u.ammoReserve;
  tick(s, 1.5);
  assert.equal(u.order.mode, 'cover');
  assert.ok(
    distance(u, post) > 5,
    'a cover order must move the soldier through the actual movement loop',
  );
  assert.ok(u.hp < u.maxHp && u.hp > 0, 'a real enemy round hit the guard');
  assert.ok(s.events.some((e) => e.type === 'shot' && e.buildingId === enemy.id));
  assert.ok(coverInfo(s, u).cover >= 0.25);
  assert.deepEqual(u.guard, post);
  assert.deepEqual(u.stance, stance);
  damageGround(s, enemy, 1e9, undefined, 'blast');
  tick(s, 10);
  assert.ok(distance(u, post) <= 3);
  assert.equal(u.coverResume, null);
  assert.ok(['guard', 'guardReturn'].includes(u.order.mode));
  assert.deepEqual(u.guard, post);
  assert.deepEqual(u.stance, stance);
  assert.equal(
    u.groundAmmo + u.ammoReserve,
    initialAmmo,
    'reloading transfers a finite paid reserve',
  );
  assert.equal(u.ammoReserve, 0);
});

test('a quiet guard reloads on position instead of shuffling without a known threat', () => {
  const s = fresh(),
    u = guard(troop(s, 0, 'infantry', { x: -1100, z: -300 }));
  u.groundAmmo = 0;
  const post = { ...u.guard };
  tick(s, 4);
  assert.deepEqual({ x: u.x, z: u.z }, post);
  assert.notEqual(u.order?.mode, 'cover');
  assert.equal(u.groundAmmo, E.GROUND_UNITS.infantry.groundMagazine);
  assert.equal(u.ammoReserve, 0);
  assert.equal(tacticalBudgetMetrics(s).searches, 0);
});

test('a minimum-range vehicle backs out under actual close fire and can then answer with its existing weapon', () => {
  const s = fresh(),
    u = guard(troop(s, 0, 'howitzer', { x: -90, z: -1360 }));
  const enemy = troop(s, 1, 'infantry', { x: -30, z: -1360 });
  enemy.groundAmmo = 3;
  enemy.ammoReserve = 0;
  const post = { ...u.guard },
    initial = distance(u, enemy);
  tick(s, 2);
  assert.ok(u.hp < u.maxHp && u.hp > 0);
  assert.equal(u.order.mode, 'cover');
  assert.ok(distance(u, enemy) > initial + 15);
  assert.deepEqual(u.guard, post);
  tick(s, 5);
  assert.ok(
    s.events.some((e) => e.type === 'shot' && e.buildingId === u.id),
    'the gun can fire once it has regained standoff range',
  );
});

test('a howitzer keeps its recovered standoff while the known attacker still makes its old post unsafe', () => {
  const s = fresh(),
    u = guard(troop(s, 0, 'howitzer', { x: -90, z: -1360 }));
  const enemy = troop(s, 1, 'leopard', { x: -30, z: -1360 });
  enemy.groundAmmo = 1;
  enemy.ammoReserve = 0;
  const post = { ...u.guard };
  tick(s, 10);
  assert.ok(enemy.hp > 0 && enemy.hp < enemy.maxHp);
  assert.equal(u.order.mode, 'cover');
  assert.ok(distance(u, enemy) >= E.GROUND_UNITS.howitzer.groundMinRange);
  assert.ok(distance(u, post) > 15);
  assert.deepEqual(u.guard, post);
  damageGround(s, enemy, 1e9, undefined, 'blast');
  tick(s, 12);
  assert.ok(distance(u, post) <= 3);
});

test('a close-range vehicle also backs out when the remembered attacker occupies the same point', () => {
  const s = fresh(),
    u = guard(troop(s, 0, 'howitzer', { x: -1100, z: -300 }));
  recordThreat(s, u, u);
  updateGroundTactics(s, u, null);
  assert.equal(u.order?.mode, 'cover');
  assert.ok(distance(u.order, u.guard) > 20);
  assert.ok(u.order.x < u.x);
});

test('buddies retain the capture mission while only a minority temporarily leaves their firing posts', () => {
  const s = fresh(),
    units = [];
  s.trenches.push({ id: s.nextId++, side: 0, x: -75, z: -1360, progress: 1 });
  for (let i = 0; i < 3; i++) {
    const u = guard(troop(s, 0, 'infantry', { x: -50, z: -1366 + i * 6 }));
    u.defensePost = { corridorId: 'north', slot: 2, row: 0 };
    u.defenseCapture = { districtId: 'north-depot', assignedAt: 0 };
    u.suppression = 0.9;
    recordThreat(s, u, { x: 30, z: -1360 });
    units.push(u);
  }
  const posts = units.map((u) => ({ ...u.guard }));
  tick(s);
  assert.equal(units.filter((u) => u.order?.mode === 'cover').length, 1);
  for (const [i, u] of units.entries()) {
    assert.deepEqual(u.guard, posts[i]);
    assert.equal(u.defenseCapture.districtId, 'north-depot');
    assert.deepEqual(u.defensePost, { corridorId: 'north', slot: 2, row: 0 });
  }
  assert.ok(units.every((u) => Math.hypot(u.x, u.z + 1360) < 110));
});

test('accepted manual movement cancels the borrowed cover goal and never snaps back later', () => {
  const { s, u, enemy } = firefight();
  tick(s, 0.3);
  assert.equal(u.order.mode, 'cover');
  const goal = { x: u.x - 45, z: u.z, mode: 'move' };
  assert.equal(E.orderGround(s, 0, [u.id], goal), 1);
  damageGround(s, enemy, 1e9, undefined, 'blast');
  tick(s, 12);
  assert.equal(u.autoDefense, false);
  assert.equal(u.guard, null);
  assert.equal(u.coverResume, null);
  assert.equal(u.order.mode, 'move');
  assert.ok(distance(u, goal) < 4);
});

test('cover, reload and exact strategic intent survive save/load; paused and finished games do no tactical work', () => {
  const { s, u, enemy } = firefight();
  tick(s, 0.5);
  const loaded = E.load(E.save(s)),
    restored = loaded.groundUnits.find((v) => v.id === u.id);
  assert.deepEqual(restored.guard, u.guard);
  assert.deepEqual(restored.coverResume, u.coverResume);
  damageGround(s, enemy, 1e9, undefined, 'blast');
  damageGround(
    loaded,
    loaded.groundUnits.find((v) => v.id === enemy.id),
    1e9,
    undefined,
    'blast',
  );
  tick(s, 12);
  tick(loaded, 12);
  for (const key of [
    'x',
    'z',
    'hp',
    'groundAmmo',
    'ammoReserve',
    'order',
    'guard',
    'stance',
    'coverResume',
  ])
    assert.deepEqual(restored[key], u[key], key);
  for (const flag of ['paused', 'result']) {
    s[flag] = flag === 'paused' ? true : 'victory';
    u.suppression = 1;
    recordThreat(s, u, { x: u.x + 50, z: u.z });
    const before = structuredClone(u);
    updateGroundTactics(s, u, null);
    assert.deepEqual(u, before);
    s[flag] = flag === 'paused' ? false : null;
  }
});

test('support, supply trips, passenger transports, camouflage and explicit manual guards retain priority', () => {
  const s = fresh(),
    p = { x: -1100, z: -300 };
  const manual = guard(troop(s, 0, 'infantry', p));
  manual.autoDefense = false;
  const medic = guard(troop(s, 0, 'medic', { x: -1120, z: -300 }));
  const truck = guard(troop(s, 0, 'supplytruck', { x: -1140, z: -300 }));
  const carrier = guard(troop(s, 0, 'apc', { x: -1160, z: -300 }));
  const passenger = troop(s, 0, 'infantry', carrier);
  passenger.carrierId = carrier.id;
  const supplied = guard(troop(s, 0, 'infantry', { x: -1180, z: -300 }));
  supplied.supplyTrip = { crateId: 777, phase: 'outbound', home: { ...supplied.guard } };
  supplied.order = { x: -1200, z: -300, mode: 'resupply', supplyId: 777 };
  const concealed = guard(troop(s, 0, 'infantry', { x: -1220, z: -300 }));
  concealed.camouflaged = true;
  for (const u of [manual, medic, truck, carrier, supplied, concealed]) {
    u.hp *= 0.3;
    u.suppression = 1;
    recordThreat(s, u, { x: u.x + 30, z: u.z });
    const before = structuredClone(u);
    updateGroundTactics(s, u, null);
    assert.deepEqual(u, before, u.key);
  }
});

test('five hundred simultaneous reactions share two path searches and do not choose the same cover point', () => {
  const s = fresh(),
    { spot } = clearing(s),
    units = [];
  for (let i = 0; i < 500; i++) {
    const u = troop(s, 0, 'infantry', { x: spot.x, z: spot.z + (i % 5) * 0.1 });
    u.suppression = 0.9;
    recordThreat(s, u, { x: spot.x + 80, z: spot.z });
    units.push(u);
  }
  tick(s);
  const metrics = tacticalBudgetMetrics(s),
    active = units.filter((u) => u.order?.mode === 'cover');
  assert.equal(metrics.searches, 2);
  assert.equal(active.length, 2);
  assert.ok(distance(active[0].order, active[1].order) >= 6);
  assert.ok(units.slice(2).every((u) => u.order?.mode !== 'cover'));
});

test('four-city tactical budgets alternate owners without mixing or changing allied posts', () => {
  const s = fresh('coop'),
    units = [];
  for (let side = 0; side < 4; side++) {
    const u = guard(
      troop(s, side, 'infantry', { x: side % 2 ? 1000 : -1000, z: side < 2 ? -1360 : 1360 }),
    );
    u.hp *= 0.3;
    u.suppression = 0.9;
    recordThreat(s, u, { x: u.x + (side % 2 ? -70 : 70), z: u.z });
    units.push(u);
  }
  const posts = units.map((u) => ({ ...u.guard }));
  const reacted = new Set();
  for (let i = 0; i < 12; i++) {
    tick(s);
    const metrics = tacticalBudgetMetrics(s);
    assert.ok(metrics.searches <= 2);
    assert.ok(Object.values(metrics.bySide).every((count) => count <= 1));
    for (const [index, u] of units.entries()) {
      if (u.order?.mode === 'cover') reacted.add(u.side);
      assert.deepEqual(u.guard, posts[index]);
    }
  }
  assert.deepEqual([...reacted].sort(), [0, 1, 2, 3]);
});

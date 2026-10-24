import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateGroundTactics, recordThreat } from '../../src/game/units/ground/tactics.js';
import { coverInfo, COVER_PATCHES } from '../../src/game/units/infantry/cover.js';
import { moveUnits } from '../../src/game/units/aviation/flight.js';
import { fireDefenses } from '../../src/game/combat/air-defense.js';
import { economy } from '../../src/game/city/economy.js';
import { groundEngagement } from '../../src/game/units/ground/engagement.js';

function fresh() {
  const s = E.createGame(4242);
  s.mode = 'multiplayer';
  for (const f of s.sides) {
    f.credits = 1e6;
    f.materials = 1e6;
  }
  return s;
}
function unit(s, side, key, x, z) {
  const u = E.makeGround(s, side, key, x, z);
  s.groundUnits.push(u);
  return u;
}
// A patch with open walkable ground right next to it.
function patchWithClearing(s) {
  for (const p of COVER_PATCHES) {
    const spot = { x: p.x + p.r + 14, z: p.z };
    if (
      p.forest &&
      E.walkable(s, spot.x, spot.z, 1) &&
      E.walkable(s, p.x, p.z, 1) &&
      coverInfo(s, { key: 'infantry', ...spot }).cover === 0
    )
      return { patch: p, spot };
  }
  throw Error('no patch');
}

test('a suppressed idle rifleman in the open runs for nearby cover', () => {
  const s = fresh(),
    { patch, spot } = patchWithClearing(s),
    u = unit(s, 0, 'infantry', spot.x, spot.z);
  u.suppression = 0.8;
  recordThreat(s, u, { x: spot.x + 90, z: spot.z });
  updateGroundTactics(s, u, null);
  assert.equal(u.order?.mode, 'cover');
  assert.ok(u.path.length > 0);
  assert.ok(Math.hypot(u.order.x - patch.x, u.order.z - patch.z) < patch.r);
});

test('player orders and camouflage are never overridden by cover seeking', () => {
  const s = fresh(),
    { spot } = patchWithClearing(s),
    moving = unit(s, 0, 'infantry', spot.x, spot.z),
    hidden = unit(s, 0, 'infantry', spot.x, spot.z + 3);
  E.orderGround(s, 0, [moving.id], { x: spot.x + 60, z: spot.z });
  hidden.camouflaged = true;
  for (const u of [moving, hidden]) {
    u.suppression = 1;
    recordThreat(s, u, { x: spot.x + 90, z: spot.z });
    updateGroundTactics(s, u, null);
  }
  assert.equal(moving.order.mode, 'move');
  assert.equal(hidden.order, null);
});

test('an attack-move resumes once the soldier recovers in cover', () => {
  const s = fresh(),
    { spot } = patchWithClearing(s),
    u = unit(s, 0, 'infantry', spot.x, spot.z);
  E.orderGround(s, 0, [u.id], { x: spot.x + 120, z: spot.z, mode: 'attackmove' });
  u.suppression = 0.9;
  recordThreat(s, u, { x: spot.x + 90, z: spot.z });
  updateGroundTactics(s, u, null);
  assert.equal(u.order.mode, 'cover');
  assert.equal(u.coverResume.x, spot.x + 120);
  Object.assign(u, { x: u.order.x, z: u.order.z, path: [], suppression: 0 });
  s.time += 10;
  updateGroundTactics(s, u, null);
  s.time += 3;
  updateGroundTactics(s, u, null);
  assert.equal(u.order.mode, 'attackmove');
  assert.equal(u.coverResume, null);
});

test('a drone locked by air defence weaves off its route but still hits the target point', () => {
  const s = fresh();
  const base = {
    side: 1,
    key: 'drone',
    hp: 30,
    maxHp: 30,
    launched: true,
    delay: 0,
    startX: 700,
    startZ: 0,
    tx: -700,
    tz: 0,
    x: 700,
    y: 5,
    z: 0,
    total: 600,
    travelled: 0,
    phase: 0.4,
    status: 'flying',
  };
  const calm = { ...base, id: 1 },
    locked = { ...base, id: 2 };
  s.units = [calm, locked];
  let spread = 0;
  for (let i = 0; i < 200; i++) {
    s.time += 0.05;
    locked.threatAt = s.time;
    moveUnits(s, 0.05);
    spread = Math.max(spread, Math.abs(locked.z - calm.z));
  }
  assert.ok(spread > 3, `weave ${spread}`);
  locked.threatAt = -Infinity;
  for (let i = 0; i < 400 && locked.travelled < locked.total; i++) {
    s.time += 0.05;
    moveUnits(s, 0.05);
  }
  assert.ok(Math.hypot(locked.x - base.tx, locked.z - base.tz) < 1);
});

test('neighbouring air defence batteries split two simultaneous drones', () => {
  const s = fresh();
  s.buildings = s.buildings.filter((b) => b.key === 'hq');
  const guns = [-20, 20].map((x) => {
    const hp = E.BUILDINGS.gun.hp;
    const b = { id: s.nextId++, key: 'gun', side: 0, x, z: 300, hp, maxHp: hp, progress: 1 };
    s.buildings.push(b);
    return b;
  });
  const drone = (id, x) => ({
    id,
    side: 1,
    key: 'drone',
    hp: 30,
    maxHp: 30,
    launched: true,
    delay: 0,
    x,
    y: 40,
    z: 300,
    startX: x,
    startZ: 0,
    tx: x,
    tz: 400,
    total: 400,
    travelled: 300,
    status: 'flying',
  });
  s.units = [drone(9001, -10), drone(9002, 10)];
  const rates = [economy(s, 0), economy(s, 1)];
  fireDefenses(s, rates, 0.05);
  fireDefenses(s, rates, 0.05);
  assert.deepEqual(new Set(guns.map((g) => g.trackId)), new Set([9001, 9002]));
});

test('reaction fields survive a save round trip', () => {
  const s = fresh(),
    u = unit(s, 0, 'infantry', 0, 300);
  recordThreat(s, u, { x: 30, z: 300 });
  u.coverResume = { x: 10, z: 20, targetId: null };
  const loaded = E.load(E.save(s));
  const copy = loaded.groundUnits.find((v) => v.id === u.id);
  assert.equal(copy.threatX, 30);
  assert.equal(copy.coverResume.x, 10);
  u.coverResume = { x: 'bad' };
  assert.throws(() => E.load(E.save(s)));
});

test('riflemen finish a wounded enemy before an untouched one at the same range', () => {
  const s = fresh(),
    shooter = unit(s, 0, 'infantry', -900, 250),
    healthy = unit(s, 1, 'infantry', -840, 240),
    wounded = unit(s, 1, 'infantry', -840, 260);
  wounded.hp = wounded.maxHp * 0.3;
  for (const u of [healthy, wounded]) u.moving = true;
  const { target } = groundEngagement(s, shooter);
  assert.equal(target?.id, wounded.id);
});

test('an anti-tank team skips a tank already doomed by a missile in flight', () => {
  const s = fresh(),
    team = unit(s, 0, 'atgm', -900, 250),
    doomed = unit(s, 1, 'leopard', -730, 240),
    other = unit(s, 1, 'leopard', -730, 262);
  doomed.hp = 60;
  doomed.maxHp = other.maxHp;
  s.projectiles.push({
    id: s.nextId++,
    domain: 'ground',
    side: 0,
    source: 999,
    shooterKey: 'atgm',
    targetId: doomed.id,
    kind: 'shell',
    damage: 240,
  });
  const { target } = groundEngagement(s, team);
  assert.equal(target?.id, other.id);
});

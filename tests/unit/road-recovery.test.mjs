import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  roadRecoveryStatus,
  startRoadRecovery,
  setRoadRecoveryEnabled,
  cancelRoadRecovery,
  updateRoadRecovery,
  restoreRoadRecovery,
} from '../../src/game/city/road-recovery.js';
import { dirtyNetwork } from '../../src/game/city/road-network.js';

// Exact economy integration boundary: existing HQ income leaves the wallet
// before the same amount is paid into the one road contract.
function tick(s, dt) {
  const rates = s.sides.map((_, side) => E.economy(s, side, dt));
  for (let side = 0; side < s.sides.length; side++) {
    s.sides[side].credits = Math.max(0, s.sides[side].credits + rates[side].net * dt);
    s.sides[side].materials += rates[side].materials * dt;
  }
  s.time += dt;
  updateRoadRecovery(s, dt);
}
function lost(s, side = 0) {
  const r = s.roads.find((road) => road.side === side && road.camp);
  assert.equal(E.demolish(s, r.id, side), true);
  return r;
}
function paidCity() {
  const s = E.createGame(8133, { mode: 'multiplayer' });
  const trunk = E.buildRoad(s, 0, -1207, -45, -1207, -645);
  assert.equal(typeof trunk, 'object');
  for (const key of [
    'housing',
    'industry',
    'power',
    'barracks',
    'vehiclebase',
    'ammofactory',
    'factory',
    'housing',
    'industry',
    'power',
    'housing',
    'industry',
    'housing',
  ]) {
    let building;
    for (let retry = 0; retry < 30 && !building; retry++) {
      for (let z = -165; z >= -615 && !building; z -= 45)
        for (const x of [-1237, -1177]) {
          if (E.canPlace(s, key, x, z, 0)) continue;
          const result = E.build(s, 0, key, x, z);
          if (typeof result === 'object') {
            building = result;
            break;
          }
        }
      if (!building) E.advance(s, 20);
    }
    assert.ok(building, `ordinary paid ${key}`);
    E.advance(s, E.BUILDINGS[key].time + 1);
  }
  return { s, r: s.roads.find((road) => road.id === trunk.id) };
}

test('a real paid city reaches zero after losing its central road, then funds that road from existing HQ income', () => {
  const { s, r } = paidCity();
  const before = E.economy(s, 0);
  assert.equal(before.connected, 13);
  assert.ok(before.net > 0);
  E.demolish(s, r.id, 0);
  const severed = E.economy(s, 0);
  assert.equal(severed.connected, 0);
  assert.ok(severed.net < 0);
  E.advance(s, Math.ceil(s.sides[0].credits / -severed.net) + 10);
  assert.equal(s.sides[0].credits, 0);
  assert.equal(E.roadPreview(s, 0, r.ax, r.az, r.bx, r.bz).error, 'Недостаточно денег');
  assert.equal(s.sides[0].roadRecovery ?? null, null, 'no automatic rebuilding after demolition');
  assert.equal(startRoadRecovery(s, 0, r.id), true);
  const status = roadRecoveryStatus(s, 0);
  assert.equal(status.cost, 69);
  assert.ok(Math.abs(status.eta - 69 / 1.8) < 1e-9);
  assert.equal(E.economy(s, 0).connected, 0);
  let steps = 0;
  for (; steps < 800 && r.removed; steps++) tick(s, 0.05);
  assert.ok(steps >= 766 && steps <= 767);
  assert.equal(r.removed, false);
  assert.equal(r.hp, r.maxHp);
  assert.equal(s.sides[0].roadRecovery, null);
  assert.equal(E.economy(s, 0).connected, 13);
  assert.ok(E.economy(s, 0).net > 0);
  assert.equal(s.sides[0].credits, 0, 'the contractor never grants spending money');
  E.advance(s, 10);
  assert.ok(s.sides[0].credits > 0);
});

test('last fractional payment, pause and cancel never duplicate money or refund escrow', () => {
  const s = E.createGame(8133, { mode: 'multiplayer' }),
    r = lost(s);
  assert.equal(startRoadRecovery(s, 0, r.id), true);
  const full = roadRecoveryStatus(s, 0).cost;
  s.sides[0].roadRecovery.paid = full - 0.01;
  const unreserved = E.economy(
    { ...s, sides: s.sides.map((f) => ({ ...f, roadRecovery: null })) },
    0,
    0.1,
  );
  const reserved = E.economy(s, 0, 0.1);
  assert.ok(Math.abs((unreserved.gross - reserved.gross) * 0.1 - 0.01) < 1e-10);
  const wallet = s.sides[0].credits;
  tick(s, 0.1);
  assert.ok(Math.abs(s.sides[0].credits - (wallet + unreserved.net * 0.1 - 0.01)) < 1e-9);
  assert.equal(r.removed, false);
  E.demolish(s, r.id, 0);
  startRoadRecovery(s, 0, r.id);
  tick(s, 1);
  const paid = s.sides[0].roadRecovery.paid;
  assert.equal(setRoadRecoveryEnabled(s, 0, false), true);
  tick(s, 1);
  assert.equal(s.sides[0].roadRecovery.paid, paid);
  assert.equal(startRoadRecovery(s, 0, r.id), true);
  assert.equal(s.sides[0].roadRecovery.paid, paid);
  const balance = s.sides[0].credits;
  assert.equal(cancelRoadRecovery(s, 0), true);
  assert.equal(s.sides[0].credits, balance);
  assert.equal(s.sides[0].roadRecovery, null);
  startRoadRecovery(s, 0, r.id);
  assert.equal(s.sides[0].roadRecovery.paid, 0);
});

test('road ownership, lost HQ and one paid contract per city stay authoritative in coop', () => {
  const s = E.createGame(8133, { mode: 'coop' }),
    a = lost(s, 0),
    b = lost(s, 2);
  assert.equal(typeof startRoadRecovery(s, 0, b.id), 'string');
  assert.equal(startRoadRecovery(s, 0, a.id), true);
  assert.equal(startRoadRecovery(s, 2, b.id), true);
  tick(s, 1);
  assert.equal(s.sides[0].roadRecovery.paid, 1.8);
  assert.equal(s.sides[2].roadRecovery.paid, 1.8);
  const another = s.roads.find((r) => r.side === 0 && !r.removed);
  E.demolish(s, another.id, 0);
  assert.match(startRoadRecovery(s, 0, another.id), /Завершите текущий подряд/);
  s.buildings.find((v) => v.side === 0 && v.key === 'hq').hp = 0;
  tick(s, 1);
  assert.equal(s.sides[0].roadRecovery.paid, 1.8);
  assert.equal(s.sides[2].roadRecovery.paid, 3.6);
  assert.equal(roadRecoveryStatus(s, 0).status, 'blocked');
});

test('difficulty bonuses do not multiply the earmarked base HQ payment', () => {
  const s = E.createGame(8133, { difficulty: 'hard' }),
    r = lost(s, 1);
  const baseline = E.economy(s, 1).gross;
  startRoadRecovery(s, 1, r.id);
  assert.ok(Math.abs(E.economy(s, 1).gross - (baseline - 1.8)) < 1e-10);
  tick(s, 1);
  assert.equal(s.sides[1].roadRecovery.paid, 1.8);
});

test('current damage determines the bill and new damage does not retain the old cheap quote', () => {
  const s = E.createGame(8133, { mode: 'multiplayer' }),
    r = s.roads[0];
  r.hp = 30;
  dirtyNetwork(s);
  startRoadRecovery(s, 0, r.id);
  assert.equal(roadRecoveryStatus(s, 0).cost, 50);
  tick(s, 1);
  r.hp = 0;
  dirtyNetwork(s);
  assert.equal(roadRecoveryStatus(s, 0).cost, 66);
  assert.equal(s.sides[0].roadRecovery.paid, 1.8);
  tick(s, 1);
  assert.equal(r.hp, 0);
});

test('an ordinary paid replacement closes the old contract without duplicate geometry or cash', () => {
  const s = E.createGame(8133, { mode: 'multiplayer' }),
    r = lost(s);
  startRoadRecovery(s, 0, r.id);
  tick(s, 1);
  const replacement = E.buildRoad(s, 0, r.ax, r.az, r.bx, r.bz);
  assert.equal(typeof replacement, 'object');
  const count = s.roads.length,
    balance = s.sides[0].credits;
  updateRoadRecovery(s, 1);
  assert.equal(s.roads.length, count);
  assert.equal(s.sides[0].credits, balance);
  assert.equal(r.removed, true);
  assert.equal(s.sides[0].roadRecovery, null);
  assert.equal(typeof startRoadRecovery(s, 0, r.id), 'string');
});

test('partial overlaps block funding, and blocked contracts can be canceled without a refund', () => {
  const s = E.createGame(8133, { mode: 'multiplayer' }),
    r = lost(s);
  startRoadRecovery(s, 0, r.id);
  tick(s, 1);
  assert.equal(
    typeof E.buildRoad(s, 0, r.ax, r.az, (r.ax + r.bx) / 2, (r.az + r.bz) / 2),
    'object',
  );
  const paid = s.sides[0].roadRecovery.paid;
  assert.equal(roadRecoveryStatus(s, 0).status, 'blocked');
  tick(s, 1);
  assert.equal(s.sides[0].roadRecovery.paid, paid);
  const balance = s.sides[0].credits;
  cancelRoadRecovery(s, 0);
  assert.equal(s.sides[0].credits, balance);
  assert.equal(r.removed, true);
});

test('restoration validates modern contracts and discards absent legacy contracts', () => {
  const s = E.createGame(8133, { mode: 'coop' }),
    r = lost(s);
  startRoadRecovery(s, 0, r.id);
  tick(s, 1);
  const restored = structuredClone(s);
  restoreRoadRecovery(restored, 22);
  assert.deepEqual(restored.sides[0].roadRecovery, s.sides[0].roadRecovery);
  for (const bad of [null, '1', -1, 1e9, NaN]) {
    const copy = structuredClone(s);
    copy.sides[0].roadRecovery.paid = bad;
    assert.throws(() => restoreRoadRecovery(copy, 22), /подряд/);
  }
  const foreign = structuredClone(s);
  foreign.sides[0].roadRecovery.id = s.roads.find((road) => road.side === 2).id;
  assert.throws(() => restoreRoadRecovery(foreign, 22), /подряд/);
  const legacy = structuredClone(s);
  restoreRoadRecovery(legacy, 21);
  assert.equal(legacy.sides[0].roadRecovery, null);
});

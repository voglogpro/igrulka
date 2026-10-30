import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../../src/game/index.js';
import { expandLegacyX, expandV23X } from '../../src/game/map.js';
import { pointOnRoute } from '../../src/game/units/aviation/routes.js';
import { moveUnits } from '../../src/game/units/aviation/flight.js';
const fixture = () =>
  JSON.parse(readFileSync(new URL('../fixtures/campaign-88.json', import.meta.url), 'utf8'));

test('actual exported 8.8 city migrates facilities, paid work, health and explicit garrison once', () => {
  const before = fixture();
  const s = E.load(JSON.stringify(before));
  assert.equal(before.version, 14);
  assert.equal(s.version, E.VERSION);
  assert.equal(s.buildings[0].x, -E.HQ_X);
  assert.equal(s.buildings[1].x, E.HQ_X);
  const lab = before.buildings.find((b) => b.key === 'lab');
  assert.equal(s.buildings.find((b) => b.id === lab.id).demolished, true);
  assert.equal(
    s.sides[0].credits,
    before.sides[0].credits + Math.round(E.BUILDINGS.lab.cost * 0.5) + E.TECH.heavy.cost,
  );
  assert.equal(
    s.sides[0].materials,
    before.sides[0].materials + Math.round(E.BUILDINGS.lab.metal * 0.5),
  );
  assert.equal(s.sides[0].science, 0);
  assert.deepEqual(s.sides[0].tech, []);
  assert.deepEqual(s.sides[0].armyComposition.targets, { infantry: 12 });
  for (const old of before.buildings.filter((b) => b.key !== 'lab')) {
    const current = s.buildings.find((b) => b.id === old.id);
    assert.equal(current.x, expandV23X(expandLegacyX(old.x)));
    assert.equal(current.z, old.z);
    assert.deepEqual(current.queue, old.queue);
    assert.deepEqual(current.armyQueue, old.armyQueue);
  }
  const oldTank = before.groundUnits.find((u) => u.key === 'leopard');
  const tank = s.groundUnits.find((u) => u.id === oldTank.id);
  assert.equal(tank.maxHp, E.GROUND_UNITS.leopard.hp);
  assert.ok(Math.abs(tank.hp / tank.maxHp - oldTank.hp / oldTank.maxHp) < 1e-12);
  const again = E.load(E.save(s));
  assert.equal(
    again.networkRevision,
    s.networkRevision + 1,
    'route cache revision changes on load',
  );
  const { networkRevision: _beforeRevision, ...stableBefore } = s;
  const { networkRevision: _afterRevision, ...stableAfter } = again;
  assert.deepEqual(stableAfter, stableBefore, 'no repeated expansion, refunds or queue changes');
  const barracks = s.buildings.find((b) => b.key === 'barracks');
  const queued = barracks.armyQueue[0].key;
  E.setArmyTarget(s, 0, 'infantry', 0);
  E.advance(s, 100);
  assert.ok(
    s.groundUnits.some((u) => u.key === queued && u.id !== oldTank.id),
    'old paid barracks armour completes without buying a new base',
  );
});

test('actual v14 airborne missile and merchant route stay continuous through sea widening', () => {
  const before = fixture();
  const s = E.load(JSON.stringify(before));
  const u = s.units[0];
  assert.deepEqual(pointOnRoute(u.route, u.travelled), { x: u.x, z: u.z });
  const anchor = { x: u.x, z: u.z, y: u.y };
  moveUnits(s, 1 / 30);
  assert.ok(Math.hypot(u.x - anchor.x, u.z - anchor.z) <= E.WEAPONS[u.key].speed / 30 + 0.01);
  assert.ok(Math.abs(u.y - anchor.y) < 5);
  assert.ok(s.ships.length > 0);
  const quay = E.quayOf(s.buildings.find((b) => b.key === 'port'));
  assert.equal(Math.abs(quay.x), E.ISLAND.quay);
  for (const ship of s.ships) {
    assert.ok(E.seaDistance(ship.x, ship.z) < 0);
    for (const p of ship.path) assert.ok(E.seaDistance(p.x, p.z) < 0);
    if (ship.state === 'outbound') assert.equal(Math.abs(ship.path.at(-1).x), E.ISLAND.quay);
  }
});

test('legacy docked and returning merchant ships meet the new physical port berth', () => {
  const raw = fixture();
  for (const state of ['docked', 'returning']) {
    const before = structuredClone(raw),
      ship = before.ships[0];
    ship.state = state;
    if (state === 'docked') ship.path = [];
    else ship.path = [E.berthOf(before.buildings.find((b) => b.key === 'port'))];
    const s = E.load(JSON.stringify(before));
    const berth = E.berthOf(s.buildings.find((b) => b.key === 'port'));
    const actual = state === 'docked' ? s.ships[0] : s.ships[0].path.at(-1);
    assert.ok(Math.hypot(actual.x - berth.x, actual.z - berth.z) < 1e-9);
    assert.ok(E.seaDistance(actual.x, actual.z) < 0);
  }
});

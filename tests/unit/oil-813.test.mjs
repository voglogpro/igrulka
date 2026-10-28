import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateOil } from '../../src/game/city/oil.js';
import { updateServices } from '../../src/game/city/service.js';

function fresh() {
  const s = E.createGame(813);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  return s;
}
const rates = [{ productivity: 1 }, { productivity: 1 }];
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);

test('moving ground engines burn 1.5 times their role fuel while infantry, carried, stopped, dead and other-side units burn none', () => {
  const s = fresh();
  s.groundUnits = [
    { key: 'leopard', side: 0, hp: 100, moving: true },
    { key: 'supplytruck', side: 0, hp: 100, moving: true },
    { key: 'infantry', side: 0, hp: 100, moving: true },
    { key: 'machinegunner', side: 0, hp: 100, moving: true },
    { key: 'leopard', side: 0, hp: 100, moving: false },
    { key: 'leopard', side: 0, hp: 100, moving: true, carrierId: 9 },
    { key: 'leopard', side: 0, hp: 0, moving: true },
    { key: 'leopard', side: 1, hp: 100, moving: true },
  ];
  const expected = 1.5 * (E.GROUND_UNITS.leopard.fuel + E.GROUND_UNITS.supplytruck.fuel);
  close(E.oilBurn(s, 0), expected);
  const oil = s.sides[0].oil;
  updateOil(s, rates, 10);
  close(oil - s.sides[0].oil, expected * 10);
});

test('ammo delivery consumes fuel during a route and stops at parking or death', () => {
  const s = fresh();
  s.ammoVehicles = [
    { side: 0, hp: 100, path: [{ x: 10, z: 10 }] },
    { side: 0, hp: 100, path: [] },
    { side: 0, hp: 0, path: [{ x: 10, z: 10 }] },
    { side: 1, hp: 100, path: [{ x: 10, z: 10 }] },
  ];
  close(E.oilBurn(s, 0), 0.012);
  s.ammoVehicles[0].path.length = 0;
  assert.equal(E.oilBurn(s, 0), 0);
});

test('real civilian repair vehicles without combat HP consume fuel on travel and stop when parked', () => {
  const s = fresh();
  const station = E.build(s, 0, 'service', -1080, -10);
  assert.equal(typeof station, 'object', String(station));
  Object.assign(station, { progress: 1, hp: station.maxHp });
  updateServices(s, 0.05);
  const vehicle = s.serviceVehicles.find((v) => v.side === 0);
  assert.ok(vehicle, 'exercise the production constructor rather than invent combat HP');
  assert.equal(vehicle.hp, undefined);
  vehicle.state = 'outbound';
  vehicle.path = [{ x: vehicle.x + 10, z: vehicle.z }];
  close(E.oilBurn(s, 0), 0.012);
  vehicle.path.length = 0;
  vehicle.state = 'idle';
  assert.equal(E.oilBurn(s, 0), 0);
});

test('a zero-oil zero-electronics city can pay for road and well and recover oil without buying fuel', () => {
  const s = fresh(),
    f = s.sides[0];
  f.oil = 0;
  f.components = 0;
  const initialCredits = f.credits,
    initialMetal = f.materials;
  const road = E.buildRoad(s, 0, -1105, -45, -1266, -228);
  assert.equal(typeof road, 'object', String(road));
  const quote = E.purchaseQuote(s, 0, 'building', 'oilwell');
  assert.equal(quote.oil, 0);
  assert.equal(quote.components, 0);
  const well = E.build(s, 0, 'oilwell', -1280, -250);
  assert.equal(typeof well, 'object', String(well));
  assert.equal(f.oil, 0);
  assert.equal(f.components, 0);
  assert.ok(f.credits < initialCredits && f.credits > 0);
  assert.ok(f.materials < initialMetal && f.materials > 0);
  E.advance(s, E.BUILDINGS.oilwell.time + 5);
  assert.equal(well.progress, 1);
  assert.ok(f.oil > 0, 'normal paid construction resumes extraction from a completely dry city');
});

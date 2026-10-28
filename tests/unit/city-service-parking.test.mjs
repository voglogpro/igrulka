import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../src/game/state.js';
import { build } from '../../src/game/city/construction.js';
import { BUILDINGS, GROUND_UNITS, HQ_X } from '../../src/game/config.js';
import { makeGround } from '../../src/game/units/ground/recruitment.js';
import { updateServices } from '../../src/game/city/service.js';
import { serviceParking } from '../../src/game/city/service-field-routes.js';
import { save, load } from '../../src/game/persistence/saves.js';
import { groundMovementMetrics } from '../../src/game/units/ground/movement.js';

const cfg = BUILDINGS.service.service;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fixture() {
  const s = createGame(2410);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 20000;
    f.materials = 3000;
    f.rearAuto = false;
  }
  return s;
}
function ready(s, side, key, x, z) {
  const b = build(s, side, key, x, z);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function ticks(s, seconds) {
  for (let i = 0; i < seconds * 20; i++) {
    const previous = new Map(s.serviceVehicles.map((v) => [v.id, { x: v.x, z: v.z }]));
    s.time += 0.05;
    updateServices(s, 0.05);
    for (const v of s.serviceVehicles)
      if (previous.has(v.id)) assert.ok(distance(v, previous.get(v.id)) <= cfg.speed * 0.05 + 1e-7);
    assert.ok((groundMovementMetrics(s)?.replans || 0) <= 2);
  }
}

test('repair vans choose a free home bay when a stationary MOG occupies the original parking endpoint', () => {
  const s = fixture(),
    station = ready(s, 0, 'service', -(HQ_X + 65), -80),
    target = ready(s, 0, 'housing', -(HQ_X - 55), -80);
  target.hp -= 120;
  updateServices(s, 0.05);
  ticks(s, 1);
  const van = s.serviceVehicles.find((v) => v.target),
    home = serviceParking(s, station, van.id % cfg.vehicles, van),
    mog = makeGround(s, 0, 'mog', home.x, home.z);
  mog.guard = { ...home };
  s.groundUnits.push(mog);
  const credits = s.sides[0].credits,
    materials = s.sides[0].materials;
  ticks(s, 90);
  assert.equal(target.hp, target.maxHp);
  assert.equal(
    van.state,
    'idle',
    'the returning van must stop beside a free bay instead of orbiting the occupied one',
  );
  assert.equal(van.path.length, 0);
  assert.deepEqual({ x: mog.x, z: mog.z }, home);
  assert.ok(distance(van, mog) >= 3 + GROUND_UNITS.mog.size * 0.42 + 0.35);
  assert.ok(Math.abs(credits - s.sides[0].credits - 120 * cfg.creditsPerHp) < 1e-7);
  assert.ok(Math.abs(materials - s.sides[0].materials - 120 * cfg.materialsPerHp) < 1e-7);
  const parked = { x: van.x, z: van.z };
  ticks(s, 30);
  assert.deepEqual({ x: van.x, z: van.z }, parked);
});

test('ordinary idle fleets in two cities remain parked through a reload', () => {
  const s = fixture();
  for (const side of [0, 1]) {
    const sign = side ? 1 : -1;
    ready(s, side, 'service', sign * (HQ_X + 65), -80);
    ready(s, side, 'housing', sign * (HQ_X - 55), -80);
  }
  updateServices(s, 0.05);
  const positions = s.serviceVehicles.map((v) => ({ id: v.id, x: v.x, z: v.z }));
  ticks(s, 60);
  const loaded = load(save(s));
  ticks(loaded, 60);
  assert.deepEqual(
    loaded.serviceVehicles.map((v) => ({ id: v.id, x: v.x, z: v.z })),
    positions,
  );
  assert.ok(loaded.serviceVehicles.every((v) => v.state === 'idle' && !v.path.length));
});

test('two owners finish paid repairs and retain free home bays after loading mid-return', () => {
  const s = fixture(),
    records = [];
  for (const side of [0, 1]) {
    const sign = side ? 1 : -1;
    const station = ready(s, side, 'service', sign * (HQ_X + 65), -80);
    const target = ready(s, side, 'housing', sign * (HQ_X - 55), -80);
    target.hp -= 120;
    records.push({ side, station, target });
  }
  updateServices(s, 0.05);
  ticks(s, 1);
  for (const { side, station } of records) {
    const van = s.serviceVehicles.find((v) => v.side === side && v.target);
    const home = serviceParking(s, station, van.id % cfg.vehicles, van);
    s.groundUnits.push(makeGround(s, side, 'mog', home.x, home.z));
  }
  const balances = s.sides.map((f) => ({ credits: f.credits, materials: f.materials }));
  let elapsed = 0;
  while (!s.serviceVehicles.some((v) => v.state === 'returning') && elapsed < 60) {
    ticks(s, 0.05);
    elapsed += 0.05;
  }
  assert.ok(s.serviceVehicles.some((v) => v.state === 'returning'));
  const loaded = load(save(s));
  ticks(loaded, 120 - elapsed);
  assert.ok(loaded.serviceVehicles.every((v) => v.state === 'idle' && !v.path.length));
  for (const { side, target } of records) {
    assert.equal(loaded.buildings.find((b) => b.id === target.id).hp, target.maxHp);
    assert.ok(
      Math.abs(balances[side].credits - loaded.sides[side].credits - 120 * cfg.creditsPerHp) < 1e-7,
    );
    assert.ok(
      Math.abs(balances[side].materials - loaded.sides[side].materials - 120 * cfg.materialsPerHp) <
        1e-7,
    );
  }
  const positions = loaded.serviceVehicles.map(({ x, z }) => ({ x, z }));
  ticks(loaded, 30);
  assert.deepEqual(
    loaded.serviceVehicles.map(({ x, z }) => ({ x, z })),
    positions,
  );
});

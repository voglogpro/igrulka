import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  assaultAmmunition,
  holdAssaultForSupply,
  rejectAssaultCrate,
  unavailableAssaultCrate,
} from '../../src/game/units/ground/assault-supply.js';
import {
  enrollCityAssault,
  recallDefenseAttack,
} from '../../src/game/units/ground/defense-attack.js';
import { updateFieldSupply } from '../../src/game/units/ground/field-supply.js';
import { appendGroundOrder } from '../../src/game/units/ground/route-queue.js';

test('crate rejection cache is bounded and expires after time or topology changes', () => {
  const s = E.createGame(8131, { mode: 'multiplayer' });
  const u = {};
  for (let id = 1; id <= 65; id++) rejectAssaultCrate(s, u, { id });
  assert.equal(unavailableAssaultCrate(s, u, { id: 1 }), false);
  assert.equal(unavailableAssaultCrate(s, u, { id: 2 }), true);
  s.time += 31;
  rejectAssaultCrate(s, u, { id: 66 });
  assert.equal(unavailableAssaultCrate(s, u, { id: 65 }), false);
  assert.equal(unavailableAssaultCrate(s, u, { id: 66 }), true);
  s.networkRevision++;
  rejectAssaultCrate(s, u, { id: 67 });
  assert.equal(unavailableAssaultCrate(s, u, { id: 66 }), false);
});

test('a stationary building gun cannot start a walking supply trip', () => {
  const s = E.createGame(8131, { mode: 'multiplayer' });
  const d = E.BUILDINGS.gun;
  const gun = {
    id: s.nextId++,
    side: 0,
    key: 'gun',
    x: -1092,
    z: -80,
    hp: d.hp,
    maxHp: d.hp,
    progress: 1,
    groundAmmo: 0,
    ammoReserve: 0,
  };
  s.buildings.push(gun);
  s.ammoCrates.push({
    id: s.nextId++,
    side: 0,
    key: 'ammo-crate',
    x: -1292,
    z: -80,
    hp: 100,
    maxHp: 100,
    stock: { small: 120, shell: 0, rocket: 0, sam: 0 },
  });
  updateFieldSupply(s);
  assert.equal(gun.supplyTrip, undefined);
  assert.equal(gun.path, undefined);
  assert.equal(gun.ammoReserve, 0);
});

test('a blocked return after real pickup and save/load resumes the attack without teleporting', () => {
  let s = E.createGame(8131, { mode: 'multiplayer' });
  let u = E.makeGround(s, 0, 'infantry', -1172, -80);
  s.groundUnits.push(u);
  E.orderGround(s, 0, [u.id], { x: -972, z: -80, mode: 'attackmove' });
  u.groundAmmo = u.ammoReserve = 0;
  s.ammoCrates.push({
    id: s.nextId++,
    side: 0,
    key: 'ammo-crate',
    x: -1352,
    z: -80,
    hp: 100,
    maxHp: 100,
    stock: { small: 60, shell: 0, rocket: 0, sam: 0 },
  });
  updateFieldSupply(s);
  for (let second = 0; second < 60 && u.supplyTrip?.phase !== 'returning'; second++)
    E.advance(s, 1);
  assert.equal(u.supplyTrip?.phase, 'returning');
  assert.ok(E.ammunitionStatus(s, u).total > 0);
  const building = E.build(s, 0, 'housing', -1172, -80);
  assert.equal(typeof building, 'object');
  // Discard the old now-invalid path after the actual paid solid placement.
  u.path = [];
  s = E.load(E.save(s));
  u = s.groundUnits.find((v) => v.id === u.id);
  const before = { x: u.x, z: u.z, ammo: E.ammunitionStatus(s, u).total };
  s.time += 1;
  updateFieldSupply(s);
  assert.equal(u.supplyTrip, undefined);
  assert.equal(u.order.mode, 'attackmove');
  assert.equal(u.order.x, -972);
  assert.deepEqual({ x: u.x, z: u.z, ammo: E.ammunitionStatus(s, u).total }, before);
  assert.doesNotThrow(() => E.load(E.save(s)));
});

test('Shift during a manual attack supply trip preserves the original goal then completes the appended goal', () => {
  const s = E.createGame(8131, { mode: 'multiplayer' });
  const u = E.makeGround(s, 0, 'infantry', -1172, -80);
  s.groundUnits.push(u);
  E.orderGround(s, 0, [u.id], { x: -972, z: -80, mode: 'attackmove' });
  u.groundAmmo = u.ammoReserve = 0;
  s.ammoCrates.push({
    id: s.nextId++,
    side: 0,
    key: 'ammo-crate',
    x: -1352,
    z: -80,
    hp: 100,
    maxHp: 100,
    stock: { small: 60, shell: 0, rocket: 0, sam: 0 },
  });
  updateFieldSupply(s);
  const before = { x: u.x, z: u.z };
  assert.equal(appendGroundOrder(s, 0, [u.id], { x: -892, z: -80, mode: 'move' }), 1);
  assert.deepEqual({ x: u.x, z: u.z }, before);
  assert.ok(u.supplyTrip);
  assert.equal(u.routeState, null);
  assert.deepEqual(
    u.routeQueue.map((p) => p.x),
    [-972, -892],
  );
  assert.doesNotThrow(() => E.load(E.save(s)));
  let originalReached = false;
  for (let second = 0; second < 100; second++) {
    E.advance(s, 1);
    originalReached ||= !u.supplyTrip && u.order?.mode === 'move' && u.order.x === -892;
    if (Math.hypot(u.x + 892, u.z + 80) <= 4) break;
  }
  assert.equal(originalReached, true);
  assert.equal(u.supplyTrip, undefined);
  assert.ok(Math.hypot(u.x + 892, u.z + 80) <= 4);
});

test('blocked supply returns consume at most four path attempts per cadence', () => {
  const s = E.createGame(8131, { mode: 'multiplayer' });
  const crate = {
    id: s.nextId++,
    side: 0,
    key: 'ammo-crate',
    x: -1352,
    z: -80,
    hp: 100,
    maxHp: 100,
    stock: { small: 0, shell: 0, rocket: 0, sam: 0 },
  };
  s.ammoCrates.push(crate);
  // Controlled already-loaded return records; the existing solid HQ blocks
  // every old endpoint. No rounds are transferred or created by this check.
  for (let i = 0; i < 5; i++) {
    const u = E.makeGround(s, 0, 'infantry', -1352, -80 - i * 4);
    s.groundUnits.push(u);
    u.supplyTrip = { crateId: crate.id, phase: 'returning', home: { x: -1207, z: 0 } };
    u.order = { x: -1207, z: 0, mode: 'resupplyReturn', supplyId: crate.id };
    u.routeQueue = [{ x: -972, z: -80 - i * 4, mode: 'attackmove' }];
  }
  assert.doesNotThrow(() => E.load(E.save(s)));
  updateFieldSupply(s);
  assert.equal(s.groundUnits.filter((u) => u.supplyTrip).length, 1);
  s.time += 1;
  updateFieldSupply(s);
  assert.equal(s.groundUnits.filter((u) => u.supplyTrip).length, 0);
});

for (const domain of ['ground-attack', 'air-guard'])
  test(`a dual weapon resupplies its empty ${domain} domain`, () => {
    const s = E.createGame(8131, { mode: 'multiplayer' });
    const d = E.GROUND_UNITS.shilka;
    const original = d.groundRange;
    try {
      d.groundRange = 100;
      const u = E.makeGround(s, 0, 'shilka', -1092, -80);
      s.groundUnits.push(u);
      if (domain === 'ground-attack') {
        E.orderGround(s, 0, [u.id], { x: -892, z: -80, mode: 'attackmove' });
        u.groundAmmo = 0;
      } else {
        u.guard = { x: u.x, z: u.z };
        u.order = { ...u.guard, mode: 'guard' };
        u.ammo = 0;
      }
      u.ammoReserve = 0;
      s.ammoCrates.push({
        id: s.nextId++,
        side: 0,
        key: 'ammo-crate',
        x: -1292,
        z: -80,
        hp: 100,
        maxHp: 100,
        stock: { small: 120, shell: 0, rocket: 0, sam: 0 },
      });
      updateFieldSupply(s);
      assert.ok(u.supplyTrip);
      assert.ok(u.path.length > 0);
      assert.equal(u.ammoReserve, 0);
    } finally {
      if (original === undefined) delete d.groundRange;
      else d.groundRange = original;
    }
  });

test('an empty assault recruit waits behind its defensive line without marching out', () => {
  const s = E.createGame(8131, { mode: 'multiplayer' });
  const u = E.makeGround(s, 0, 'infantry', -1192, -80);
  s.groundUnits.push(u);
  u.groundAmmo = u.ammoReserve = 0;
  u.stance = { mode: 'attack' };
  assert.equal(enrollCityAssault(s, u), true);
  assert.equal(u.order.mode, 'wait');
  assert.equal(u.path.length, 0);
  assert.equal(holdAssaultForSupply(s, u), true);
  assert.equal(E.defenseAttackStatus(s, 0).preparing, 1);
  assert.equal(E.orderGround(s, 0, [u.id], { x: -1092, z: -80, mode: 'move' }), 1);
  assert.equal(u.defenseAttack, undefined);
  assert.equal(u.supplyTrip, undefined);
});

test('an air magazine does not hide an empty ground magazine', () => {
  const s = E.createGame(8131, { mode: 'multiplayer' });
  const d = E.GROUND_UNITS.shilka;
  const previous = d.groundRange;
  try {
    d.groundRange = 100;
    const u = E.makeGround(s, 0, 'shilka', -1192, -80);
    u.groundAmmo = u.ammoReserve = 0;
    assert.ok(u.ammo > 0);
    assert.equal(assaultAmmunition(s, u).low, true);
  } finally {
    if (previous === undefined) delete d.groundRange;
    else d.groundRange = previous;
  }
});

test('an operation can physically seek a distant finite box and recall cancels its trip', () => {
  const s = E.createGame(8131, { mode: 'multiplayer' });
  const u = E.makeGround(s, 0, 'infantry', -892, -80);
  s.groundUnits.push(u);
  u.groundAmmo = u.ammoReserve = 0;
  u.stance = { mode: 'attack' };
  enrollCityAssault(s, u);
  const crate = {
    id: s.nextId++,
    side: 0,
    key: 'ammo-crate',
    x: -1192,
    z: -80,
    hp: 100,
    maxHp: 100,
    stock: { small: 60, shell: 0, rocket: 0, sam: 0 },
  };
  s.ammoCrates.push(crate);
  const before = { x: u.x, z: u.z };
  updateFieldSupply(s);
  assert.equal(u.supplyTrip?.crateId, crate.id);
  assert.ok(u.path.length > 0);
  assert.equal(crate.stock.small, 60);
  assert.equal(E.ammunitionStatus(s, u).total, 0);
  assert.deepEqual({ x: u.x, z: u.z }, before);
  assert.equal(recallDefenseAttack(s, 0), 1);
  assert.equal(u.supplyTrip, undefined);
  assert.equal(u.order.mode, 'retreat');
  assert.equal(crate.stock.small, 60);
});

test('an unreachable stocked box does not prevent the operation returning to its own line', () => {
  const s = E.createGame(8131, { mode: 'multiplayer' });
  const u = E.makeGround(s, 0, 'infantry', 892, -80);
  s.groundUnits.push(u);
  u.groundAmmo = u.ammoReserve = 0;
  u.stance = { mode: 'attack' };
  enrollCityAssault(s, u);
  // Open sea is not an accessible supply destination, even with paid stock.
  s.ammoCrates.push({
    id: s.nextId++,
    side: 0,
    key: 'ammo-crate',
    x: 0,
    z: 0,
    hp: 100,
    maxHp: 100,
    stock: { small: 60, shell: 0, rocket: 0, sam: 0 },
  });
  updateFieldSupply(s);
  assert.equal(u.supplyTrip, undefined);
  assert.equal(holdAssaultForSupply(s, u), true);
  assert.equal(u.order.mode, 'move');
  assert.deepEqual({ x: u.order.x, z: u.order.z }, u.defenseAttack.home);
  assert.equal(s.ammoCrates[0].stock.small, 60);
});

for (const key of ['infantry', 'mog'])
  for (const mode of ['attackmove', 'guard'])
    test(`manual ${key} ${mode} physically resupplies, saves and keeps its original destination`, () => {
      const s = E.createGame(8131, { mode: 'multiplayer' });
      const u = E.makeGround(s, 0, key, -1092, -80);
      s.groundUnits.push(u);
      if (mode === 'guard') {
        u.guard = { x: -1092, z: -80 };
        u.order = { ...u.guard, mode: 'guard' };
      } else assert.equal(E.orderGround(s, 0, [u.id], { x: -892, z: -80, mode }), 1);
      const original = { ...u.order };
      u.groundAmmo = u.ammoReserve = 0;
      const crate = {
        id: s.nextId++,
        side: 0,
        key: 'ammo-crate',
        x: -1292,
        z: -80,
        hp: 100,
        maxHp: 100,
        stock: { small: 60, shell: 0, rocket: 0, sam: 0 },
      };
      s.ammoCrates.push(crate);
      updateFieldSupply(s);
      assert.ok(u.supplyTrip);
      assert.equal(u.autoDefense, false);
      assert.equal(u.defenseAttack, undefined);
      assert.doesNotThrow(() => E.load(E.save(s)));
      const forged = JSON.parse(E.save(s));
      const rogue = forged.groundUnits.find((v) => v.id === u.id);
      rogue.guard = null;
      rogue.routeQueue = [];
      assert.throws(() => E.load(JSON.stringify(forged)), /маршрут пополнения/);
      let pickedUp = false;
      for (let second = 0; second < 90; second++) {
        E.advance(s, 1);
        pickedUp ||= E.ammunitionStatus(s, u).total > 0;
        if (pickedUp && !u.supplyTrip) break;
      }
      assert.equal(pickedUp, true);
      assert.equal(u.supplyTrip, undefined);
      if (mode === 'guard') assert.deepEqual(u.guard, { x: original.x, z: original.z });
      else {
        assert.equal(u.order.mode, original.mode);
        assert.equal(u.order.x, original.x);
        assert.equal(u.order.z, original.z);
      }
      assert.equal(E.orderGround(s, 0, [u.id], { x: -992, z: -80, mode: 'move' }), 1);
      assert.equal(u.supplyTrip, undefined);
    });

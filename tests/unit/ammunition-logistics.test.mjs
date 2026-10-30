import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { dirtyNetwork } from '../../src/game/city/road-network.js';
import { updateAmmoProduction } from '../../src/game/city/ammo-production.js';
import { fireDefenses } from '../../src/game/combat/air-defense.js';
import { tickUnit } from '../../src/game/units/ground/update.js';
import { ammunitionProfile, receiveAmmunition } from '../../src/game/units/ground/ammunition.js';
import { damageAmmoVehicle } from '../../src/game/city/ammo-vehicle-damage.js';
import { moveProjectiles } from '../../src/game/combat/projectiles.js';

function fresh() {
  const s = E.createGame(892);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  s.rules.oil = false;
  for (const f of s.sides) {
    f.credits = 10000;
    f.materials = 1000;
  }
  return s;
}
function building(s, key = 'ammofactory', side = 0) {
  const b = E.build(s, side, key, (side ? 1 : -1) * (E.HQ_X + 65), -10);
  assert.equal(typeof b, 'object', b);
  b.hp = b.maxHp;
  b.progress = 1;
  return b;
}
function unit(s, key = 'infantry', side = 0, x = (side ? 1 : -1) * (E.HQ_X - 115), z = 250) {
  const u = E.makeGround(s, side, key, x, z);
  u.holdFire = true;
  s.groundUnits.push(u);
  return u;
}
function until(s, condition, max = 60) {
  const end = s.time + max;
  while (!condition() && s.time < end) E.step(s, 0.05);
  assert.ok(condition(), `not reached at ${s.time}`);
}

test('a real rifle exhausts two magazines, cannot reload for free, then fires only physically supplied rounds', () => {
  const s = fresh(),
    u = unit(s),
    enemy = unit(s, 'infantry', 1, u.x + 45, u.z);
  enemy.hp = enemy.maxHp = 1e7;
  u.holdFire = false;
  E.advance(s, 100);
  assert.equal(u.groundAmmo, 0);
  assert.equal(u.ammoReserve, 0);
  const shots = () => s.events.filter((e) => e.type === 'shot' && e.buildingId === u.id).length;
  const before = shots();
  assert.equal(before, E.GROUND_UNITS.infantry.groundMagazine * 2);
  E.advance(s, 10);
  assert.equal(shots(), before);
  assert.equal(receiveAmmunition(u, 'small', 3), 3);
  E.advance(s, 12);
  assert.equal(shots(), before + 3);
  assert.equal(u.ammoReserve, 0);
  assert.equal(u.groundAmmo, 0);
});

test('actual ground and AA rifle fire draw from one shared magazine/reserve and AA-only vehicles do not reload an unused ground rack', () => {
  const s = fresh(),
    u = unit(s),
    enemy = unit(s, 'infantry', 1, u.x + 40, u.z);
  enemy.hp = enemy.maxHp = 1e6;
  u.holdFire = false;
  E.advance(s, 1);
  enemy.hp = 0;
  const used = E.GROUND_UNITS.infantry.groundMagazine - u.groundAmmo;
  assert.ok(used > 0);
  const air = {
    id: s.nextId++,
    side: 1,
    key: 'drone',
    hp: 1e6,
    launched: true,
    x: u.x + 20,
    z: u.z,
    y: 20,
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 30,
    total: 10000,
    travelled: 0,
    delay: 0,
  };
  s.units.push(air);
  for (let i = 0; i < 4000; i++) {
    s.time += 0.05;
    tickUnit(s, u, 0.05, [E.economy(s, 0), E.economy(s, 1)], { event: () => {}, random: E.random });
    fireDefenses(s, [E.economy(s, 0), E.economy(s, 1)], 0.05);
  }
  assert.equal(u.groundAmmo, 0);
  assert.equal(u.ammoReserve, 0);
  assert.equal(s.projectiles.filter((p) => p.sourceId === u.id).length, 60 - used);
  const aa = unit(s, 'shilka', 0, u.x - 100, u.z);
  aa.groundAmmo = 0;
  const reserve = aa.ammoReserve;
  aa.holdFire = true;
  tickUnit(s, aa, 0.05, [E.economy(s, 0), E.economy(s, 1)], { event: () => {}, random: E.random });
  assert.equal(aa.ammoReserve, reserve);
  assert.equal(aa.groundAmmo, 0);
});

test('ammo classes follow the weapon profile and ready connected factories pay exact batch costs with a 250-credit reserve', () => {
  const s = fresh(),
    b = building(s),
    u = unit(s);
  u.groundAmmo = 0;
  u.ammoReserve = 0;
  assert.equal(ammunitionProfile({ key: 'tankdestroyer' }).kind, 'rocket');
  assert.equal(ammunitionProfile({ key: 'howitzer' }).kind, 'shell');
  assert.equal(ammunitionProfile({ key: 'sam' }).kind, 'sam');
  s.sides[0].credits = 262;
  const metal = s.sides[0].materials;
  updateAmmoProduction(s);
  assert.equal(s.sides[0].credits, 250);
  assert.equal(s.sides[0].materials, metal - 1);
  assert.equal(s.sides[0].ammoStock.small, 60);
  for (let i = 0; i < 100; i++) updateAmmoProduction(s);
  assert.equal(s.sides[0].ammoStock.small, 60);
  assert.equal(E.ammoFactoryStatus(s, 0, b.id).fleet.limit, 2);
});

test('production stops without roads but paid stock still travels across real dry ground after road interruption', () => {
  for (const side of [0, 1]) {
    const s = fresh(),
      b = building(s, 'ammofactory', side),
      u = unit(s, 'infantry', side);
    u.groundAmmo = 0;
    u.ammoReserve = 0;
    s.sides[side].ammoStock.small = 60;
    s.sides[side].credits = 0;
    for (const r of s.roads) if (r.side === side) r.blocked = true;
    dirtyNetwork(s);
    assert.equal(E.ammoFactoryStatus(s, side, b.id).status, 'road');
    E.step(s, 0.05);
    const van = s.ammoVehicles.find((v) => v.side === side && v.cargo);
    assert.ok(van && van.path.length);
    const start = { x: van.x, z: van.z };
    assert.equal(u.ammoReserve, 0, 'no warehouse teleport');
    E.advance(s, 1);
    assert.ok(Math.hypot(van.x - start.x, van.z - start.z) <= E.AMMUNITION.speed + 0.01);
    until(s, () => E.ammunitionStatus(s, u).total === 60, 40);
    assert.equal(s.sides[side].ammoStock.small, 0);
    assert.ok(s.ammoVehicles.every((v) => E.walkable(s, v.x, v.z, 3)));
  }
});

test('weapon cargo leaves the warehouse at pickup, reaches a silo physically, and returns physically when its target is destroyed', () => {
  const s = fresh(),
    factory = building(s, 'factory');
  const silo = E.build(s, 0, 'silo', -992, 250);
  assert.equal(typeof silo, 'object', silo);
  silo.hp = silo.maxHp;
  silo.progress = 1;
  s.sides[0].inventory.cruise = 2;
  E.step(s, 0.05);
  assert.equal(silo.launchStore.cruise, 0);
  assert.equal(s.sides[0].inventory.cruise, 0);
  assert.equal(s.ammoVehicles.filter((v) => v.cargo?.key === 'cruise').length, 1);
  assert.equal(s.ammoVehicles.find((v) => v.cargo?.key === 'cruise').cargo.amount, 2);
  const loaded = E.load(E.save(s));
  while (silo.launchStore.cruise < 2 && s.time < 30) {
    E.step(s, 0.05);
    E.step(loaded, 0.05);
  }
  assert.equal(silo.launchStore.cruise, 2);
  assert.deepEqual(loaded.sides, s.sides);
  const comparable = (cars) => cars.map(({ revision, ...car }) => car);
  assert.deepEqual(comparable(loaded.ammoVehicles), comparable(s.ammoVehicles));
  s.sides[0].inventory.cruise = 1;
  until(s, () => s.ammoVehicles.some((v) => v.cargo?.key === 'cruise'), 15);
  const cargo = s.ammoVehicles.find((v) => v.cargo?.key === 'cruise');
  E.advance(s, 1);
  silo.hp = 0;
  E.advance(s, 1.1);
  assert.equal(s.sides[0].inventory.cruise, 0, 'target loss cannot teleport cargo back into stock');
  until(s, () => factory.launchStore.cruise === 1, 30);
  assert.ok(Math.hypot(cargo.x - factory.x, cargo.z - factory.z) < 65);
});

test('disabled plants stop dispatch while destroyed depots preserve paid cargo already on the road; support trucks obey stop', () => {
  const s = fresh(),
    b = building(s),
    u = unit(s),
    truck = unit(s, 'supplytruck', 0, u.x - 10, u.z);
  s.sides[0].credits = 0;
  u.groundAmmo = 0;
  u.ammoReserve = 0;
  truck.ammoCargo.small = 10;
  assert.equal(E.commandUnits(s, 0, [truck.id], 'stop'), 1);
  const start = { x: truck.x, z: truck.z };
  E.advance(s, 0.1);
  assert.equal(truck.ammoCargo.small, 0);
  assert.equal(u.ammoReserve, 10);
  assert.deepEqual({ x: truck.x, z: truck.z }, start);
  assert.equal(truck.supportManual, true);
  s.sides[0].ammoStock.small = 60;
  E.setAmmoFactoryEnabled(s, 0, b.id, false);
  E.advance(s, 2);
  assert.ok(s.ammoVehicles.every((v) => !v.cargo));
  E.setAmmoFactoryEnabled(s, 0, b.id, true);
  E.advance(s, 1.1);
  assert.ok(s.ammoVehicles.some((v) => v.cargo));
  b.hp = 0;
  E.advance(s, 1.1);
  assert.ok(
    s.ammoVehicles.some((v) => v.hp > 0 && v.cargo),
    'source destruction cannot erase paid cargo on a healthy vehicle',
  );
});

test('current ammo imports reject prototype keys, foreign recipients, excess cargo and ammo metadata on unarmed objects', () => {
  const s = fresh(),
    b = building(s),
    u = unit(s);
  s.sides[0].credits = 0;
  s.sides[0].ammoStock.small = 60;
  u.ammoReserve = 0;
  E.step(s, 0.05);
  assert.ok(s.ammoVehicles.some((v) => v.cargo));
  const raw = JSON.parse(E.save(s));
  for (const mutate of [
    (v) => (v.sides[0].ammoStock.constructor = 1),
    (v) => (v.sides[0].ammoStock = JSON.parse('{"__proto__":1}')),
    (v) => (v.ammoVehicles.find((c) => c.cargo).cargo.amount = 10000),
    (v) => (v.ammoVehicles.find((c) => c.cargo).side = 1),
    (v) => (v.buildings.find((c) => c.id === b.id).ammoReserve = 1),
    (v) => (v.groundUnits[0].ammoReserve = 1.5),
  ]) {
    const copy = structuredClone(raw);
    mutate(copy);
    assert.throws(() => E.load(JSON.stringify(copy)));
  }
});

test('FPV launches consume existing local charges without double billing and a produced drone is physically delivered as one replacement', () => {
  const s = fresh(),
    factory = building(s, 'factory'),
    u = unit(s, 'operator');
  u.fpvAmmo = 1;
  s.sides[0].credits = 0;
  s.sides[0].materials = 0;
  assert.equal(E.launchFPV(s, 0, [u.id], { x: u.x + 100, z: u.z }), true);
  assert.equal(u.fpvAmmo, 0);
  assert.equal(s.sides[0].credits, 0);
  assert.equal(s.sides[0].materials, 0);
  s.sides[0].inventory.drone = 1;
  factory.launchStore = { drone: 1, heavy: 1, cruise: 0, ballistic: 0 };
  E.step(s, 0.05);
  assert.equal(u.fpvAmmo, 0);
  assert.equal(s.sides[0].inventory.drone, 0);
  until(s, () => u.fpvAmmo === 1, 20);
  assert.equal(E.ammunitionStatus(s, u).fpvAmmo, 1);
});

test('a full eight-slot fleet replaces one destroyed slot only after its delay and paid reserves', () => {
  const s = fresh();
  assert.equal(typeof E.buildRoad(s, 0, -1297, -45, -1307, -45), 'object');
  assert.equal(typeof E.buildRoad(s, 0, -1307, -45, -1307, 260), 'object');
  for (const z of [-10, 70, 150, 230]) {
    const b = E.build(s, 0, 'ammofactory', -1272, z);
    assert.equal(typeof b, 'object', b);
    b.progress = 1;
    b.hp = b.maxHp;
  }
  E.updateAmmoLogistics(s, 0.05);
  assert.equal(s.ammoVehicles.length, 8);
  const dead = s.ammoVehicles[0],
    c = E.AMMUNITION.vehicle;
  damageAmmoVehicle(s, dead, c.hp);
  const saved = E.load(E.save(s));
  const oldIds = s.ammoVehicles.map((v) => v.id);
  const advance = (seconds) => {
    for (let i = 0; i < seconds * 20; i++) {
      saved.time += 0.05;
      E.updateAmmoLogistics(saved, 0.05);
    }
  };
  saved.sides[0].credits = 250 + c.replacementCost;
  saved.sides[0].materials = 5 + c.replacementMetal - 1;
  advance(c.replacementDelay + 2);
  assert.ok(saved.ammoVehicles.some((v) => v.id === dead.id));
  saved.sides[0].materials++;
  const depot = saved.buildings.find((b) => b.id === dead.depotId);
  depot.ammoEnabled = false;
  advance(2);
  assert.ok(
    saved.ammoVehicles.some((v) => v.id === dead.id),
    'disabled depots do not buy replacements',
  );
  depot.ammoEnabled = true;
  advance(2);
  assert.equal(saved.ammoVehicles.length, 8);
  assert.equal(saved.ammoVehicles.filter((v) => v.hp > 0).length, 8);
  assert.equal(saved.ammoVehicles.filter((v) => !oldIds.includes(v.id)).length, 1);
  assert.equal(saved.sides[0].credits, 250);
  assert.equal(saved.sides[0].materials, 5);
});

test('an inaccessible recipient does not consume stock; relocation retries, zero simulation time and endgame freeze real deliveries', () => {
  const s = fresh();
  building(s);
  const u = unit(s, 'infantry', 0, 0, 0);
  u.groundAmmo = 0;
  u.ammoReserve = 0;
  s.sides[0].credits = 0;
  s.sides[0].ammoStock.small = 30;
  E.advance(s, 3);
  assert.equal(s.sides[0].ammoStock.small, 30);
  assert.ok(s.ammoVehicles.every((v) => !v.cargo));
  assert.equal(E.ammoLogisticsStatus(s, 0, u.id).status, 'blocked');
  u.x = -1092;
  u.z = 250;
  E.advance(s, 1.1);
  const car = s.ammoVehicles.find((v) => v.cargo);
  assert.ok(car?.path.length);
  const before = E.save(s);
  for (let i = 0; i < 100; i++) E.step(s, 0);
  assert.equal(E.save(s), before);
  s.result = { winner: 0 };
  const frozen = E.save(s);
  E.advance(s, 5);
  assert.equal(E.save(s), frozen);
  s.result = null;
  until(s, () => E.ammunitionStatus(s, u).total === 30, 30);
});

test('electricity and damage reduce paid ammunition throughput without changing batch prices', () => {
  const s = fresh(),
    plant = building(s),
    u = unit(s);
  u.groundAmmo = 0;
  u.ammoReserve = 0;
  updateAmmoProduction(s);
  const normal = plant.ammoNextAt - s.time;
  for (const b of s.buildings) if (b.key === 'power') b.hp = 0;
  plant.hp = plant.maxHp * 0.5;
  plant.ammoNextAt = 0;
  s.sides[0].ammoStock.small = 0;
  const credits = s.sides[0].credits,
    metal = s.sides[0].materials;
  updateAmmoProduction(s);
  assert.ok(plant.ammoNextAt - s.time > normal);
  assert.equal(s.sides[0].credits, credits - 12);
  assert.equal(s.sides[0].materials, metal - 1);
  assert.equal(s.sides[0].ammoStock.small, 60);
  assert.doesNotThrow(() => E.load(E.save(s)));
});

test('already loaded ground and AA rounds fire with an empty wallet, a miss cannot refund paid ammunition', () => {
  const s = fresh(),
    plant = building(s),
    u = unit(s),
    enemy = unit(s, 'infantry', 1, u.x + 40, u.z);
  u.holdFire = false;
  u.groundAmmo = 1;
  u.ammoReserve = 0;
  s.sides[0].credits = 0;
  s.sides[0].materials = 0;
  const rates = [E.economy(s, 0), E.economy(s, 1)];
  tickUnit(s, u, 0.05, rates, { event: () => {}, random: E.random });
  assert.equal(u.groundAmmo, 0);
  assert.equal(s.projectiles.length, 1);
  const projectile = s.projectiles[0];
  projectile.tx = u.x - 150;
  projectile.targetId = null;
  for (let i = 0; i < 100; i++) {
    s.time += 0.05;
    moveProjectiles(s, 0.05);
  }
  assert.equal(enemy.hp, enemy.maxHp);
  assert.equal(u.ammoReserve, 0);
  assert.equal(u.groundAmmo, 0);
  assert.equal(s.sides[0].credits, 0);
  assert.equal(s.sides[0].materials, 0);
  const aa = unit(s, 'shilka', 0, u.x - 80, u.z);
  aa.holdFire = false;
  aa.ammo = 1;
  aa.ammoReserve = 0;
  s.units.push({
    id: s.nextId++,
    side: 1,
    key: 'drone',
    hp: 1e6,
    launched: true,
    x: aa.x + 15,
    z: aa.z,
    y: 20,
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 30,
    total: 10000,
    travelled: 0,
    delay: 0,
  });
  fireDefenses(s, rates, 0.05);
  assert.equal(aa.ammo, 0);
  assert.ok(s.projectiles.some((p) => p.sourceId === aa.id));
  assert.equal(s.sides[0].credits, 0);
  assert.equal(s.sides[0].materials, 0);
  updateAmmoProduction(s);
  assert.equal(E.ammoFactoryStatus(s, 0, plant.id).status, 'credits');
  assert.deepEqual(s.sides[0].ammoStock, E.createAmmoStock());
});

test('an empty distant silo gets a first shipment before a nearby partially stocked launcher is filled', () => {
  const s = fresh();
  building(s, 'factory');
  const launcher = E.build(s, 0, 'launcher', -1142, 200),
    silo = E.build(s, 0, 'silo', -1012, 400);
  for (const b of [launcher, silo]) {
    assert.equal(typeof b, 'object', b);
    b.progress = 1;
    b.hp = b.maxHp;
    E.initLaunchStore(b);
  }
  launcher.launchStore.drone = 1;
  s.sides[0].inventory.drone = 2;
  s.sides[0].inventory.cruise = 2;
  E.step(s, 0.05);
  const shipments = s.ammoVehicles.filter((v) => v.cargo?.kind === 'weapon');
  assert.equal(shipments.length, 2);
  assert.deepEqual(new Set(shipments.map((v) => v.targetId)), new Set([launcher.id, silo.id]));
  assert.equal(shipments.find((v) => v.targetId === silo.id).cargo.key, 'cruise');
  assert.equal(silo.launchStore.cruise, 0, 'priority still uses physical travel');
});

test('redeploying an empty stationary MOG cannot manufacture free rounds or cancel its paid reload', () => {
  const s = fresh(),
    b = building(s, 'gun');
  b.groundAmmo = 0;
  b.ammo = 0;
  b.ammoReserve = 7;
  b.groundReload = 2;
  b.groundCooldown = 0.5;
  b.cooldown = 0.4;
  const id = E.redeployMOG(s, 0, b.id),
    u = s.groundUnits.find((v) => v.id === id);
  assert.ok(u);
  assert.equal(u.groundAmmo, 0);
  assert.equal(u.ammoReserve, 7);
  assert.equal(u.groundReload, 2);
  assert.equal(u.groundCooldown, 0.5);
  assert.equal(u.cooldown, 0.4);
  assert.equal(b.demolished, true);
  assert.doesNotThrow(() => E.load(E.save(s)));
  E.advance(s, 2.1);
  assert.equal(u.groundAmmo, 7);
  assert.equal(u.ammoReserve, 0);
});

test('saving after depot destruction preserves paid cargo through reconciliation and its eventual physical delivery', () => {
  const s = fresh(),
    b = building(s),
    u = unit(s);
  u.ammoReserve = 0;
  s.sides[0].credits = 0;
  s.sides[0].ammoStock.small = 30;
  E.step(s, 0.05);
  assert.ok(s.ammoVehicles.some((v) => v.cargo));
  assert.equal(E.demolish(s, b.id, 0), true);
  const copy = E.load(E.save(s));
  assert.ok(copy.ammoVehicles.some((v) => v.cargo));
  E.advance(s, 1.1);
  E.advance(copy, 1.1);
  assert.ok(copy.ammoVehicles.some((v) => v.cargo));
  assert.deepEqual(
    copy.ammoVehicles.map((v) => v.cargo),
    s.ammoVehicles.map((v) => v.cargo),
  );
  assert.equal(copy.groundUnits[0].ammoReserve, 0);
  assert.equal(copy.sides[0].ammoStock.small, 0);
  assert.deepEqual(copy.sides, s.sides);
  E.advance(copy, 30);
  E.advance(s, 30);
  assert.equal(copy.groundUnits[0].ammoReserve, 30);
  assert.deepEqual(copy.sides, s.sides);
  assert.deepEqual(copy.ammoCrates, s.ammoCrates);
});

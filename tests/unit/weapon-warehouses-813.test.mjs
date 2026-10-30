import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateConstruction } from '../../src/game/city/update.js';
import {
  weaponStoreStock,
  factoryWarehouseStatus,
} from '../../src/game/units/aviation/weapon-stores.js';
import { weaponDeliveryStatus } from '../../src/game/city/weapon-delivery-status.js';

function fixture() {
  const s = E.createGame(813, { mode: 'multiplayer' });
  s.rules.rear = false;
  s.sides[0].components = 6;
  const factory = E.build(s, 0, 'factory', -1272, -10);
  assert.equal(typeof factory, 'object', String(factory));
  factory.progress = 1;
  factory.hp = factory.maxHp;
  const silo = E.build(s, 0, 'silo', -992, 250);
  assert.equal(typeof silo, 'object', String(silo));
  silo.progress = 1;
  silo.hp = silo.maxHp;
  for (const key of Object.keys(E.WEAPONS)) s.sides[0].inventory[key] = 0;
  return { s, factory, silo };
}
function until(s, condition, max = 80) {
  const end = s.time + max;
  while (!condition() && s.time < end) E.step(s, 0.05);
  assert.ok(condition(), `not reached at ${s.time}`);
}

test('completed paid production stays at its factory and waits intact behind a full physical warehouse', () => {
  const { s, factory } = fixture();
  assert.equal(E.produce(s, 0, 'drone', 1, factory.id), true);
  const credits = s.sides[0].credits,
    materials = s.sides[0].materials;
  E.acceptLaunchDelivery(factory, 'cruise', 24);
  factory.queue[0].progress = 0.99;
  updateConstruction(
    s,
    s.sides.map(() => ({ productivity: 1 })),
    10,
  );
  assert.equal(factory.queue.length, 1);
  assert.equal(factory.queue[0].progress, 1);
  assert.equal(factoryWarehouseStatus(s, factory).blocked, true);
  assert.equal(s.sides[0].inventory.drone, 0);
  factory.launchStore.cruise--;
  updateConstruction(
    s,
    s.sides.map(() => ({ productivity: 1 })),
    0.05,
  );
  assert.equal(factory.queue.length, 0);
  assert.equal(weaponStoreStock(factory, 'drone'), 1);
  assert.equal(s.sides[0].credits, credits);
  assert.equal(s.sides[0].materials, materials);
  factory.level = 2;
  assert.equal(factoryWarehouseStatus(s, factory).capacity, 36);
});

test('full missile loads split legacy/local withdrawal exactly, expose pure ETA, survive loading and complete without cycling', () => {
  const { s, factory, silo } = fixture();
  s.sides[0].inventory.ballistic = 1;
  E.acceptLaunchDelivery(factory, 'ballistic', 3);
  E.requestWeaponDelivery(s, 0, silo.id, 'ballistic', 4);
  E.step(s, 0.05);
  const cars = s.ammoVehicles.filter((v) => v.cargo?.key === 'ballistic');
  assert.equal(
    cars.reduce((n, v) => n + v.cargo.amount, 0),
    4,
  );
  assert.ok(cars.every((v) => v.cargo.amount <= E.AMMUNITION.weaponLoad.missile));
  assert.equal(s.sides[0].inventory.ballistic, 0);
  assert.equal(factory.launchStore.ballistic, 0);
  const before = E.save(s),
    status = weaponDeliveryStatus(s, silo, 'ballistic');
  assert.equal(status.inTransit, 4);
  assert.ok(status.eta > 0 && status.eta < 80);
  assert.equal(status.stage, 'incoming');
  assert.equal(E.save(s), before);
  const loaded = E.load(before),
    rack = loaded.buildings.find((b) => b.id === silo.id);
  until(loaded, () => rack.launchStore.ballistic === 4);
  E.advance(loaded, 30);
  assert.equal(weaponDeliveryStatus(loaded, rack, 'ballistic').stage, 'ready');
  assert.ok(loaded.ammoVehicles.every((v) => !v.cargo && !v.pickup));
  assert.equal(E.weaponStock(loaded, 0, 'ballistic'), 4);
});

test('legacy global weapons migrate once without overflow loss, while source destruction spares loaded cargo', () => {
  const { s, factory, silo } = fixture();
  E.acceptLaunchDelivery(factory, 'drone', 2);
  s.sides[0].inventory.ballistic = 40;
  const raw = JSON.parse(E.save(s));
  raw.version = 20;
  const restored = E.load(JSON.stringify(raw));
  const source = restored.buildings.find((b) => b.id === factory.id);
  const rack = restored.buildings.find((b) => b.id === silo.id);
  assert.equal(source.launchStore.ballistic, 40);
  assert.equal(source.warehouseCapacity, 42);
  assert.equal(restored.sides[0].inventory.ballistic, 0);
  assert.equal(E.weaponStock(E.load(E.save(restored)), 0, 'ballistic'), 40);
  E.requestWeaponDelivery(restored, 0, rack.id, 'ballistic', 4);
  E.step(restored, 0.05);
  const loaded = restored.ammoVehicles.reduce(
    (n, v) => n + (v.cargo?.key === 'ballistic' ? v.cargo.amount : 0),
    0,
  );
  assert.equal(loaded, 4);
  source.hp = 0;
  assert.equal(E.weaponStock(restored, 0, 'ballistic'), loaded);
  until(restored, () => rack.launchStore.ballistic === loaded);
  assert.equal(E.weaponStock(restored, 0, 'ballistic'), loaded);
});

test('four-city migration keeps each warehouse private to its owner and preserves a missing-factory legacy stock', () => {
  const s = E.createGame(814, { mode: 'coop' });
  for (const hq of [...s.buildings]) {
    if (hq.side === 3) continue;
    const b = E.build(s, hq.side, 'factory', hq.x + (hq.x < 0 ? -65 : 65), hq.z - 10);
    assert.equal(typeof b, 'object', String(b));
    b.progress = 1;
    b.hp = b.maxHp;
  }
  for (let side = 0; side < 4; side++) {
    s.sides[side].inventory.ballistic = side + 2;
    s.sides[side].inventory.cruise = side + 1;
  }
  const raw = JSON.parse(E.save(s));
  raw.version = 20;
  const loaded = E.load(JSON.stringify(raw));
  for (let side = 0; side < 4; side++) {
    assert.equal(E.weaponStock(loaded, side, 'ballistic'), side + 2);
    assert.equal(E.weaponStock(loaded, side, 'cruise'), side + 1);
    const factory = loaded.buildings.find((b) => b.side === side && b.key === 'factory');
    if (factory) {
      assert.equal(factory.launchStore.ballistic, side + 2);
      assert.equal(loaded.sides[side].inventory.ballistic, 0);
    } else assert.equal(loaded.sides[side].inventory.ballistic, side + 2);
  }
  assert.equal(factoryWarehouseStatus(loaded, null), null);
  assert.equal(factoryWarehouseStatus(null, { key: 'factory', side: 0 }), null);
});

test('delivery status excludes other types, returns, collections and foreign vans; blocked routes have no invented ETA', () => {
  const { s, factory, silo } = fixture();
  E.acceptLaunchDelivery(factory, 'ballistic', 2);
  E.requestWeaponDelivery(s, 0, silo.id, 'ballistic', 2);
  E.step(s, 0.05);
  const van = s.ammoVehicles.find((v) => v.cargo?.key === 'ballistic');
  const clones = [
    { cargo: { kind: 'weapon', key: 'cruise', amount: 2 } },
    { status: 'returning' },
    { cargo: null, pickup: { key: 'cruise', amount: 1 } },
    { side: 1 },
  ].map((change) => ({ ...structuredClone(van), id: s.nextId++, ...change }));
  s.ammoVehicles.push(...clones);
  const before = JSON.stringify(s);
  const status = weaponDeliveryStatus(s, silo, 'ballistic');
  assert.equal(status.inTransit, 2);
  assert.equal(status.exchanging, 1);
  assert.equal(JSON.stringify(s), before);
  van.status = 'blocked';
  assert.equal(weaponDeliveryStatus(s, silo, 'ballistic').eta, null);
  assert.equal(weaponDeliveryStatus(s, null, 'ballistic').stage, 'unavailable');
});

test('version twenty partial factory racks migrate missing zero slots without coercing corrupt stored values', () => {
  for (const partial of [{}, { drone: 1 }]) {
    const { s, factory } = fixture();
    factory.launchStore = partial;
    s.sides[0].inventory.heavy = 2;
    const raw = JSON.parse(E.save(s));
    raw.version = 20;
    const restored = E.load(JSON.stringify(raw));
    const rack = restored.buildings.find((b) => b.id === factory.id);
    assert.equal(rack.launchStore.heavy, 2);
    assert.equal(rack.launchStore.drone, partial.drone || 0);
    assert.equal(rack.launchStore.ballistic, 0);
    assert.equal(rack.launchStore.cruise, 0);
    assert.equal(restored.sides[0].inventory.heavy, 0);
  }
  for (const value of ['1', null, -1]) {
    const { s, factory } = fixture();
    factory.launchStore = { drone: value };
    const raw = JSON.parse(E.save(s));
    raw.version = 20;
    assert.throws(() => E.load(JSON.stringify(raw)), /warehouse|склад/i);
  }
});

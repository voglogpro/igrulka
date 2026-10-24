import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateFactoryPlans } from '../../src/game/units/aviation/factory-plans.js';

function fresh() {
  const s = E.createGame(8902);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 1e6;
    f.materials = 1e6;
  }
  return s;
}
function site(s, key = 'launcher', x = -850, z = 100) {
  const b = E.build(s, 0, key, x, z);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  E.initLaunchStore(b);
  return b;
}
function deliver(s, b, key, count) {
  s.sides[0].inventory[key] = count;
  const accepted = E.acceptLaunchDelivery(b, key, count);
  s.sides[0].inventory[key] -= accepted;
  return accepted;
}

test('warehouse stock cannot teleport to a remote rack; physical delivery is finite and key-restricted', () => {
  const s = fresh(),
    b = site(s),
    silo = site(s, 'silo', -750, 170);
  s.sides[0].inventory.drone = 20;
  const before = E.save(s);
  assert.equal(typeof E.launch(s, 0, 'drone', { x: 900, z: 0 }, 1, b.id), 'string');
  assert.equal(E.save(s), before);
  E.updateLaunchSupply(s);
  assert.equal(E.availableLaunchStock(b, 'drone'), 0);
  assert.deepEqual(
    E.launchSupplyRequests(s, 0).find((r) => r.siteId === b.id),
    { siteId: b.id, key: 'drone', amount: 1 },
  );
  assert.equal(E.acceptLaunchDelivery(b, 'ballistic', 1), 0);
  assert.equal(E.acceptLaunchDelivery(silo, 'drone', 1), 0);
  assert.equal(deliver(s, b, 'drone', 20), 6);
  assert.equal(E.weaponStock(s, 0, 'drone'), 20);
  assert.equal(E.launch(s, 0, 'drone', { x: 900, z: 0 }, 6, b.id), 6);
  assert.equal(E.availableLaunchStock(b, 'drone'), 0);
  assert.equal(s.sides[0].inventory.drone, 14);
  assert.equal(
    E.launch(s, 0, 'ballistic', { x: 900, z: 0 }, 1, b.id),
    'Выбранная пусковая недоступна',
  );
});

for (const [level, delays] of [
  [0, [0, 10, 20, 30, 40, 50]],
  [1, [0, 5, 10, 15, 20, 25]],
  [2, [0, 0, 10, 10, 20, 20]],
]) {
  test(`launch level ${level} enforces its finite salvo schedule across independent reservations`, () => {
    const s = fresh(),
      b = site(s);
    b.level = level;
    deliver(s, b, 'drone', 6);
    for (let i = 0; i < 6; i++) assert.equal(E.launch(s, 0, 'drone', { x: 900, z: i }, 1, b.id), 1);
    assert.deepEqual(
      s.units.map((u) => u.delay),
      delays,
    );
    assert.equal(s.units.length, 6);
    assert.equal(E.queuedLaunches(s, b), 6);
  });
}

test('a partial level-two burst cannot reset on the next simulation tick', () => {
  const s = fresh(),
    b = site(s);
  b.level = 2;
  deliver(s, b, 'drone', 6);
  E.launch(s, 0, 'drone', { x: 900, z: 0 }, 1, b.id);
  E.step(s, 0.05);
  E.launch(s, 0, 'drone', { x: 900, z: 0 }, 1, b.id);
  E.launch(s, 0, 'drone', { x: 900, z: 0 }, 1, b.id);
  assert.equal(s.units[1].delay, 0);
  assert.ok(Math.abs(s.units[2].delay - 9.95) < 1e-9);
});

test('save/load preserves a partially consumed burst and upgrades never reschedule paid pending aircraft', () => {
  let s = fresh(),
    b = site(s);
  b.level = 2;
  deliver(s, b, 'drone', 6);
  E.launch(s, 0, 'drone', { x: 900, z: 0 }, 1, b.id);
  const id = b.id;
  s = E.load(E.save(s));
  b = s.buildings.find((site) => site.id === id);
  E.step(s, 0.05);
  E.launch(s, 0, 'drone', { x: 900, z: 0 }, 1, b.id);
  E.launch(s, 0, 'drone', { x: 900, z: 0 }, 1, b.id);
  assert.equal(s.units[1].delay, 0);
  assert.ok(Math.abs(s.units[2].delay - 9.95) < 1e-9);

  s = fresh();
  b = site(s);
  deliver(s, b, 'drone', 6);
  E.launch(s, 0, 'drone', { x: 900, z: 0 }, 2, b.id);
  const reserved = s.units.map((u) => ({ id: u.id, delay: u.delay }));
  const stock = E.availableLaunchStock(b, 'drone');
  assert.equal(E.upgradeDefense(s, 0, b.id), true);
  assert.equal(E.upgradeDefense(s, 0, b.id), true);
  assert.deepEqual(
    s.units.map((u) => ({ id: u.id, delay: u.delay })),
    reserved,
  );
  assert.equal(E.availableLaunchStock(b, 'drone'), stock);
  E.launch(s, 0, 'drone', { x: 900, z: 0 }, 1, b.id);
  assert.equal(s.units.at(-1).delay, 20);
});

test('only a connected factory can stage its warehouse stock internally; factory launch is slow and drone-only', () => {
  const s = fresh(),
    b = site(s, 'factory', -1080, -10);
  s.sides[0].inventory.drone = 7;
  E.updateLaunchSupply(s);
  assert.equal(E.availableLaunchStock(b, 'drone'), 2);
  assert.equal(s.sides[0].inventory.drone, 5);
  assert.equal(E.launch(s, 0, 'drone', { x: 900, z: 0 }, 2, b.id), 2);
  assert.deepEqual(
    s.units.map((u) => u.delay),
    [0, 20],
  );
  assert.equal(E.launchSites(s, 0, 'ballistic').length, 0);
  assert.equal(E.launchStoreCapacity(b, 'ballistic'), 0);
});

test('legacy stock staging conserves purchased weapons and preserves queued aircraft without duplicating reservations', () => {
  const s = fresh(),
    b = site(s);
  s.sides[0].inventory.drone = 20;
  const total = E.weaponStock(s, 0, 'drone');
  const reserved = { id: s.nextId++, side: 0, key: 'drone', sourceId: b.id, hp: 10, delay: 12 };
  s.units.push(reserved);
  E.restoreLaunchSupply(s, 14);
  assert.equal(E.weaponStock(s, 0, 'drone'), total);
  assert.equal(s.units[0], reserved);
  assert.equal(s.units[0].delay, 12);
  const store = structuredClone(b.launchStore);
  E.restoreLaunchSupply(s, 15);
  assert.deepEqual(b.launchStore, store);
  b.launchStore.drone = 7;
  assert.throws(() => E.restoreLaunchSupply(s, 15));
});

test('destroying a new local rack loses its reserved stock rather than refunding it to a distant warehouse', () => {
  const s = fresh(),
    b = site(s);
  deliver(s, b, 'drone', 2);
  E.launch(s, 0, 'drone', { x: 900, z: 0 }, 2, b.id);
  b.hp = 0;
  const stock = s.sides[0].inventory.drone;
  E.step(s, 0.05);
  assert.equal(s.sides[0].inventory.drone, stock);
  assert.equal(s.units.length, 0);
});

test('factory plans count paid stock in local racks and in transit without buying duplicates', () => {
  const s = fresh(),
    factory = site(s, 'factory', -1080, -10),
    rack = site(s);
  s.sides[0].inventory.drone = 0;
  E.acceptLaunchDelivery(rack, 'drone', 1);
  s.ammoVehicles = [
    { side: 0, cargo: { kind: 'weapon', key: 'drone', amount: 1 } },
    { side: 1, cargo: { kind: 'weapon', key: 'drone', amount: 9 } },
  ];
  assert.equal(E.weaponStock(s, 0, 'drone'), 2);
  assert.equal(
    E.setFactoryPlan(s, 0, factory.id, {
      key: 'drone',
      target: 2,
      reserveCredits: 0,
      reserveMaterials: 0,
      enabled: true,
    }),
    true,
  );
  assert.equal(E.factoryPlanStatus(s, 0, factory.id).status, 'stock');
  const credits = s.sides[0].credits;
  updateFactoryPlans(s);
  assert.equal(factory.queue.length, 0);
  assert.equal(s.sides[0].credits, credits);
});

test('a one-drone factory plan physically supplies a remote launcher from its own staged rack without extra production', () => {
  const s = fresh(),
    factory = site(s, 'factory', -1080, -10),
    remote = site(s);
  for (const key of Object.keys(E.WEAPONS)) s.sides[0].inventory[key] = 0;
  const materials = s.sides[0].materials;
  assert.equal(
    E.setFactoryPlan(s, 0, factory.id, {
      key: 'drone',
      target: 1,
      reserveCredits: 0,
      reserveMaterials: 0,
      enabled: true,
    }),
    true,
  );
  E.step(s, 0.05);
  assert.equal(
    E.availableLaunchStock(remote, 'drone'),
    0,
    'paid production and travel take simulation time',
  );
  let transit = false;
  for (let i = 0; i < 799; i++) {
    E.step(s, 0.05);
    transit ||= s.ammoVehicles.some(
      (v) => v.side === 0 && v.cargo?.kind === 'weapon' && v.cargo.key === 'drone',
    );
    assert.ok(
      E.weaponStock(s, 0, 'drone') + (factory.queue?.length || 0) <= 1,
      'a staged or moving drone still satisfies the paid target',
    );
  }
  assert.equal(transit, true, 'the drone must travel inside an actual vehicle');
  assert.equal(
    E.availableLaunchStock(remote, 'drone'),
    1,
    'remote rack fills before the forty-second deadline',
  );
  assert.equal(E.weaponStock(s, 0, 'drone'), 1);
  assert.equal(E.movableWeaponStock(s, 0, 'drone'), 0, 'remote rack is not a warehouse source');
  assert.equal(
    s.events.filter((e) => e.type === 'produced' && e.key === 'drone' && e.side === 0).length,
    1,
  );
  assert.equal(s.sides[0].materials, materials - E.WEAPONS.drone.metal);
});

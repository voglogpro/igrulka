import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { executeCommand } from '../../src/network/commands.js';
import { updateAmmoProduction } from '../../src/game/city/ammo-production.js';
import { damageAmmoVehicle } from '../../src/game/city/ammo-vehicle-damage.js';

function fresh() {
  const s = E.createGame(8916);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  s.rules.oil = false;
  for (const f of s.sides) {
    f.credits = 30000;
    f.materials = 4000;
    for (const key of Object.keys(E.WEAPONS)) f.inventory[key] = 0;
  }
  return s;
}
function ready(s, key, x = -1080, z = -10, side = 0) {
  const b = E.build(s, side, key, x, z);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function fixture() {
  const s = fresh();
  ready(s, 'factory');
  const silo = ready(s, 'silo', -800, 250);
  E.acceptLaunchDelivery(silo, 'cruise', 4);
  s.sides[0].inventory.ballistic = 2;
  return { s, silo };
}
function until(s, predicate, seconds = 100, onTick = () => {}) {
  const end = s.time + seconds;
  while (!predicate() && s.time < end) {
    E.step(s, 0.05);
    onTick();
  }
  assert.ok(predicate(), `condition not reached at ${s.time}`);
}

test('a full silo exchanges paid weapons through real pickup and delivery trips, preserving an in-flight save', () => {
  const { s, silo } = fixture();
  assert.equal(E.requestWeaponDelivery(s, 0, silo.id, 'ballistic', 2), true);
  assert.equal(silo.launchStore.cruise, 4, 'request cannot instantly empty the rack');
  E.step(s, 0.05);
  assert.equal(silo.launchStore.cruise, 4);
  assert.equal(s.sides[0].inventory.ballistic, 2);
  assert.equal(s.ammoVehicles.filter((v) => v.pickup).length, 2);
  const loaded = E.load(E.save(s));
  const compare = (game) => ({
    sides: game.sides,
    stores: game.buildings.map((b) => b.launchStore),
    fleet: game.ammoVehicles.map(({ revision, ...v }) => v),
  });
  until(
    s,
    () => silo.launchStore.ballistic === 2 && s.sides[0].inventory.cruise === 2,
    100,
    () => {
      E.step(loaded, 0.05);
      for (const game of [s, loaded]) {
        assert.equal(E.weaponStock(game, 0, 'cruise'), 4);
        assert.equal(E.weaponStock(game, 0, 'ballistic'), 2);
      }
    },
  );
  assert.equal(silo.launchStore.cruise, 2);
  assert.deepEqual(compare(loaded), compare(s));
  assert.equal(E.ammoLogisticsStatus(s, 0, silo.id).pending, 0);
  assert.equal(E.ammoLogisticsStatus(s, 0, silo.id).status, 'idle');
});

test('changing the requested type cancels unnecessary collections without losing or duplicating stock', () => {
  const { s, silo } = fixture();
  E.requestWeaponDelivery(s, 0, silo.id, 'ballistic', 2);
  E.advance(s, 1);
  assert.ok(s.ammoVehicles.some((v) => v.pickup));
  E.requestWeaponDelivery(s, 0, silo.id, 'cruise', 2);
  E.advance(s, 60);
  assert.equal(silo.launchStore.cruise, 4);
  assert.equal(E.weaponStock(s, 0, 'cruise'), 4);
  assert.equal(E.weaponStock(s, 0, 'ballistic'), 2);
  assert.ok(s.ammoVehicles.every((v) => !v.pickup && !v.cargo));
});

test('reducing a request during pickup never withdraws more weapons than the newly needed slots', () => {
  const { s, silo } = fixture();
  E.requestWeaponDelivery(s, 0, silo.id, 'ballistic', 2);
  E.advance(s, 1);
  E.requestWeaponDelivery(s, 0, silo.id, 'ballistic', 1);
  until(s, () => silo.launchStore.ballistic >= 1 && s.sides[0].inventory.cruise >= 1);
  assert.equal(silo.launchStore.cruise, 3);
  assert.equal(s.sides[0].inventory.cruise, 1);
  assert.equal(E.weaponStock(s, 0, 'cruise'), 4);
});

test('selecting a type before production retains its demand and keeps the current rack usable', () => {
  const { s, silo } = fixture();
  s.sides[0].inventory.ballistic = 0;
  assert.equal(E.requestWeaponDelivery(s, 0, silo.id, 'ballistic', 1), true);
  E.advance(s, 10);
  assert.equal(silo.launchStore.cruise, 4);
  assert.ok(s.ammoVehicles.every((v) => !v.pickup));
  s.sides[0].inventory.ballistic = 1;
  until(s, () => silo.launchStore.ballistic === 1);
  assert.equal(silo.launchStore.cruise, 3);
});

test('a factory prepares its own desired bay locally and can exchange with another factory when its warehouse is empty', () => {
  const s = fresh(),
    a = ready(s, 'factory');
  E.acceptLaunchDelivery(a, 'drone', 2);
  s.sides[0].inventory.heavy = 2;
  assert.equal(E.requestWeaponDelivery(s, 0, a.id, 'heavy', 2), true);
  E.updateLaunchSupply(s);
  assert.equal(a.launchStore.heavy, 2);
  assert.equal(s.sides[0].inventory.drone, 2);
  assert.equal(E.weaponStock(s, 0, 'drone'), 2);
  assert.equal(E.weaponStock(s, 0, 'heavy'), 2);

  assert.equal(typeof E.buildRoad(s, 0, -1105, -45, -1230, -45), 'object');
  const other = ready(s, 'factory', -1200, -10);
  E.acceptLaunchDelivery(other, 'drone', 2);
  s.sides[0].inventory.drone = 0;
  E.requestWeaponDelivery(s, 0, a.id, 'drone', 1);
  until(s, () => a.launchStore.drone >= 1);
  assert.equal(E.weaponStock(s, 0, 'drone'), 2);
  assert.equal(E.weaponStock(s, 0, 'heavy'), 2);
});

test('factory exchanges reserve distinct civic bays and an old occupied bay resumes the same paid delivery after loading', () => {
  const s = fresh(),
    a = ready(s, 'factory');
  E.acceptLaunchDelivery(a, 'drone', 2);
  s.sides[0].inventory.heavy = 2;
  E.requestWeaponDelivery(s, 0, a.id, 'heavy', 2);
  E.updateLaunchSupply(s);
  assert.equal(typeof E.buildRoad(s, 0, -1105, -45, -1230, -45), 'object');
  const b = ready(s, 'factory', -1200, -10);
  E.acceptLaunchDelivery(b, 'drone', 2);
  s.sides[0].inventory.drone = 0;
  E.requestWeaponDelivery(s, 0, a.id, 'drone', 1);
  until(
    s,
    () =>
      s.ammoVehicles.some(
        (v) => v.status === 'outbound' && v.targetId === a.id && v.cargo?.key === 'drone',
      ),
    20,
  );
  const van = s.ammoVehicles.find(
    (v) => v.status === 'outbound' && v.targetId === a.id && v.cargo?.key === 'drone',
  );
  for (const other of s.ammoVehicles)
    if (other !== van) {
      assert.ok(
        Math.hypot(van.goal.x - other.home.x, van.goal.z - other.home.z) >= 6.35,
        'a delivery bay must not reuse another factory vehicle home',
      );
    }
  const blocker = s.ammoVehicles.find((v) => v.depotId === a.id && v.status === 'idle');
  assert.ok(blocker);
  // This is the old saved trip that timed out: the paid destination is another
  // stationary van's exact home. Keep its cargo and let normal logistics retry.
  const blocked = { ...blocker.home };
  van.goal = { ...blocked };
  van.path[van.path.length - 1] = { ...blocked };
  const cold = E.load(E.save(s)),
    copy = cold.ammoVehicles.find((v) => v.id === van.id);
  until(
    s,
    () => Math.hypot(van.goal.x - blocked.x, van.goal.z - blocked.z) > 6.35,
    2.2,
    () => E.step(cold, 0.05),
  );
  assert.deepEqual(van.cargo, { kind: 'weapon', key: 'drone', amount: 1 });
  assert.deepEqual(copy.cargo, van.cargo);
  assert.deepEqual(copy.goal, van.goal);
  until(
    s,
    () => a.launchStore.drone >= 1,
    100,
    () => {
      E.step(cold, 0.05);
      for (const game of [s, cold]) {
        assert.equal(E.weaponStock(game, 0, 'drone'), 2);
        assert.equal(E.weaponStock(game, 0, 'heavy'), 2);
        for (let i = 0; i < game.ammoVehicles.length; i++)
          for (let j = i + 1; j < game.ammoVehicles.length; j++) {
            const x = game.ammoVehicles[i],
              y = game.ammoVehicles[j];
            assert.ok(
              Math.hypot(x.x - y.x, x.z - y.z) >= 6.34,
              'the exchange must never pass through a parked van',
            );
          }
      }
    },
  );
  const fleet = (game) => game.ammoVehicles.map(({ revision, ...v }) => v);
  assert.deepEqual(fleet(cold), fleet(s));
  assert.deepEqual(cold.sides, s.sides);
});

test('losing an empty pickup vehicle cannot destroy weapons still inside the launch rack', () => {
  const { s, silo } = fixture();
  E.requestWeaponDelivery(s, 0, silo.id, 'ballistic', 1);
  E.step(s, 0.05);
  const van = s.ammoVehicles.find((v) => v.pickup);
  damageAmmoVehicle(s, van, van.hp);
  assert.equal(van.pickup, null);
  assert.equal(silo.launchStore.cruise, 4);
  assert.equal(E.weaponStock(s, 0, 'cruise'), 4);
  assert.doesNotThrow(() => E.load(E.save(s)));
  until(s, () => silo.launchStore.ballistic >= 1);
});

test('launch preferences are authenticated and malformed commands cannot mutate paid state', () => {
  const { s, silo } = fixture();
  for (const [side, args] of [
    [1, { id: silo.id, key: 'ballistic', count: 1 }],
    [0, { id: silo.id, key: 'drone', count: 1 }],
    ...[0, 7, 0.5, '1'].map((count) => [0, { id: silo.id, key: 'ballistic', count }]),
    [0, { id: silo.id, key: '__proto__', count: 1 }],
  ]) {
    const before = E.save(s);
    assert.equal(typeof executeCommand(s, side, 'launch-supply', args), 'string');
    assert.equal(E.save(s), before);
  }
  assert.equal(
    executeCommand(s, 0, 'launch-supply', { id: silo.id, key: 'ballistic', count: 2 }),
    true,
  );
});

test('production expenses count actual paid batches and old saves acquire a zero starting statistic', () => {
  const s = fresh(),
    b = ready(s, 'ammofactory');
  s.groundUnits.push(E.makeGround(s, 0, 'leopard', -950, 250));
  const before = s.sides[0].credits;
  updateAmmoProduction(s);
  assert.equal(s.sides[0].ammoStock.shell, 6);
  assert.equal(s.sides[0].credits, before - 24);
  assert.equal(s.sides[0].ammoProductionSpent, 24);
  b.ammoEnabled = false;
  E.advance(s, 3);
  assert.equal(s.sides[0].ammoProductionSpent, 24);
  const old = JSON.parse(E.save(s));
  old.version = 15;
  for (const f of old.sides) delete f.ammoProductionSpent;
  const loaded = E.load(JSON.stringify(old));
  assert.equal(loaded.version, E.VERSION);
  assert.equal(loaded.sides[0].ammoProductionSpent, 0);
  for (const invalid of [-1, '24']) {
    const broken = structuredClone(s);
    broken.sides[0].ammoProductionSpent = invalid;
    assert.throws(() => E.load(E.save(broken)));
  }
});

test('pickup saves validate empty cargo, compatible targets and trip state', () => {
  const { s, silo } = fixture();
  E.requestWeaponDelivery(s, 0, silo.id, 'ballistic', 1);
  E.step(s, 0.05);
  const i = s.ammoVehicles.findIndex((v) => v.pickup);
  for (const patch of [
    { cargo: { kind: 'weapon', key: 'cruise', amount: 1 } },
    { pickup: { key: 'drone', amount: 1 } },
    { pickup: { key: 'cruise', amount: 2 } },
    { status: 'idle' },
    { targetId: null, targetKind: null },
  ]) {
    const broken = structuredClone(s);
    Object.assign(broken.ammoVehicles[i], patch);
    assert.throws(() => E.load(E.save(broken)));
  }
});

test('version 15 pending orders migrate to one local target while version 16 rejects conflicting targets', () => {
  const { s, silo } = fixture();
  silo.launchStore.cruise = 2;
  silo.weaponDemand = { cruise: 1, ballistic: 2 };
  assert.throws(() => E.load(E.save(s)));
  const old = JSON.parse(E.save(s));
  old.version = 15;
  const migrated = E.load(JSON.stringify(old));
  const site = migrated.buildings.find((b) => b.id === silo.id);
  assert.deepEqual(site.weaponDemand, { ballistic: 2 });
  assert.equal(site.launchStore.cruise, 2);
  assert.equal(E.weaponStock(migrated, 0, 'ballistic'), E.weaponStock(s, 0, 'ballistic'));
  assert.deepEqual(
    E.load(E.save(migrated)).buildings.find((b) => b.id === silo.id).weaponDemand,
    site.weaponDemand,
  );
});

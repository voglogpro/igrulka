import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

const plan = (changes = {}) => ({
  key: 'drone',
  target: 3,
  reserveCredits: 500,
  reserveMaterials: 50,
  enabled: true,
  ...changes,
});
function fresh() {
  const s = E.createGame(826);
  s.mode = 'multiplayer';
  for (const side of s.sides) {
    side.credits = 100000;
    side.materials = 10000;
    side.components = 120;
  }
  return s;
}
function ready(s, key, x, z, side = 0) {
  const b = E.build(s, side, key, x, z);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function factory(s, side = 0, powered = true) {
  const sign = side === 0 ? -1 : 1;
  const b = ready(s, 'factory', sign * (E.HQ_X + 65), -10, side);
  if (powered) ready(s, 'power', sign * (E.HQ_X + 55), -80, side);
  return b;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const status = (s, b) => E.factoryPlanStatus(s, b.side, b.id);
const set = (s, b, changes) => assert.equal(E.setFactoryPlan(s, b.side, b.id, plan(changes)), true);

test('factory plans validate strict bounded fields and store only their configuration', () => {
  const s = fresh(),
    b = factory(s);
  const invalid = [
    null,
    [],
    {},
    ...['constructor', '__proto__', 'missing'].map((key) => plan({ key })),
    ...[0, 31, 1.5, '3', NaN].map((target) => plan({ target })),
    ...[-1, 10001, Infinity, '5'].map((reserveCredits) => plan({ reserveCredits })),
    ...[-1, 1001, NaN].map((reserveMaterials) => plan({ reserveMaterials })),
    plan({ enabled: 'yes' }),
  ];
  set(s, b, {});
  const original = structuredClone(b.productionPlan);
  for (const value of invalid) {
    assert.equal(E.isFactoryPlan(value), false);
    assert.equal(typeof E.setFactoryPlan(s, 0, b.id, value), 'string');
    assert.deepEqual(b.productionPlan, original);
  }
  assert.equal(
    E.isFactoryPlan(plan({ target: 30, reserveCredits: 10000, reserveMaterials: 1000 })),
    true,
  );
  assert.equal(
    E.setFactoryPlan(s, 0, b.id, { ...plan(), income: 1e9, queue: [{ key: 'ballistic' }] }),
    true,
  );
  assert.deepEqual(b.productionPlan, plan());
  assert.equal(typeof E.setFactoryPlan(s, 1, b.id, plan()), 'string');
  assert.equal(E.factoryPlanStatus(s, 1, b.id), null);
  assert.equal(E.factoryPlanStatus(s, 0, s.buildings[0].id), null);
});

test('produce targets the selected factory, preserves legacy calls and rejects prototype keys without charging', () => {
  const s = fresh(),
    a = factory(s),
    b = ready(s, 'factory', -1142, -10);
  const credits = s.sides[0].credits;
  assert.equal(E.produce(s, 0, 'drone', 2, b.id), true);
  assert.equal(a.queue.length, 0);
  assert.equal(b.queue.length, 2);
  near(s.sides[0].credits, credits - 2 * E.WEAPONS.drone.cost);
  assert.equal(E.produce(s, 0, 'drone'), true);
  assert.equal(a.queue.length, 1, 'legacy auto-selection must still use the shortest queue');
  const before = E.save(s);
  for (const key of ['constructor', '__proto__', 'missing'])
    assert.equal(typeof E.produce(s, 0, key, 1, b.id), 'string');
  for (const id of [0, -1, b.id + 100, String(b.id), s.buildings[1].id])
    assert.equal(typeof E.produce(s, 0, 'drone', 1, id), 'string');
  assert.equal(E.save(s), before);
});

test('the shared cap and stock include paid queues at all live factories, including an unfinished one', () => {
  const s = fresh(),
    a = factory(s),
    b = ready(s, 'factory', -1142, -10);
  b.progress = 0.5;
  b.queue = Array.from({ length: 23 }, () => ({ key: 'drone', progress: 0 }));
  set(s, a, { target: 30 });
  assert.equal(status(s, a).queued, 23);
  assert.equal(E.produce(s, 0, 'drone', 1, a.id), true);
  assert.equal(status(s, a).sideQueued, 24);
  assert.equal(status(s, a).status, 'queue');
  const before = E.save(s);
  assert.match(E.produce(s, 0, 'drone', 1, a.id), /заполнена/);
  E.updateFactoryPlans(s);
  assert.equal(E.save(s), before);
  b.hp = 0;
  assert.equal(
    status(s, a).queued,
    1,
    'destroyed paid queues cannot block surviving factories forever',
  );
});

test('two planned factories never buy beyond the common target or insert more than one item per empty factory', () => {
  const s = fresh(),
    a = factory(s),
    b = ready(s, 'factory', -1142, -10);
  set(s, a, { target: 1 });
  set(s, b, { target: 1 });
  const before = s.sides[0].credits;
  E.updateFactoryPlans(s);
  assert.equal(a.queue.length + b.queue.length, 1);
  near(s.sides[0].credits, before - E.WEAPONS.drone.cost);
  set(s, a, { target: 3 });
  set(s, b, { target: 3 });
  E.updateFactoryPlans(s);
  assert.equal(a.queue.length, 1);
  assert.equal(b.queue.length, 1);
  for (let i = 0; i < 1600; i++) {
    E.step(s, 0.05);
    assert.ok(status(s, a).stock <= 3);
    assert.ok(a.queue.length <= 1 && b.queue.length <= 1);
  }
  assert.equal(E.weaponStock(s, 0, 'drone'), 3);
  assert.equal(status(s, a).status, 'stock');
  assert.equal(status(s, b).status, 'stock');
});

test('credits and materials reserves are enforced after payment, including the exact boundary', () => {
  const s = fresh(),
    b = factory(s),
    f = s.sides[0],
    d = E.WEAPONS.drone;
  set(s, b, { reserveCredits: 500, reserveMaterials: 50 });
  f.credits = 500 + d.cost - 0.01;
  f.materials = 50 + d.metal;
  assert.equal(status(s, b).status, 'credits');
  E.updateFactoryPlans(s);
  assert.equal(b.queue.length, 0);
  f.credits = 500 + d.cost;
  f.materials = 50 + d.metal - 0.01;
  assert.equal(status(s, b).status, 'materials');
  E.updateFactoryPlans(s);
  assert.equal(b.queue.length, 0);
  f.materials = 50 + d.metal;
  assert.equal(status(s, b).status, 'active');
  E.updateFactoryPlans(s);
  near(f.credits, 500);
  near(f.materials, 50);
  assert.equal(b.queue.length, 1);
  b.queue = [];
  set(s, b, { reserveCredits: 0.1, reserveMaterials: 0.1 });
  f.credits = d.cost + 0.1;
  f.materials = d.metal + 0.1;
  E.updateFactoryPlans(s);
  assert.ok(
    f.credits >= 0.1 && f.materials >= 0.1,
    'fractional boundary rounding must not let the actual payment undercut either reserve',
  );
  f.credits += 0.001;
  f.materials += 0.001;
  E.updateFactoryPlans(s);
  assert.equal(b.queue.length, 1);
  assert.ok(f.credits >= 0.1 && f.materials >= 0.1);
});

test('a single initialized simulation produces until its reserve and resumes only after replenishment', () => {
  const s = fresh(),
    b = factory(s),
    f = s.sides[0],
    d = E.WEAPONS.drone;
  set(s, b, { target: 4, reserveCredits: 1000, reserveMaterials: 50 });
  f.credits = 1000 + 4 * d.cost + 100;
  f.materials = 50 + 2 * d.metal;
  E.advance(s, 40);
  assert.equal(E.weaponStock(s, 0, 'drone'), 2);
  assert.equal(b.queue.length, 0);
  assert.equal(status(s, b).status, 'materials');
  near(f.materials, 50);
  assert.ok(f.credits >= 1000);
  f.materials += d.metal;
  E.advance(s, 13);
  assert.equal(E.weaponStock(s, 0, 'drone'), 3);
  near(f.materials, 50);
  assert.equal(status(s, b).status, 'materials');
});

test('reaching stock stops purchases and a real launch triggers exactly one paid replacement', () => {
  const s = fresh(),
    b = factory(s),
    f = s.sides[0];
  const launcher = ready(s, 'launcher', -1042, 100);
  set(s, b, { target: 2 });
  E.advance(s, 30);
  assert.equal(E.weaponStock(s, 0, 'drone'), 2);
  assert.equal(status(s, b).status, 'stock');
  while (!E.availableLaunchStock(launcher, 'drone') && s.time < 60) E.step(s, 0.05);
  assert.ok(E.availableLaunchStock(launcher, 'drone') > 0);
  const materials = f.materials;
  assert.equal(E.launch(s, 0, 'drone', { x: 692, z: 400 }, 1, launcher.id), 1);
  assert.equal(E.weaponStock(s, 0, 'drone'), 1);
  E.advance(s, 15);
  assert.equal(E.weaponStock(s, 0, 'drone'), 2);
  assert.equal(b.queue.length, 0);
  near(f.materials, materials - E.WEAPONS.drone.metal);
  assert.equal(s.events.filter((event) => event.type === 'produced' && event.side === 0).length, 3);
});

test('disabling and changing the plan preserve every paid item and its progress', () => {
  const s = fresh(),
    b = factory(s);
  set(s, b, { target: 30 });
  E.advance(s, 2);
  const paid = structuredClone(b.queue);
  set(s, b, { enabled: false });
  assert.deepEqual(b.queue, paid);
  assert.equal(status(s, b).status, 'disabled');
  E.advance(s, 13);
  assert.equal(E.weaponStock(s, 0, 'drone'), 1);
  assert.equal(b.queue.length, 0);
  assert.equal(E.produce(s, 0, 'drone', 1, b.id), true);
  set(s, b, { key: 'heavy', target: 2 });
  assert.equal(status(s, b).status, 'queue');
  E.advance(s, 13);
  assert.equal(E.weaponStock(s, 0, 'drone'), 2);
  assert.equal(b.queue.length, 1);
  assert.equal(b.queue[0].key, 'heavy');
});

test('formerly locked plans import, disable and produce ordinary paid stock without research', () => {
  const s = fresh(),
    b = factory(s);
  set(s, b, { key: 'heavy', target: 1 });
  const restored = E.load(E.save(s));
  const r = restored.buildings.find((u) => u.id === b.id);
  assert.equal(status(restored, r).status, 'active');
  set(restored, r, { key: 'heavy', target: 1, enabled: false });
  E.advance(restored, 1);
  assert.equal(r.queue.length, 0);
  set(restored, r, { key: 'heavy', target: 1 });
  const materials = restored.sides[0].materials;
  E.advance(restored, E.WEAPONS.heavy.time + 1);
  assert.equal(E.weaponStock(restored, 0, 'heavy'), 1);
  near(restored.sides[0].materials, materials - E.WEAPONS.heavy.metal);
  assert.deepEqual(restored.sides[0].tech, []);
});

test('each supported weapon is paid at its own price and actually completes without research', () => {
  for (const key of Object.keys(E.WEAPONS)) {
    const s = fresh(),
      b = factory(s),
      d = E.WEAPONS[key];
    set(s, b, { key, target: 1 });
    const materials = s.sides[0].materials;
    E.advance(s, d.time + 1);
    assert.equal(E.weaponStock(s, 0, key), 1, key);
    assert.equal(b.queue.length, 0, key);
    near(s.sides[0].materials, materials - d.metal);
    assert.equal(status(s, b).status, 'stock');
  }
});

test('a saved plan on an unfinished factory buys only on the tick after real completion', () => {
  const s = fresh(),
    b = factory(s);
  set(s, b, { target: 1 });
  b.progress = 0.999;
  const materials = s.sides[0].materials;
  E.step(s, 0.05);
  assert.equal(b.progress, 1);
  assert.equal(b.queue.length, 0);
  near(s.sides[0].materials, materials);
  E.step(s, 0.05);
  assert.equal(b.queue.length, 1);
  assert.ok(b.queue[0].progress > 0);
  near(s.sides[0].materials, materials - E.WEAPONS.drone.metal);
});

test('ruins, construction, completion of the campaign and a paused tick cannot buy items', () => {
  for (const condition of ['ruined', 'building', 'finished']) {
    const s = fresh(),
      b = factory(s);
    set(s, b, {});
    if (condition === 'ruined') b.hp = 0;
    if (condition === 'building') b.progress = 0.5;
    if (condition === 'finished') s.result = 'victory';
    assert.equal(status(s, b).status, condition);
    const before = E.save(s);
    E.updateFactoryPlans(s);
    E.step(s, 0);
    assert.equal(E.save(s), before);
    assert.equal(typeof E.setFactoryPlan(s, 0, b.id, plan()), 'string');
  }
});

test('roads and electricity retain their ordinary effects on planned production speed', () => {
  const fast = fresh(),
    powered = factory(fast);
  set(fast, powered, { target: 1 });
  const isolated = E.load(E.save(fast));
  const cut = isolated.roads.find(
    (r) => r.side === 0 && r.camp && r.ax < -E.HQ_X && r.bx > -E.HQ_X,
  );
  E.damageRoad(isolated, cut, 100);
  const slow = fresh(),
    unpowered = factory(slow, 0, false);
  set(slow, unpowered, { target: 1 });
  E.advance(fast, 6);
  E.advance(isolated, 6);
  E.advance(slow, 6);
  const disconnected = isolated.buildings.find((b) => b.id === powered.id);
  near(powered.queue[0].progress, 0.5);
  assert.ok(disconnected.queue[0].progress < powered.queue[0].progress * 0.3);
  assert.ok(unpowered.queue[0].progress < powered.queue[0].progress);
  assert.ok(unpowered.queue[0].progress > disconnected.queue[0].progress);
});

test('two human sides replenish independently and produce identical stocks from equal reserves', () => {
  const s = fresh(),
    a = factory(s, 0),
    b = factory(s, 1);
  set(s, a, { target: 2 });
  set(s, b, { target: 2 });
  E.advance(s, 30);
  assert.equal(E.weaponStock(s, 0, 'drone'), 2);
  assert.equal(E.weaponStock(s, 1, 'drone'), 2);
  near(s.sides[0].materials, s.sides[1].materials);
  near(s.sides[0].credits, s.sides[1].credits);
  assert.deepEqual(status(s, a), status(s, b));
});

test('plan and paid progress survive save/load and complete with identical time and resources', () => {
  const s = fresh(),
    b = factory(s);
  set(s, b, { target: 2 });
  E.advance(s, 3);
  const loaded = E.load(E.save(s));
  const restored = loaded.buildings.find((u) => u.id === b.id);
  assert.deepEqual(restored.productionPlan, b.productionPlan);
  assert.deepEqual(restored.queue, b.queue);
  E.advance(s, 30);
  E.advance(loaded, 30);
  assert.deepEqual(loaded.sides, s.sides);
  assert.deepEqual(status(loaded, restored), status(s, b));
  for (const change of [
    (s) => {
      s.buildings.find((u) => u.id === b.id).productionPlan.key = '__proto__';
    },
    (s) => {
      s.buildings.find((u) => u.id === b.id).productionPlan.reserveMaterials = -1;
    },
    (s) => {
      s.buildings[0].productionPlan = plan();
    },
  ]) {
    const broken = E.load(E.save(s));
    change(broken);
    assert.throws(() => E.load(E.save(broken)), /план/i);
  }
});

test('plans report missing electronics and full local warehouses without repeatedly charging or queuing', () => {
  const s = fresh(),
    b = factory(s),
    f = s.sides[0];
  s.rules.components = true;
  f.components = 0;
  set(s, b, { target: 30 });
  assert.equal(status(s, b).status, 'components');
  assert.match(status(s, b).reason, /электроники/);
  const before = E.save(s);
  for (let i = 0; i < 20; i++) E.updateFactoryPlans(s);
  assert.equal(E.save(s), before);
  f.components = E.WEAPONS.drone.components;
  assert.equal(status(s, b).status, 'active');
  E.updateFactoryPlans(s);
  assert.equal(b.queue.length, 1);
  assert.equal(f.components, 0);
  b.queue = [];
  E.acceptLaunchDelivery(b, 'heavy', E.launchStoreCapacity(b));
  assert.equal(status(s, b).status, 'warehouse');
  const full = E.save(s);
  for (let i = 0; i < 20; i++) E.updateFactoryPlans(s);
  assert.equal(E.save(s), full);
});

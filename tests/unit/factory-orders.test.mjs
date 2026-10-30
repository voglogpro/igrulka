import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateFactoryPlans } from '../../src/game/units/aviation/factory-plans.js';
import { restoreFactoryOrders } from '../../src/game/units/aviation/factory-orders.js';
import { updateConstruction } from '../../src/game/city/update.js';
import { executeCommand } from '../../src/network/commands.js';
import { playerView } from '../../src/network/perspective.js';
import { factoryOrderQuantity, updateFactoryOrderRows } from '../../src/ui/factory-orders.js';

function fresh(coop = false) {
  const s = E.createGame(8133, { mode: coop ? 'coop' : 'multiplayer' });
  for (const f of s.sides) {
    f.credits = 1e5;
    f.materials = 1e4;
    f.oil = 200;
    f.components = 120;
    f.rearAuto = false;
  }
  return s;
}
function factory(s, side = 0, offset = 0) {
  const hq = s.buildings.find((b) => b.side === side && b.key === 'hq');
  const b = E.build(s, side, 'factory', hq.x + (side % 2 ? 65 : -65), hq.z - 10 - offset);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
const resources = (f) => [f.credits, f.materials, f.oil, f.components];
const finish = (s, key = 'drone') =>
  updateConstruction(
    s,
    s.sides.map(() => ({ productivity: 1 })),
    E.WEAPONS[key].time * 10,
  );
const report = (s, b, key = null) => E.factoryOrderStatus(s, b.side, b.id, key);

test('20 requested without resources: no upfront charge or paid entry, then exactly one paid physical unit at a time', () => {
  const s = fresh(),
    b = factory(s),
    f = s.sides[0],
    d = E.WEAPONS.drone;
  [f.credits, f.materials, f.oil, f.components] = [0, 0, 0, 0];
  assert.equal(E.queueFactoryOrder(s, 0, 'drone', 20, b.id), true);
  assert.deepEqual(resources(f), [0, 0, 0, 0]);
  assert.equal(b.queue.length, 0);
  assert.equal(E.weaponStock(s, 0, 'drone'), 0);
  updateFactoryPlans(s);
  assert.equal(report(s, b).unpaid, 20);
  assert.equal(report(s, b).orders[0].status, 'credits');
  [f.credits, f.materials, f.oil, f.components] = [d.cost, d.metal, d.oil, d.components];
  updateFactoryPlans(s);
  assert.deepEqual(resources(f), [0, 0, 0, 0]);
  assert.equal(b.queue.length, 1);
  assert.equal(report(s, b).unpaid, 19);
  assert.equal(E.weaponStock(s, 0, 'drone'), 0);
  updateFactoryPlans(s);
  assert.equal(b.queue.length, 1);
  assert.equal(report(s, b).unpaid, 19);
  finish(s);
  assert.equal(b.queue.length, 0);
  assert.equal(E.weaponStoreStock(b, 'drone'), 1);
  updateFactoryPlans(s);
  assert.equal(report(s, b).unpaid, 19);
});

test('each missing resource is a waiting state, status is pure and the next item pays only after all four exist', () => {
  for (const [field, status] of [
    ['credits', 'credits'],
    ['materials', 'materials'],
    ['oil', 'oil'],
    ['components', 'components'],
  ]) {
    const s = fresh(),
      b = factory(s),
      f = s.sides[0];
    f[field] = 0;
    E.queueFactoryOrder(s, 0, 'drone', 10, b.id);
    const before = E.save(s);
    assert.equal(report(s, b).orders[0].status, status);
    assert.equal(E.save(s), before);
    updateFactoryPlans(s);
    assert.equal(b.queue.length, 0);
    assert.equal(report(s, b).unpaid, 10);
    assert.equal(f[field], 0);
    f[field] = 1000;
    updateFactoryPlans(s);
    assert.equal(b.queue.length, 1);
    assert.equal(report(s, b).unpaid, 9);
  }
});

test('finite FIFO repeated clicks accumulate; cancelling unpaid never refunds or removes paid manufacture', () => {
  const s = fresh(),
    b = factory(s);
  E.queueFactoryOrder(s, 0, 'drone', 10, b.id);
  E.queueFactoryOrder(s, 0, 'drone', 10, b.id);
  E.queueFactoryOrder(s, 0, 'heavy', 2, b.id);
  assert.deepEqual(b.productionOrders, [
    { key: 'drone', remaining: 20 },
    { key: 'heavy', remaining: 2 },
  ]);
  updateFactoryPlans(s);
  assert.equal(b.queue[0].key, 'drone');
  const paid = structuredClone(b.queue),
    balance = resources(s.sides[0]);
  E.cancelFactoryOrders(s, 0, 'drone', b.id);
  assert.deepEqual(resources(s.sides[0]), balance);
  assert.deepEqual(b.queue, paid);
  assert.deepEqual(b.productionOrders, [{ key: 'heavy', remaining: 2 }]);
  finish(s);
  updateFactoryPlans(s);
  assert.equal(b.queue[0].key, 'heavy');
  assert.equal(report(s, b).unpaid, 1);
});

test('paid queue24 and full local warehouse block payment without rejecting an unpaid batch', () => {
  const s = fresh(),
    b = factory(s);
  for (let i = 0; i < 4; i++) assert.equal(E.produce(s, 0, 'drone', 6, b.id), true);
  assert.equal(E.queueFactoryOrder(s, 0, 'drone', 100, b.id), true);
  const balance = resources(s.sides[0]);
  updateFactoryPlans(s);
  assert.equal(report(s, b).unpaid, 100);
  assert.deepEqual(resources(s.sides[0]), balance);
  b.queue = [];
  b.launchStore = { drone: E.launchStoreCapacity(b), heavy: 0, cruise: 0, ballistic: 0 };
  updateFactoryPlans(s);
  assert.equal(report(s, b).orders[0].status, 'warehouse');
  assert.deepEqual(resources(s.sides[0]), balance);
  b.launchStore.drone--;
  updateFactoryPlans(s);
  assert.equal(report(s, b).unpaid, 99);
  assert.equal(b.queue.length, 1);
});

test('finite side pending prevents duplicate automatic stock orders and has priority at its own factory', () => {
  const s = fresh(),
    a = factory(s),
    b = E.build(s, 0, 'factory', -1142, -10);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp;
  const plan = {
    key: 'drone',
    target: 5,
    reserveCredits: 500,
    reserveMaterials: 20,
    enabled: true,
  };
  E.setFactoryPlan(s, 0, b.id, plan);
  E.queueFactoryOrder(s, 0, 'drone', 20, a.id);
  const balance = resources(s.sides[0]);
  updateFactoryPlans(s);
  assert.equal(a.queue.length, 1);
  assert.equal(b.queue.length, 0);
  assert.equal(E.factoryPlanStatus(s, 0, b.id).status, 'orders');
  assert.equal(balance[0] - s.sides[0].credits, E.WEAPONS.drone.cost);
  E.cancelFactoryOrders(s, 0, 'drone');
  updateFactoryPlans(s);
  assert.equal(b.queue.length, 1);
});

test('save/load preserves paid progress and unpaid intentions exactly; old saves default to no finite orders', () => {
  const s = fresh(),
    b = factory(s);
  E.queueFactoryOrder(s, 0, 'drone', 20, b.id);
  updateFactoryPlans(s);
  b.queue[0].progress = 0.4;
  const restored = E.load(E.save(s)),
    r = restored.buildings.find((v) => v.id === b.id);
  assert.deepEqual(r.queue, b.queue);
  assert.deepEqual(r.productionOrders, b.productionOrders);
  assert.deepEqual(resources(restored.sides[0]), resources(s.sides[0]));
  updateFactoryPlans(restored);
  assert.deepEqual(r.queue, b.queue);
  assert.equal(report(restored, r).unpaid, 19);
  delete b.productionOrders;
  assert.equal(E.factoryOrderStatus(E.load(E.save(s)), 0).unpaid, 0);
});

test('ruined and demolished factories discard only unpaid promises, never credit resources', () => {
  for (const field of ['hp', 'demolished']) {
    const s = fresh(),
      b = factory(s);
    E.queueFactoryOrder(s, 0, 'drone', 20, b.id);
    updateFactoryPlans(s);
    const balance = resources(s.sides[0]),
      paid = structuredClone(b.queue);
    b[field] = field === 'hp' ? 0 : true;
    updateFactoryPlans(s);
    assert.deepEqual(b.productionOrders, []);
    assert.deepEqual(resources(s.sides[0]), balance);
    assert.deepEqual(b.queue, paid);
    b.productionOrders = [{ key: 'heavy', remaining: 10 }];
    restoreFactoryOrders(s);
    assert.deepEqual(b.productionOrders, []);
  }
});

test('request limits and malformed saves reject atomically; finite limit is independent of paid queue capacity', () => {
  const s = fresh(),
    b = factory(s);
  for (const count of [0, -1, 101, 1.1, NaN, '10']) {
    const before = E.save(s);
    assert.equal(typeof E.queueFactoryOrder(s, 0, 'drone', count, b.id), 'string');
    assert.equal(E.save(s), before);
  }
  for (let i = 0; i < 10; i++) assert.equal(E.queueFactoryOrder(s, 0, 'drone', 100, b.id), true);
  const before = E.save(s);
  assert.equal(typeof E.queueFactoryOrder(s, 0, 'drone', 1, b.id), 'string');
  assert.equal(E.save(s), before);
  for (const orders of [
    [{ key: 'drone', remaining: 0 }],
    [{ key: 'constructor', remaining: 1 }],
    [{ key: 'drone', remaining: 1001 }],
    Array.from({ length: 65 }, () => ({ key: 'drone', remaining: 1 })),
    {},
    [{ key: 'drone', remaining: '10' }],
  ]) {
    const copy = JSON.parse(before);
    copy.buildings.find((v) => v.id === b.id).productionOrders = orders;
    assert.throws(() => E.load(JSON.stringify(copy)));
  }
});

test('authoritative commands cannot operate on another city and private orders stay private from co-op allies', () => {
  const s = fresh(true),
    a = factory(s, 0),
    ally = factory(s, 2),
    enemy = factory(s, 1);
  for (const id of [ally.id, enemy.id]) {
    const before = E.save(s);
    assert.equal(
      typeof executeCommand(s, 0, 'factory-order', { key: 'drone', count: 20, id }),
      'string',
    );
    assert.equal(E.save(s), before);
  }
  assert.equal(
    executeCommand(s, 0, 'factory-order', { key: 'drone', count: 20, id: a.id, side: 2 }),
    true,
  );
  assert.equal(report(s, a).unpaid, 20);
  assert.equal(report(s, ally).unpaid, 0);
  E.queueFactoryOrder(s, 2, 'heavy', 10, ally.id);
  E.queueFactoryOrder(s, 1, 'ballistic', 10, enemy.id);
  const view = playerView(s, 0);
  assert.equal(view.buildings.find((b) => b.id === a.id).productionOrders[0].remaining, 20);
  for (const id of [ally.id, enemy.id])
    assert.equal(
      Object.hasOwn(
        view.buildings.find((b) => b.id === id),
        'productionOrders',
      ),
      false,
    );
  assert.equal(
    typeof executeCommand(s, 0, 'factory-order-cancel', { key: 'heavy', id: ally.id }),
    'string',
  );
  assert.equal(report(s, ally).unpaid, 10);
  assert.equal(executeCommand(s, 2, 'factory-order-cancel', { key: 'heavy', id: ally.id }), true);
  assert.equal(report(s, ally).unpaid, 0);
});

test('compact UI admits a poor player batch20, shows waiting and cancellation, and validates quantity', () => {
  const s = fresh(),
    b = factory(s);
  s.sides[0].credits = 0;
  E.queueFactoryOrder(s, 0, 'drone', 20, b.id);
  const nodes = new Map(),
    root = {
      querySelector(selector) {
        if (!nodes.has(selector))
          nodes.set(selector, { value: '20', textContent: '', disabled: false, hidden: true });
        return nodes.get(selector);
      },
    };
  const before = E.save(s);
  updateFactoryOrderRows(s, root);
  assert.equal(E.save(s), before);
  assert.equal(root.querySelector('[data-produce="drone"]').disabled, false);
  assert.equal(root.querySelector('[data-produce="drone"]').textContent, '+20');
  assert.match(root.querySelector('[data-production-pending="drone"]').textContent, /20/);
  assert.match(root.querySelector('[data-production-pending="drone"]').title, /20/);
  assert.equal(root.querySelector('[data-cancel-production="drone"]').hidden, false);
  for (const value of ['', 0, 101, '1.5', 'abc'])
    assert.equal(factoryOrderQuantity({ value }), null);
  root.querySelector('#factory-order-count').value = '101';
  updateFactoryOrderRows(s, root);
  assert.equal(root.querySelector('[data-produce="drone"]').disabled, true);
});

test('64 FIFO groups permit only adjacent merging; full-group UI rejects new keys without losing paid work', () => {
  const s = fresh(),
    b = factory(s);
  for (let i = 0; i < 64; i++)
    assert.equal(E.queueFactoryOrder(s, 0, i % 2 ? 'heavy' : 'drone', 1, b.id), true);
  assert.equal(b.productionOrders.length, 64);
  const before = E.save(s);
  assert.equal(typeof E.queueFactoryOrder(s, 0, 'drone', 1, b.id), 'string');
  assert.equal(E.save(s), before);
  assert.equal(report(s, b, 'drone').canOrder, false);
  assert.equal(report(s, b, 'heavy').canOrder, true);
  assert.equal(E.queueFactoryOrder(s, 0, 'heavy', 20, b.id), true);
  assert.equal(b.productionOrders.at(-1).remaining, 21);
});

test('the actual production pipeline finishes a finite20 then stops without restocking or advance payment', () => {
  const s = fresh(),
    b = factory(s),
    f = s.sides[0],
    d = E.WEAPONS.drone,
    before = resources(f);
  assert.equal(E.queueFactoryOrder(s, 0, 'drone', 20, b.id), true);
  for (let i = 0; i < 20; i++) {
    updateFactoryPlans(s);
    assert.equal(b.queue.length, 1);
    assert.equal(report(s, b).unpaid, 19 - i);
    assert.equal(E.weaponStoreStock(b, 'drone'), i);
    finish(s);
    assert.equal(E.weaponStoreStock(b, 'drone'), i + 1);
  }
  assert.deepEqual(resources(f), [
    before[0] - d.cost * 20,
    before[1] - d.metal * 20,
    before[2] - d.oil * 20,
    before[3] - d.components * 20,
  ]);
  const completed = E.save(s);
  updateFactoryPlans(s);
  assert.equal(E.save(s), completed);
  b.launchStore.drone--;
  updateFactoryPlans(s);
  assert.equal(b.queue.length, 0);
  assert.equal(report(s, b).unpaid, 0);
});

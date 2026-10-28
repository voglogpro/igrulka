import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import * as E from '../../src/game/index.js';
import { executeCommand } from '../../src/network/commands.js';

// Ordinary prices, health, durations, stores and oil rules. The second city is
// an idle human slot so this scenario isolates the economy/production pipeline.
let s = E.createGame(8133, { mode: 'multiplayer' });
const purchases = [],
  events = [];
const trunk = E.buildRoad(s, 0, -1015, -45, -1015, -645);
assert.notEqual(typeof trunk, 'string', trunk);
for (const key of [
  'housing',
  'industry',
  'power',
  'barracks',
  'vehiclebase',
  'ammofactory',
  'factory',
  'housing',
  'industry',
  'power',
  'housing',
  'industry',
  'housing',
  'electronics',
]) {
  let building;
  for (let retry = 0; retry < 40 && !building; retry++) {
    for (let z = -165; z >= -615 && !building; z -= 45) {
      for (const x of [-1045, -985]) {
        if (E.canPlace(s, key, x, z, 0)) continue;
        const result = E.build(s, 0, key, x, z);
        if (typeof result === 'object') {
          building = result;
          break;
        }
      }
    }
    if (!building) E.advance(s, 20);
  }
  assert.ok(building, `ordinary budget could not build ${key}`);
  E.advance(s, E.BUILDINGS[key].time + 1);
  purchases.push({ key, id: building.id, time: s.time, credits: s.sides[0].credits });
}
const before = E.economy(s, 0);
assert.ok(before.connected >= 14 && before.net > 0);
assert.equal(executeCommand(s, 0, 'demolish', { id: trunk.id }), true);
const isolated = E.economy(s, 0);
assert.ok(isolated.net < 0 && isolated.connected === 0);
E.advance(s, Math.ceil(s.sides[0].credits / -isolated.net) + 10);
assert.equal(s.sides[0].credits, 0);
const factory = s.buildings.find((b) => b.side === 0 && b.key === 'factory');
const factoryId = factory.id;
const checkpoint = E.save(s);
await mkdir('artifacts/qa', { recursive: true });
await writeFile('artifacts/qa/recovery-orders8133-poor-save.json', checkpoint);
const resources = () => [
  s.sides[0].credits,
  s.sides[0].materials,
  s.sides[0].oil,
  s.sides[0].components,
];
const beforeOrder = resources();
assert.equal(
  executeCommand(s, 0, 'factory-order', { id: factoryId, key: 'drone', count: 20 }),
  true,
);
assert.deepEqual(resources(), beforeOrder, 'unpaid order must not charge anything');
assert.equal(E.factoryOrderStatus(s, 0).unpaid, 20);
assert.equal(executeCommand(s, 0, 'road-recovery', { id: trunk.id }), true);
E.advance(s, 15);
assert.equal(s.sides[0].credits, 0);
assert.ok(s.sides[0].roadRecovery.paid > 26.9);
const pendingBeforeLoad = E.factoryOrderStatus(s, 0).unpaid;
s = E.load(E.save(s));
assert.equal(E.factoryOrderStatus(s, 0).unpaid, pendingBeforeLoad);
events.push({
  event: 'loaded-paid-road-and-unpaid-order',
  time: s.time,
  paid: s.sides[0].roadRecovery.paid,
});
let lastStock = 0;
for (let elapsed = 0; elapsed < 1200 && E.weaponStock(s, 0, 'drone') < 20; elapsed += 1) {
  E.advance(s, 1);
  const stock = E.weaponStock(s, 0, 'drone');
  if (stock !== lastStock) {
    events.push({
      event: 'manufactured',
      stock,
      time: s.time,
      pending: E.factoryOrderStatus(s, 0).unpaid,
    });
    lastStock = stock;
  }
}
assert.equal(E.economy(s, 0).connected, before.connected);
assert.equal(s.sides[0].roadRecovery, null);
assert.equal(E.weaponStock(s, 0, 'drone'), 20);
assert.equal(E.factoryOrderStatus(s, 0).unpaid, 0);
assert.equal(E.factoryOrderStatus(s, 0).paid, 0);
E.advance(s, 40);
assert.equal(E.weaponStock(s, 0, 'drone'), 20, 'finite order stops at the requested amount');
const report = {
  passed: true,
  resourcesGranted: false,
  enemy: 'idle human city',
  before,
  isolated,
  restored: E.economy(s, 0),
  purchases,
  events,
  time: s.time,
  stock: 20,
  resources: resources(),
  saveReloadContinued: true,
  checkpoint: 'recovery-orders8133-poor-save.json',
};
await writeFile('artifacts/qa/recovery-orders8133.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: true, stock: 20, events, time: s.time }));

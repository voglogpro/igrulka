import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { ai } from '../../src/game/ai/city-ai.js';
import { updateArmyAI } from '../../src/game/ai/army-ai.js';
import { aiState } from '../../src/game/ai/state.js';
import { corridorGeometry } from '../../src/game/defense/geometry.js';
import { updateDefense } from '../../src/game/defense/coordinator.js';
import { fireDefenses } from '../../src/game/combat/air-defense.js';
import { knownTargets } from '../../src/game/visibility.js';
import { hqOf } from '../../src/game/factions.js';
import { random } from '../../src/game/shared/random.js';
import { settlementRoadPlan } from '../../src/game/ai/settlement-ai.js';
import { SETTLEMENTS, settlementStatus } from '../../src/game/territory/settlements.js';
import { applyBlast } from '../../src/game/combat/damage.js';

function fresh() {
  const s = E.createGame(810, { mode: 'coop' });
  s.rules.rear = false;
  s.rules.oil = false;
  for (const f of s.sides) {
    f.credits = 20000;
    f.materials = 2000;
  }
  return s;
}
function ready(s, side, key, dx = -65, dz = -10) {
  const hq = hqOf(s, side),
    b = E.build(s, side, key, hq.x + dx, hq.z + dz);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
test('area damage reaches the complete four-city logistics fleet without silently ignoring the southern owners', () => {
  const s = fresh();
  s.ammoVehicles = Array.from({ length: E.AMMUNITION.fleetLimit * 4 }, (_, index) => ({
    id: s.nextId++,
    side: Math.floor(index / E.AMMUNITION.fleetLimit),
    hp: 100,
    maxHp: 100,
    status: 'outbound',
    x: -1500,
    z: 1500,
    cargo: { kind: 'weapon', key: 'drone', amount: 1 },
    path: [],
  }));
  applyBlast(s, -1500, 1500, 200, 20);
  assert.ok(s.ammoVehicles.every((v) => v.hp === 0 && v.cargo === null));
  for (const side of [0, 1, 2, 3]) assert.equal(s.sides[side].losses, E.AMMUNITION.fleetLimit);
});
test('both bots pay for independent local cities and maintain separate army planners', () => {
  const s = fresh();
  s.time = 8;
  ai(s, 1);
  ai(s, 3);
  assert.equal(s.buildings.filter((b) => b.key !== 'hq' && b.side === 1).length, 1);
  assert.equal(s.buildings.filter((b) => b.key !== 'hq' && b.side === 3).length, 1);
  for (const side of [1, 3]) {
    const b = s.buildings.find((b) => b.side === side && b.key !== 'hq'),
      hq = hqOf(s, side);
    assert.ok(Math.hypot(b.x - hq.x, b.z - hq.z) < 300);
    assert.ok(s.sides[side].credits < 20000);
    assert.equal(aiState(s, side).nextBuild, 15);
    ready(s, side, 'barracks');
  }
  assert.equal(s.sides[0].credits, 20000);
  assert.equal(s.sides[2].credits, 20000);
  s.time = 500;
  const before = s.sides.map((f) => f.credits);
  updateArmyAI(s, { random }, 1);
  assert.equal(aiState(s, 3).nextArmy, undefined);
  updateArmyAI(s, { random }, 3);
  for (const side of [1, 3]) {
    assert.ok(s.buildings.some((b) => b.side === side && b.armyQueue?.length));
    assert.ok(s.sides[side].credits < before[side]);
    assert.ok(aiState(s, side).nextArmy > 500);
  }
  assert.notEqual(aiState(s, 1), aiState(s, 3));
});
test('four owners retain strict recruitment and paid aircraft queues and cannot aim at allies', () => {
  const s = fresh();
  for (const side of [2, 3]) {
    const barracks = ready(s, side, 'barracks'),
      f = s.sides[side],
      before = f.credits;
    assert.equal(E.recruit(s, side, 'infantry', barracks.id, 1), true);
    assert.equal(f.credits, before - E.GROUND_UNITS.infantry.cost);
    assert.equal(typeof E.recruit(s, side ^ 2, 'infantry', barracks.id, 1), 'string');
    const factory = ready(s, side, 'factory', 65, -10);
    assert.equal(E.produce(s, side, 'drone', 1, factory.id), true);
    assert.ok(factory.queue?.length);
    const site = ready(s, side, 'launcher', 0, 160);
    E.acceptLaunchDelivery(site, 'drone', 1);
    assert.equal(typeof E.launch(s, side, 'drone', hqOf(s, side ^ 2).id, 1, site.id), 'string');
    assert.equal(E.launch(s, side, 'drone', hqOf(s, side ^ 1).id, 1, site.id), 1);
    assert.equal(site.launchStore.drone, 0);
    assert.ok(s.units.some((u) => u.side === side && u.sourceId === site.id));
  }
});
test('friendly ground and AA units never acquire allies, while hostile targets remain valid', () => {
  const s = fresh(),
    a = E.makeGround(s, 0, 'leopard', -1100, -1415),
    b = E.makeGround(s, 2, 'leopard', -1000, -1415);
  a.holdFire = b.holdFire = false;
  s.groundUnits.push(a, b);
  E.advance(s, 2);
  assert.equal(s.stats.shots, 0);
  assert.equal(a.hp, a.maxHp);
  assert.equal(b.hp, b.maxHp);
  assert.ok(!knownTargets(s, 0).some((v) => v.side === 2));
  assert.equal(typeof E.orderGround(s, 0, [a.id], { x: b.x, z: b.z, targetId: b.id }), 'string');
  const aa = E.makeGround(s, 2, 'gepard', -1100, 1415);
  s.groundUnits.push(aa);
  const air = {
    id: s.nextId++,
    side: 0,
    key: 'drone',
    hp: 80,
    maxHp: 80,
    launched: true,
    delay: 0,
    x: aa.x + 70,
    y: 30,
    z: aa.z,
    total: 100,
    travelled: 0,
    speed: 40,
  };
  s.units.push(air);
  const rates = s.sides.map(() => ({ productivity: 1, power: 100, demand: 0 }));
  fireDefenses(s, rates, 0.05);
  assert.equal(aa.trackId, null);
  air.side = 1;
  fireDefenses(s, rates, 0.05);
  assert.equal(aa.trackId, air.id);
  const operator = E.makeGround(s, 2, 'operator', -1150, 1415);
  const ally = E.makeGround(s, 0, 'leopard', -1050, 1415);
  const enemy = E.makeGround(s, 1, 'leopard', -1000, 1415);
  s.groundUnits.push(operator, ally, enemy);
  assert.equal(typeof E.launchFPV(s, 2, [operator.id], ally, ally.id), 'string');
  assert.equal(operator.fpvAmmo, 3);
  assert.equal(E.launchFPV(s, 2, [operator.id], enemy, enemy.id), true);
  assert.equal(operator.fpvAmmo, 2);
});
test('both bots buy real roads to their own villages without sending capture garrisons across the ally city', () => {
  const s = fresh(),
    before = s.sides.map((f) => f.credits);
  for (let turn = 0; turn < 30; turn++) for (const side of [1, 3]) settlementRoadPlan(s, side);
  E.advance(s, 1.1);
  for (const side of [1, 3]) {
    assert.ok(s.sides[side].credits < before[side]);
    const expectedSign = side === 1 ? -1 : 1;
    assert.ok(
      s.roads
        .filter((r) => r.side === side && !r.camp)
        .every((r) => Math.sign(r.az) === expectedSign && Math.sign(r.bz) === expectedSign),
    );
    const villages = SETTLEMENTS.filter((d) => d.x > 0 && Math.sign(d.z) === expectedSign);
    assert.ok(villages.some((d) => settlementStatus(s, d.id)?.owner === side));
  }
  assert.equal(s.groundUnits.length, 0);
});
test('each north/south city pair forms its own dry front without pulling troops to the other city', () => {
  const s = fresh();
  for (const side of [0, 1, 2, 3]) {
    const north = side < 2,
      lines = corridorGeometry(s, side);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].id, north ? 'north' : 'south');
    assert.ok(lines[0].slots.every((p) => Math.sign(p.z) === (north ? -1 : 1)));
    const u = E.makeGround(s, side, 'infantry', side % 2 ? 800 : -800, north ? -1360 : 1360);
    u.guard = { x: u.x, z: u.z };
    u.autoDefense = true;
    s.groundUnits.push(u);
  }
  updateDefense(s);
  assert.equal(s.frontlineMemory.length, 4);
  for (const u of s.groundUnits)
    assert.equal(u.defensePost?.corridorId, u.side < 2 ? 'north' : 'south');
  for (const side of [0, 1, 2, 3]) {
    const ally = side ^ 2;
    assert.ok(
      s.frontlineMemory[side].seen.every(
        (v) => s.groundUnits.find((u) => u.id === v.id)?.side !== ally,
      ),
    );
  }
});

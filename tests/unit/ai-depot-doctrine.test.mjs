import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateArmyAI } from '../../src/game/ai/army-ai.js';
import { updateDistrictAI } from '../../src/game/ai/district-ai.js';
import { aiState } from '../../src/game/ai/state.js';
import {
  depotObjectives,
  armyComposition,
  chooseArmyRecruit,
  observedArmor,
  armyProductionReserve,
} from '../../src/game/ai/depot-doctrine.js';
import { ai } from '../../src/game/ai/city-ai.js';
import { hqOf } from '../../src/game/factions.js';
import { COVER_PATCHES, groundVisible } from '../../src/game/units/infantry/cover.js';

function fresh(mode) {
  const s = E.createGame(8124, mode ? { mode } : {});
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 100000;
    f.materials = 10000;
    f.oil = 10000;
  }
  for (const side of E.aiSides(s)) {
    const memory = aiState(s, side);
    memory.nextBuild = memory.nextAttack = memory.nextArmy = 1e9;
  }
  return s;
}
function unit(s, side, key, i = 0) {
  const hq = hqOf(s, side),
    u = E.makeGround(s, side, key, hq.x - 130 + i * 8, hq.z + 200);
  s.groundUnits.push(u);
  return u;
}
function facility(s, side, key, dx = 65) {
  const hq = hqOf(s, side),
    b = E.build(s, side, key, hq.x + dx, hq.z - 10);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}

test('mixed bot formations use the same auto-defense intent with no private three-man cap or immediate path work', () => {
  const s = fresh(),
    troops = ['infantry', 'machinegunner', 'atrifle', 'sniper', 'mog', 'armoredcar', 'leopard'].map(
      (key, i) => unit(s, 1, key, i),
    );
  const count = s.groundUnits.length;
  updateDistrictAI(s, 1);
  assert.equal(s.groundUnits.length, count, 'orders never create free units');
  assert.ok(troops.every((u) => u.autoDefense && u.stance.mode === 'defend'));
  assert.ok(troops.every((u) => !u.aiDistrict && !u.guard && !u.order && !u.path.length));
  const before = troops.map((u) => ({ ...u.stance }));
  updateDistrictAI(s, 1);
  assert.deepEqual(
    troops.map((u) => u.stance),
    before,
  );
});

test('bot adapter preserves explicit orders, manual posts, wounded, support, passengers and committed cargo', () => {
  const s = fresh(),
    kinds = [
      'infantry',
      'infantry',
      'infantry',
      'medic',
      'apc',
      'infantry',
      'infantry',
      'infantry',
      'infantry',
    ];
  const troops = kinds.map((key, i) => unit(s, 1, key, i));
  troops[0].order = { x: 850, z: 400, mode: 'attackmove' };
  troops[0].routeState = { status: 'blocked', retryAt: 10 };
  troops[1].guard = { x: troops[1].x, z: troops[1].z };
  troops[2].hp *= 0.2;
  troops[5].carrierId = troops[4].id;
  troops[6].delivery = { point: { x: 800, z: 100 } };
  troops[7].supplyTrip = { crateId: 999, home: { x: 800, z: 200 } };
  troops[8].defenseTask = { sectorId: 'north', until: 10 };
  const before = structuredClone(troops);
  updateArmyAI(s, { random: E.random }, 1);
  assert.deepEqual(troops, before);
});

test('cooperative bot doctrines keep separate ownership and their paired north/south depot', () => {
  const s = fresh('coop');
  for (const side of [0, 1, 2, 3]) unit(s, side, 'infantry');
  updateArmyAI(s, { random: E.random }, 1);
  assert.equal(s.groundUnits.find((u) => u.side === 1).autoDefense, true);
  assert.ok(s.groundUnits.filter((u) => u.side !== 1).every((u) => !u.autoDefense));
  updateArmyAI(s, { random: E.random }, 3);
  assert.equal(s.groundUnits.find((u) => u.side === 3).autoDefense, true);
  assert.ok(s.groundUnits.filter((u) => u.side % 2 === 0).every((u) => !u.autoDefense));
  assert.deepEqual(
    depotObjectives(s, 1).map((d) => d.id),
    ['north-depot'],
  );
  assert.deepEqual(
    depotObjectives(s, 3).map((d) => d.id),
    ['south-depot'],
  );
  assert.notEqual(aiState(s, 1), aiState(s, 3));
});

test('both cooperative bots physically countercapture hostile depot flags and restore their own resource bonus', () => {
  const s = fresh('coop');
  for (const side of [1, 3]) {
    const site = depotObjectives(s, side)[0];
    Object.assign(
      s.districts.find((d) => d.id === site.id),
      { owner: side ^ 1, control: 1 },
    );
    const keys = [
      'infantry',
      'infantry',
      'infantry',
      'machinegunner',
      'atrifle',
      'sniper',
      'mog',
      'armoredcar',
    ];
    for (let i = 0; i < keys.length; i++) {
      const u = E.makeGround(s, side, keys[i], 220 + (i % 3) * 12, site.z + Math.floor(i / 3) * 12);
      u.holdFire = true;
      s.groundUnits.push(u);
    }
    updateDistrictAI(s, side);
    assert.equal(E.districtIncome(s, side).active, 0);
  }
  const count = s.groundUnits.length;
  E.advance(s, 150);
  assert.equal(
    s.groundUnits.length,
    count,
    'no free combatants were introduced during countercapture',
  );
  for (const side of [1, 3]) {
    const site = depotObjectives(s, side)[0];
    assert.equal(site.owner, side, `${side} physically neutralized and recaptured its local depot`);
    assert.equal(E.districtIncome(s, side).active, 1);
    assert.equal(E.districtIncome(s, side).outputBonus, 0.15);
    assert.ok(
      s.groundUnits.some(
        (u) =>
          u.side === side &&
          E.isInfantry(u.key) &&
          Math.hypot(u.x - site.x, u.z - site.z) <= site.radius,
      ),
    );
    assert.ok(s.groundUnits.filter((u) => u.side === side).every((u) => !u.aiDistrict));
  }
});

test('minimum paid infantry queue is followed by affordable anti-armor, suppression, air defense and reconnaissance', () => {
  const s = fresh(),
    b = facility(s, 1, 'barracks'),
    initial = { ...s.sides[1] };
  s.time = E.difficultyOf(s).armyFrom + 1;
  for (let i = 0; i < 8; i++) {
    aiState(s, 1).nextArmy = 0;
    updateArmyAI(s, { random: E.random }, 1);
    s.time += E.difficultyOf(s).armyEvery + 1;
  }
  const keys = b.armyQueue.map((q) => q.key);
  assert.deepEqual(keys, [
    'infantry',
    'infantry',
    'infantry',
    'atrifle',
    'machinegunner',
    'mog',
    'sniper',
    'engineer',
  ]);
  assert.equal(
    initial.credits - s.sides[1].credits,
    keys.reduce((sum, key) => sum + E.GROUND_UNITS[key].cost, 0),
  );
  assert.equal(
    initial.materials - s.sides[1].materials,
    keys.reduce((sum, key) => sum + E.GROUND_UNITS[key].metal, 0),
  );
  assert.equal(armyComposition(s, 1).get('sniper'), 1);
  assert.equal(s.groundUnits.length, 0, 'paid units still need real training time');
});

test('doctrine checks own reserves, metal, fuel and paid queues without changing prices or resources', () => {
  const s = fresh(),
    barracks = facility(s, 1, 'barracks'),
    f = s.sides[1];
  facility(s, 1, 'vehiclebase', -65);
  f.credits = 277;
  assert.equal(chooseArmyRecruit(s, 1, new Set(['barracks'])), null);
  f.credits = 278;
  assert.equal(chooseArmyRecruit(s, 1, new Set(['barracks'])), 'infantry');
  f.materials = 0;
  assert.equal(chooseArmyRecruit(s, 1, new Set(['barracks'])), null);
  f.materials = 10000;
  f.credits = 100000;
  barracks.armyQueue = Array.from({ length: 3 }, () => ({ key: 'infantry', progress: 0 }));
  assert.equal(chooseArmyRecruit(s, 1, new Set(['barracks'])), 'atrifle');
  f.oil = 0;
  assert.equal(chooseArmyRecruit(s, 1, new Set(['vehiclebase'])), null);
  f.oil = E.GROUND_UNITS.tankdestroyer.oil;
  assert.equal(chooseArmyRecruit(s, 1, new Set(['vehiclebase'])), 'tankdestroyer');
  assert.equal(f.credits, 100000);
  assert.equal(f.materials, 10000);
});

test('a full infantry queue does not prevent a free vehicle factory from buying needed armored support', () => {
  const s = fresh(),
    barracks = facility(s, 1, 'barracks'),
    vehicles = facility(s, 1, 'vehiclebase', -65);
  barracks.armyQueue = [
    'infantry',
    'infantry',
    'infantry',
    'atrifle',
    'atrifle',
    'atrifle',
    'atrifle',
    'atrifle',
  ].map((key) => ({ key, progress: 0 }));
  s.time = E.difficultyOf(s).armyFrom + 1;
  aiState(s, 1).nextArmy = 0;
  const before = { ...s.sides[1] };
  updateArmyAI(s, { random: E.random }, 1);
  assert.equal(barracks.armyQueue.length, 8);
  assert.equal(vehicles.armyQueue[0].key, 'armoredcar');
  assert.equal(before.credits - s.sides[1].credits, E.GROUND_UNITS.armoredcar.cost);
  assert.equal(before.materials - s.sides[1].materials, E.GROUND_UNITS.armoredcar.metal);
  assert.equal(before.oil - s.sides[1].oil, E.GROUND_UNITS.armoredcar.oil);
});

test('aircraft and ground recruitment both pay normally without spending the next ground or infrastructure budget', () => {
  const s = fresh(),
    barracks = facility(s, 1, 'barracks'),
    factory = facility(s, 1, 'factory', -65);
  const f = s.sides[1],
    memory = aiState(s, 1);
  f.components = 20;
  f.credits = 420;
  const before = { ...f };
  s.time = E.difficultyOf(s).armyFrom + 1;
  memory.nextArmy = 0;
  for (let i = 0; i < 10; i++) ai(s, 1);
  assert.ok(factory.queue?.length > 0, 'ground reserve still allows paid aircraft production');
  updateArmyAI(s, { random: E.random }, 1);
  assert.equal(barracks.armyQueue[0].key, 'infantry');
  assert.ok(f.credits >= 250);
  const weaponCosts = factory.queue.reduce((sum, q) => sum + E.WEAPONS[q.key].cost, 0);
  assert.equal(before.credits - f.credits, weaponCosts + E.GROUND_UNITS.infantry.cost);
  memory.plannedBuild = 'ammofactory';
  const quote = E.purchaseQuote(s, 1, 'building', 'ammofactory');
  f.credits = quote.cost + 250 + E.GROUND_UNITS.infantry.cost;
  memory.nextArmy = 0;
  s.time += 2;
  for (let i = 0; i < 10; i++) ai(s, 1);
  updateArmyAI(s, { random: E.random }, 1);
  assert.ok(f.credits >= quote.cost, 'air and ground cannot starve the planned ammunition plant');
  let plant;
  const failures = new Set();
  for (const dz of [-80, -10, 20, 90, 120, 190]) {
    for (const dx of [-110, -55, 0, 55, 110]) {
      const hq = hqOf(s, 1),
        result = E.build(s, 1, 'ammofactory', hq.x + dx, hq.z + dz);
      if (typeof result !== 'string') {
        plant = result;
        break;
      }
      failures.add(result);
    }
    if (plant) break;
  }
  assert.ok(
    plant,
    `the preserved ordinary budget really builds the ammunition plant: ${[...failures].join('; ')}`,
  );
});

test('protected ground budget depends on a ready production capability and the next desired role', () => {
  const s = fresh();
  assert.equal(armyProductionReserve(s, 1, new Set()), 0);
  const barracks = facility(s, 1, 'barracks');
  assert.equal(armyProductionReserve(s, 1, new Set(['barracks'])), 278);
  barracks.armyQueue = Array.from({ length: 3 }, () => ({ key: 'infantry', progress: 0 }));
  assert.equal(armyProductionReserve(s, 1, new Set(['barracks'])), 335);
  barracks.hp = 0;
  assert.equal(armyProductionReserve(s, 1, new Set(['barracks'])), 0);
});

test('armor response uses hostile observed vehicles while concealed infantry and allied armor do not leak into decisions', () => {
  const s = fresh('coop');
  facility(s, 1, 'barracks');
  for (let i = 0; i < 3; i++) unit(s, 1, 'infantry', i);
  const ally = unit(s, 3, 'leopard');
  assert.equal(observedArmor(s, 1), false);
  assert.equal(chooseArmyRecruit(s, 1, new Set(['barracks'])), 'atrifle');
  const patch = COVER_PATCHES.find((p) => p.forest && p.x < -300);
  assert.ok(patch);
  const hidden = E.makeGround(s, 0, 'sniper', patch.x, patch.z);
  hidden.camouflaged = true;
  s.groundUnits.push(hidden);
  assert.equal(groundVisible(s, 1, hidden), false);
  assert.equal(observedArmor(s, 1), false);
  assert.equal(chooseArmyRecruit(s, 1, new Set(['barracks'])), 'atrifle');
  const enemy = unit(s, 0, 'armoredcar');
  assert.equal(observedArmor(s, 1), true);
  assert.equal(chooseArmyRecruit(s, 1, new Set(['barracks'])), 'atgm');
  enemy.hp = 0;
  assert.equal(observedArmor(s, 1), false);
  assert.equal(ally.hp, ally.maxHp);
});

test('completed mixed-role core continues paid reinforcement instead of becoming an implicit army cap', () => {
  const s = fresh();
  facility(s, 1, 'barracks');
  facility(s, 1, 'vehiclebase', -65);
  const facilities = new Set(['barracks', 'vehiclebase', 'ammofactory']);
  for (let i = 0; i < 60; i++) {
    const key = chooseArmyRecruit(s, 1, facilities);
    assert.equal(typeof key, 'string', `reinforcement ${i}`);
    unit(s, 1, key, i);
  }
  const keys = new Set(s.groundUnits.map((u) => u.key));
  assert.ok(keys.has('sniper') && keys.has('mog') && keys.has('armoredcar'));
  assert.ok(keys.has('lighttank') && keys.has('medic') && keys.has('supplytruck'));
  assert.ok(keys.has('howitzer'));
});

test('one-second doctrine cadence admits new recruits without waiting an entire purchase interval', () => {
  const s = fresh();
  s.time = 10;
  updateArmyAI(s, { random: E.random }, 1);
  const u = unit(s, 1, 'infantry');
  s.time = 10.5;
  updateArmyAI(s, { random: E.random }, 1);
  assert.equal(u.autoDefense, false);
  s.time = 11;
  updateArmyAI(s, { random: E.random }, 1);
  assert.equal(u.autoDefense, true);
});

test('human sides and multiplayer receive no bot orders, purchases or repairs', () => {
  for (const mode of [undefined, 'multiplayer']) {
    const s = fresh(mode);
    unit(s, 0, 'infantry');
    if (mode) unit(s, 1, 'infantry');
    const before = E.save(s);
    updateArmyAI(s, { random: E.random }, 0);
    updateDistrictAI(s, 0);
    if (mode) {
      updateArmyAI(s, { random: E.random }, 1);
      updateDistrictAI(s, 1);
    }
    assert.equal(E.save(s), before);
  }
});

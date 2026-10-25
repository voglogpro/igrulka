import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { addRoad } from '../../src/game/city/roads.js';
import { dirtyNetwork } from '../../src/game/city/road-network.js';
import { recruit, recruitmentFacility } from '../../src/game/units/ground/recruitment.js';
import { deploymentPlan, deployGround } from '../../src/game/units/ground/deployment.js';
import { autoRear } from '../../src/game/units/ground/rear.js';
import { updateRecruitRepeat } from '../../src/game/units/ground/repeat.js';
import {
  createArmyComposition,
  setArmyTarget,
  armyCompositionStatus,
  updateArmyComposition,
  restoreArmyComposition,
} from '../../src/game/units/ground/composition.js';

function fresh() {
  const s = E.createGame(126);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  s.groundUnits = [];
  for (const side of [0, 1]) {
    Object.assign(s.sides[side], {
      credits: 100000,
      materials: 10000,
      oil: 150,
      armyComposition: createArmyComposition(),
    });
    const hq = s.buildings.find((b) => b.key === 'hq' && b.side === side);
    for (const [key, dx] of [
      ['barracks', -60],
      ['vehiclebase', 60],
    ]) {
      const b = {
        id: s.nextId++,
        key,
        side,
        x: hq.x + dx,
        z: -20,
        hp: E.BUILDINGS[key].hp,
        maxHp: E.BUILDINGS[key].hp,
        progress: 1,
        queue: [],
        armyQueue: [],
      };
      s.buildings.push(b);
      s.sides[side].purchases.building[key] = 1;
      addRoad(s, side, hq.x, 0, b.x, b.z, { camp: true });
    }
  }
  return s;
}
const site = (s, side = 0, key = 'barracks') =>
  s.buildings.find((b) => b.side === side && b.key === key);
const row = (s, key = 'infantry', side = 0) =>
  armyCompositionStatus(s, side).types.find((r) => r.key === key);
const money = (s, side = 0) => ({
  credits: s.sides[side].credits,
  materials: s.sides[side].materials,
  oil: s.sides[side].oil,
});

test('all noncivil roles use their proper facility; old paid vehicle queues stay intact', () => {
  const s = fresh();
  for (const [key, d] of Object.entries(E.GROUND_UNITS))
    assert.equal(
      recruitmentFacility(key),
      d.civil ? null : d.infantry ? 'barracks' : 'vehiclebase',
    );
  for (const key of ['constructor', '__proto__', 'missing'])
    assert.equal(recruitmentFacility(key), null);
  const b = site(s),
    v = site(s, 0, 'vehiclebase'),
    before = money(s);
  assert.equal(typeof recruit(s, 0, 'leopard', b.id), 'string');
  assert.equal(typeof recruit(s, 0, 'infantry', v.id), 'string');
  assert.deepEqual(money(s), before);
  assert.equal(recruit(s, 0, 'leopard', v.id), true);
  assert.equal(recruit(s, 0, 'atgm', b.id), true);
  b.armyQueue.push({ key: 'apc', progress: 0.7 });
  assert.equal(setArmyTarget(s, 0, 'apc', 1), true);
  assert.equal(row(s, 'apc').queued, 1);
  assert.equal(row(s, 'apc').remaining, 0);
  assert.equal(v.armyQueue[0].key, 'leopard');
});

test('targets are explicit, strict and independently bounded without a shared population cap', () => {
  const s = fresh(),
    before = money(s);
  for (const count of [-1, E.ARMY_TARGET_MAX + 1, 1.5, NaN, Infinity, '2'])
    assert.equal(typeof setArmyTarget(s, 0, 'infantry', count), 'string');
  for (const key of ['constructor', '__proto__', 'tradetruck'])
    assert.equal(typeof setArmyTarget(s, 0, key, 2), 'string');
  assert.equal(setArmyTarget(s, 0, 'infantry', 110), true);
  assert.equal(setArmyTarget(s, 0, 'leopard', 10), true);
  const original = structuredClone(s.sides[0].armyComposition);
  assert.equal(typeof setArmyTarget(s, 0, 'medic', E.ARMY_TARGET_MAX + 1), 'string');
  assert.deepEqual(s.sides[0].armyComposition, original);
  assert.equal(setArmyTarget(s, 0, 'medic', 500), true);
  assert.equal(armyCompositionStatus(s, 0).totals.limit, null);
  assert.equal(setArmyTarget(s, 0, 'infantry', 0), true);
  assert.equal(armyCompositionStatus(s, 0).totals.desired, 510);
  assert.deepEqual(money(s), before);
  assert.equal(
    armyCompositionStatus(s, 0).types.length,
    Object.values(E.GROUND_UNITS).filter((d) => !d.civil).length,
  );
});

test('no default composition, legacy repeat or rear logic can buy unselected roles', () => {
  const s = fresh(),
    before = money(s);
  for (let i = 0; i < 15; i++)
    s.groundUnits.push(E.makeGround(s, 0, i < 10 ? 'infantry' : 'leopard', -900, 300 + i * 8));
  site(s).recruitRepeat = { enabled: true, key: 'infantry' };
  for (let i = 0; i < 10; i++) {
    s.time++;
    updateArmyComposition(s);
    autoRear(s);
    updateRecruitRepeat(s);
  }
  assert.deepEqual(money(s), before);
  assert.equal(site(s).armyQueue.length, 0);
  assert.equal(site(s, 0, 'vehiclebase').armyQueue.length, 0);
});

test('round robin buys at most one per side per four seconds and uses ordinary paid queues', () => {
  const s = fresh();
  for (const side of [0, 1]) {
    setArmyTarget(s, side, 'infantry', 3);
    setArmyTarget(s, side, 'medic', 1);
    setArmyTarget(s, side, 'leopard', 1);
  }
  const before = money(s);
  updateArmyComposition(s);
  assert.deepEqual(site(s).armyQueue[0], {
    key: 'infantry',
    progress: 0,
    stance: { mode: 'defend', post: 'auto' },
    autoDefense: true,
  });
  assert.deepEqual(site(s).armyQueue, site(s, 1).armyQueue);
  assert.equal(before.credits - s.sides[0].credits, E.GROUND_UNITS.infantry.cost);
  for (let i = 0; i < 100; i++) updateArmyComposition(s);
  assert.equal(site(s).armyQueue.length, 1);
  s.time = 4;
  updateArmyComposition(s);
  assert.equal(site(s, 0, 'vehiclebase').armyQueue[0].key, 'leopard');
  assert.deepEqual(site(s, 0, 'vehiclebase').armyQueue, site(s, 1, 'vehiclebase').armyQueue);
  s.time = 8;
  updateArmyComposition(s);
  assert.equal(site(s).armyQueue.length, 1, 'busy barracks do not accumulate automatic orders');
});

test('ordinary costs leave exact money/material reserves and vehicles also retain five oil', () => {
  for (const key of ['infantry', 'leopard']) {
    const s = fresh(),
      d = E.GROUND_UNITS[key],
      f = s.sides[0];
    setArmyTarget(s, 0, key, 1);
    Object.assign(f, { credits: d.cost + 250, materials: d.metal + 5, oil: (d.oil || 0) + 5 });
    const exact = money(s);
    for (const resource of d.oil ? ['credits', 'materials', 'oil'] : ['credits', 'materials']) {
      Object.assign(f, exact);
      f[resource] -= 0.01;
      assert.equal(row(s, key).status, 'reserve');
      updateArmyComposition(s);
      assert.equal(armyCompositionStatus(s, 0).totals.queued, 0);
      s.time += 4;
    }
    Object.assign(f, exact);
    updateArmyComposition(s);
    assert.deepEqual(money(s), { credits: 250, materials: 5, oil: 5 });
  }
  const s = fresh();
  s.sides[0].oil = 0;
  setArmyTarget(s, 0, 'infantry', 1);
  updateArmyComposition(s);
  assert.equal(site(s).armyQueue.length, 1, 'infantry needs no oil reserve');
  assert.equal(s.sides[0].oil, 0);
});

test('construction, severed roads, destruction, game end and completed targets cannot buy', () => {
  const s = fresh(),
    b = site(s);
  setArmyTarget(s, 0, 'infantry', 2);
  b.progress = 0.5;
  assert.equal(row(s).status, 'facility');
  b.progress = 1;
  const roads = s.roads.filter((r) => r.side === 0);
  for (const r of roads) r.blocked = true;
  dirtyNetwork(s);
  assert.equal(row(s).status, 'facility');
  updateArmyComposition(s);
  assert.equal(b.armyQueue.length, 0);
  for (const r of roads) r.blocked = false;
  dirtyNetwork(s);
  s.time = 4;
  b.hp = 0;
  updateArmyComposition(s);
  assert.equal(b.armyQueue.length, 0);
  b.hp = b.maxHp;
  s.result = 'victory';
  assert.equal(row(s).status, 'finished');
  updateArmyComposition(s);
  assert.equal(b.armyQueue.length, 0);
});

test('manual attackers, wounded and carried units and all paid queues count without taking their orders', () => {
  const s = fresh(),
    b = site(s);
  for (let i = 0; i < 3; i++) {
    const u = E.makeGround(s, 0, 'infantry', -900, 200 + 10 * i);
    if (i === 0) {
      u.order = { x: 900, z: 1360, mode: 'attackmove' };
      u.path = [{ x: -700, z: 1360 }];
    }
    if (i === 1) u.downed = { t: 0, revive: 0 };
    if (i === 2) u.carrierId = 999;
    s.groundUnits.push(u);
  }
  b.armyQueue.push({ key: 'infantry', progress: 0.6, stance: { mode: 'attack' } });
  setArmyTarget(s, 0, 'infantry', 4);
  const units = structuredClone(s.groundUnits),
    queue = structuredClone(b.armyQueue);
  updateArmyComposition(s);
  assert.equal(row(s).status, 'met');
  assert.deepEqual(s.groundUnits, units);
  assert.deepEqual(b.armyQueue, queue);
  setArmyTarget(s, 0, 'infantry', 0);
  assert.deepEqual(b.armyQueue, queue, 'reducing the target never deletes paid recruits');
});

test('deployment preview and manual point orders route vehicles through the vehiclebase only', () => {
  const s = fresh(),
    b = site(s),
    v = site(s, 0, 'vehiclebase');
  const point = { x: v.x, z: 160 };
  assert.equal(deploymentPlan(s, 0, 'leopard', point, 1, b.id).ok, false);
  const plan = deploymentPlan(s, 0, 'leopard', point, 1, v.id);
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.siteId, v.id);
  assert.equal(deployGround(s, 0, 'leopard', point, 1, v.id).siteId, v.id);
  assert.equal(v.armyQueue[0].destination.mode, 'attackmove');
  assert.equal(v.armyQueue[0].autoDefense, undefined);
  assert.deepEqual(s.sides[0].armyComposition.targets, {});
});

test('legacy explicit garrisons merge by maximum, retire infinite repeats, and new imports stay strict', () => {
  const s = fresh(),
    a = site(s),
    b = site(s, 0, 'vehiclebase');
  a.recruitRepeat = { key: 'infantry', enabled: true, target: 24 };
  b.recruitRepeat = { key: 'infantry', enabled: true, target: 12 };
  site(s, 1).recruitRepeat = { key: 'infantry', enabled: true };
  restoreArmyComposition(s, 14);
  assert.deepEqual(s.sides[0].armyComposition.targets, { infantry: 24 });
  assert.deepEqual(s.sides[1].armyComposition.targets, {});
  assert.equal(a.recruitRepeat, null);
  const copy = structuredClone(s);
  restoreArmyComposition(copy, 15);
  assert.deepEqual(copy.sides, s.sides);
  for (const invalid of [
    { targets: { constructor: 1 }, nextAt: 0, cursor: 0 },
    { targets: JSON.parse('{"__proto__":1}'), nextAt: 0, cursor: 0 },
    { targets: { infantry: 100, leopard: E.ARMY_TARGET_MAX + 1 }, nextAt: 0, cursor: 0 },
    { targets: { infantry: 1 }, nextAt: Infinity, cursor: 0 },
    { targets: { infantry: 0 }, nextAt: 0, cursor: 0 },
  ]) {
    const bad = structuredClone(s);
    bad.sides[0].armyComposition = invalid;
    assert.throws(() => restoreArmyComposition(bad, 15));
  }
});

test('actual simulation spawns defense recruits, replaces a real loss, and continues identically after load', () => {
  const s = fresh();
  for (const side of [0, 1]) setArmyTarget(s, side, 'infantry', 2);
  E.advance(s, 40);
  for (const side of [0, 1]) {
    const r = row(s, 'infantry', side);
    assert.equal(r.alive, 2);
    assert.equal(r.queued, 0);
    assert.equal(r.remaining, 0);
    assert.ok(s.groundUnits.filter((u) => u.side === side).every((u) => u.autoDefense));
  }
  const dead = s.groundUnits.find((u) => u.side === 0);
  dead.hp = 0;
  E.advance(s, 0.1);
  const saved = E.load(E.save(s));
  assert.deepEqual(
    saved.sides.map((f) => f.armyComposition),
    s.sides.map((f) => f.armyComposition),
  );
  E.advance(s, 40);
  E.advance(saved, 40);
  assert.equal(row(s).alive, 2);
  assert.deepEqual(saved.sides, s.sides);
  // Load increments the navigation cache revision, not the actual path or movement.
  const comparable = (units) => units.map(({ navRevision, ...u }) => u);
  assert.deepEqual(comparable(saved.groundUnits), comparable(s.groundUnits));
});

// The old per-barracks repeat control is replaced by one explicit composition per side.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { addRoad } from '../../src/game/city/roads.js';
import { executeCommand } from '../../src/network/commands.js';
import {
  updateArmyComposition,
  restoreArmyComposition,
} from '../../src/game/units/ground/composition.js';

function fresh(count = 1) {
  const s = E.createGame(117);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  const barracks = [];
  for (const side of [0, 1]) {
    Object.assign(s.sides[side], { credits: 100000, materials: 1000, oil: 150 });
    const hq = s.buildings.find((b) => b.side === side && b.key === 'hq');
    for (let i = 0; i < count; i++) {
      const b = {
        id: s.nextId++,
        key: 'barracks',
        side,
        hp: 360,
        maxHp: 360,
        progress: 1,
        x: hq.x - 60 + i * 60,
        z: -20,
        armyQueue: [],
        queue: [],
      };
      s.buildings.push(b);
      barracks.push(b);
      addRoad(s, side, hq.x, 0, b.x, b.z, { camp: true });
    }
  }
  return { s, barracks: barracks.filter((b) => b.side === 0) };
}
const row = (s, side = 0) =>
  E.armyCompositionStatus(s, side).types.find((v) => v.key === 'infantry');

test('network army targets bind to the commanding owner and malformed commands are atomic', () => {
  const { s } = fresh();
  for (const side of [0, 1]) {
    for (const args of [
      { key: 'infantry', count: -1 },
      { key: 'infantry', count: E.ARMY_TARGET_MAX + 1 },
      { key: 'infantry', count: 1.5 },
      { key: 'infantry', count: '6' },
      { key: 'infantry', count: NaN },
      { key: 'constructor', count: 6 },
      { key: '__proto__', count: 6 },
      { key: 'tradetruck', count: 6 },
    ]) {
      const before = E.save(s);
      assert.equal(typeof executeCommand(s, side, 'army-target', args), 'string');
      assert.equal(E.save(s), before);
    }
    assert.equal(
      executeCommand(s, side, 'army-target', { key: 'infantry', count: side + 2, side: 1 - side }),
      true,
    );
    assert.equal(row(s, side).target, side + 2);
  }
  assert.equal(row(s, 0).target, 2);
  assert.equal(row(s, 1).target, 3);
});

test('paid queues across several bases satisfy one shared side/type target without overshoot', () => {
  const { s, barracks } = fresh(3);
  barracks[0].armyQueue.push({ key: 'infantry', progress: 0.2 });
  barracks[1].armyQueue.push({ key: 'infantry', progress: 0.8 });
  E.setArmyTarget(s, 0, 'infantry', 2);
  const before = s.sides[0].credits;
  updateArmyComposition(s);
  assert.equal(row(s).queued, 2);
  assert.equal(row(s).remaining, 0);
  assert.equal(row(s).status, 'met');
  assert.equal(barracks[2].armyQueue.length, 0);
  assert.equal(s.sides[0].credits, before);
});

test('existing targets survive real casualty replacement; setting zero keeps the already paid queue', () => {
  const {
    s,
    barracks: [b],
  } = fresh();
  E.setArmyTarget(s, 0, 'infantry', 1);
  E.advance(s, 6);
  assert.equal(row(s).alive, 1);
  const lost = s.groundUnits.find((u) => u.side === 0);
  lost.hp = 0;
  E.advance(s, 3);
  assert.equal(row(s).alive + row(s).queued, 1);
  E.setArmyTarget(s, 0, 'infantry', 0);
  const paid = structuredClone(b.armyQueue);
  E.step(s, 0);
  assert.deepEqual(b.armyQueue, paid);
  assert.equal(row(s).status, 'disabled');
});

test('wounded, passengers and civilian ground vehicles do not impose a population stop', () => {
  const {
    s,
    barracks: [b],
  } = fresh();
  for (let i = 0; i < 500; i++) {
    const u = E.makeGround(s, 0, i === 0 ? 'tradetruck' : 'engineer', -1000, 200 + i);
    if (i === 1) u.downed = { t: 0, revive: 0 };
    if (i === 2) u.carrierId = 999;
    s.groundUnits.push(u);
  }
  E.setArmyTarget(s, 0, 'infantry', 1);
  const funds = s.sides[0].credits;
  assert.equal(row(s).status, 'active');
  updateArmyComposition(s);
  assert.equal(b.armyQueue.length, 1);
  assert.equal(s.sides[0].credits, funds - E.GROUND_UNITS.infantry.cost);
});

test('legacy explicitly chosen garrisons migrate by maximum per type while infinite repeats stay off', () => {
  const {
    s,
    barracks: [a, b, c],
  } = fresh(3);
  a.recruitRepeat = { enabled: true, key: 'infantry', target: 6 };
  b.recruitRepeat = { enabled: true, key: 'infantry', target: 12 };
  c.recruitRepeat = { enabled: true, key: 'medic' };
  restoreArmyComposition(s, 14);
  assert.deepEqual(s.sides[0].armyComposition.targets, { infantry: 12 });
  assert.deepEqual(s.sides[1].armyComposition.targets, {});
  assert.ok(s.buildings.every((b) => b.recruitRepeat == null));
});

test('new composition imports preserve paid defense metadata and reject forged targets/cadence', () => {
  const {
    s,
    barracks: [b],
  } = fresh();
  E.setArmyTarget(s, 0, 'infantry', 6);
  updateArmyComposition(s);
  const restored = E.load(E.save(s));
  assert.deepEqual(restored.sides[0].armyComposition, s.sides[0].armyComposition);
  assert.deepEqual(restored.buildings.find((v) => v.id === b.id).armyQueue, b.armyQueue);
  for (const mutate of [
    (p) => (p.targets.infantry = E.ARMY_TARGET_MAX + 1),
    (p) => (p.targets.leopard = -1),
    (p) => (p.nextAt = s.time + 20),
    (p) => (p.cursor = -1),
  ]) {
    const raw = JSON.parse(E.save(s));
    mutate(raw.sides[0].armyComposition);
    assert.throws(() => E.load(JSON.stringify(raw)));
  }
});

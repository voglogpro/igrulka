import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../src/game/state.js';
import { GROUND_UNITS } from '../../src/game/config.js';
import {
  setRecruitRepeat,
  recruitRepeatStatus,
  updateRecruitRepeat,
  RECRUIT_REPEAT,
} from '../../src/game/units/ground/repeat.js';
import { restoreEconomy } from '../../src/game/persistence/economy.js';
import { executeCommand } from '../../src/network/commands.js';

function fresh(sites = 1) {
  const s = createGame(117);
  for (const f of s.sides) {
    f.purchases = { building: {} };
    f.researchQueue = [];
    f.credits = 100000;
    f.materials = 1000;
    f.oil = 1000;
  }
  const barracks = [];
  for (let i = 0; i < sites; i++) {
    const b = {
      id: s.nextId++,
      side: 0,
      key: 'barracks',
      hp: 200,
      maxHp: 200,
      progress: 1,
      x: -650 - 60 * i,
      z: -80,
      armyQueue: [],
    };
    s.buildings.push(b);
    barracks.push(b);
  }
  return { s, barracks };
}
const unit = (s, properties = {}) =>
  s.groundUnits.push({ id: s.nextId++, side: 0, key: 'infantry', hp: 100, ...properties });

test('network garrison command preserves target, binds the owner and rejects malformed orders atomically', () => {
  const {
    s,
    barracks: [b],
  } = fresh();
  const command = { id: b.id, key: 'infantry', enabled: true, target: 6 };
  for (const target of [0, 121, 1.5, '6', Infinity]) {
    const before = JSON.stringify(s);
    assert.equal(typeof executeCommand(s, 0, 'repeat', { ...command, target }), 'string');
    assert.equal(JSON.stringify(s), before);
  }
  assert.equal(typeof executeCommand(s, 1, 'repeat', command), 'string');
  assert.equal(executeCommand(s, 0, 'repeat', command), true);
  assert.equal(b.recruitRepeat.target, 6);
  updateRecruitRepeat(s);
  assert.equal(b.armyQueue.length, 1);
  assert.equal(executeCommand(s, 0, 'repeat', { ...command, enabled: false }), true);
  assert.equal(b.recruitRepeat, null);
  assert.equal(b.armyQueue.length, 1, 'disabling keeps the paid recruit');
});

test('target plans share the side/type target across barracks and cannot overshoot with queued recruits', () => {
  const { s, barracks } = fresh(3);
  for (const b of barracks)
    assert.equal(setRecruitRepeat(s, 0, b.id, 'infantry', true, { target: 2 }), true);
  updateRecruitRepeat(s);
  assert.deepEqual(
    barracks.map((b) => b.armyQueue.length),
    [1, 1, 0],
  );
  const status = recruitRepeatStatus(s, 0, barracks[2].id);
  assert.equal(status.status, 'target-met');
  assert.equal(status.queuedType, 2);
  assert.equal(status.remaining, 0);
  assert.deepEqual(barracks[0].armyQueue[0], {
    key: 'infantry',
    progress: 0,
    stance: { mode: 'defend', post: 'auto' },
    autoDefense: true,
  });
  assert.deepEqual(status.reserves, RECRUIT_REPEAT.reserves);
});

test('live non-downed troops satisfy target; casualties replenish only after four simulated seconds', () => {
  const {
    s,
    barracks: [b],
  } = fresh();
  setRecruitRepeat(s, 0, b.id, 'infantry', true, { target: 2 });
  unit(s);
  unit(s);
  updateRecruitRepeat(s);
  assert.equal(recruitRepeatStatus(s, 0, b.id).status, 'target-met');
  s.groundUnits[0].downed = { t: 0 };
  unit(s, { side: 1 });
  unit(s, { hp: 0 });
  unit(s, { key: 'sniper' });
  s.time = 3.9;
  updateRecruitRepeat(s);
  assert.equal(b.armyQueue.length, 0);
  s.time = 4;
  updateRecruitRepeat(s);
  assert.equal(b.armyQueue.length, 1);
  assert.equal(recruitRepeatStatus(s, 0, b.id).present, 1);
  b.armyQueue = [];
  s.time = 4.1;
  updateRecruitRepeat(s);
  assert.equal(b.armyQueue.length, 0);
});

test('automatic purchase preserves money, materials and enabled oil reserves; legacy remains unchanged', () => {
  for (const resource of ['credits', 'materials', 'oil']) {
    const {
      s,
      barracks: [b],
    } = fresh();
    const key = resource === 'oil' ? 'armoredcar' : 'infantry';
    const d = GROUND_UNITS[key];
    if (d.tech) s.sides[0].tech.push(d.tech);
    assert.equal(setRecruitRepeat(s, 0, b.id, key, true, { target: 6 }), true);
    const base = resource === 'credits' ? d.cost : resource === 'materials' ? d.metal : d.oil || 0;
    s.sides[0][resource] = base + RECRUIT_REPEAT.reserves[resource] - 1;
    assert.equal(recruitRepeatStatus(s, 0, b.id).status, 'reserve');
    updateRecruitRepeat(s);
    assert.equal(b.armyQueue.length, 0);
    s.sides[0][resource]++;
    s.time = 4;
    updateRecruitRepeat(s);
    assert.equal(b.armyQueue.length, 1);
    assert.equal(s.sides[0][resource], RECRUIT_REPEAT.reserves[resource]);
  }
  const {
    s,
    barracks: [b],
  } = fresh();
  s.sides[0].credits = GROUND_UNITS.infantry.cost;
  setRecruitRepeat(s, 0, b.id, 'infantry');
  updateRecruitRepeat(s);
  assert.equal(s.sides[0].credits, 0);
  assert.deepEqual(b.recruitRepeat, { enabled: true, key: 'infantry' });
  assert.deepEqual(b.armyQueue[0], { key: 'infantry', progress: 0 });
});

test('disabled oil, destroyed barracks, invalid target and save validation are bounded', () => {
  const {
    s,
    barracks: [b],
  } = fresh();
  for (const target of [0, -1, 121, 1.5, Infinity, '12'])
    assert.equal(typeof setRecruitRepeat(s, 0, b.id, 'infantry', true, { target }), 'string');
  assert.equal(b.recruitRepeat, undefined);
  setRecruitRepeat(s, 0, b.id, 'infantry', true, { target: 12 });
  s.rules.oil = false;
  s.sides[0].oil = 0;
  updateRecruitRepeat(s);
  assert.equal(b.armyQueue.length, 1);
  const restored = structuredClone(s);
  restoreEconomy(restored, 14);
  assert.deepEqual(restored.buildings.at(-1).recruitRepeat, b.recruitRepeat);
  for (const mutate of [
    (p) => (p.target = 121),
    (p) => (p.reserves.credits = 0),
    (p) => (p.nextAt = Infinity),
    (p) => (p.nextAt = s.time + 5),
  ]) {
    const invalid = structuredClone(s);
    mutate(invalid.buildings.at(-1).recruitRepeat);
    assert.throws(() => restoreEconomy(invalid, 14), /гарнизона/);
  }
  b.hp = 0;
  s.time = 10;
  b.armyQueue = [];
  updateRecruitRepeat(s);
  assert.equal(b.armyQueue.length, 0);
  assert.equal(recruitRepeatStatus(s, 0, b.id).status, 'site-unavailable');
});

test('an empty oil tank cannot block automatic infantry that consumes no oil', () => {
  const {
    s,
    barracks: [b],
  } = fresh();
  s.sides[0].oil = 0;
  setRecruitRepeat(s, 0, b.id, 'infantry', true, { target: 6 });
  assert.equal(recruitRepeatStatus(s, 0, b.id).status, 'ready');
  updateRecruitRepeat(s);
  assert.equal(b.armyQueue.length, 1);
  assert.equal(s.sides[0].oil, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  STRIKE,
  strikeStockTarget,
  assaultCoverTarget,
  updateStrikes,
  updateStrikeProduction,
} from '../../src/game/ai/strike-ai.js';

function fresh(difficulty = 'normal') {
  const s = E.createGame(2303, { difficulty });
  s.rules.oil = false;
  s.ai.nextBuild = s.ai.nextArmy = s.ai.nextAttack = 1e9;
  for (const f of s.sides) {
    f.credits = 20000;
    f.materials = 3000;
    f.components = 500;
  }
  return s;
}
function ready(s, side, key, x, z) {
  const b = E.build(s, side, key, x, z);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function soldier(s, side, x, z, extra = {}) {
  const u = E.makeGround(s, side, 'infantry', x, z);
  u.holdFire = true;
  Object.assign(u, extra);
  s.groundUnits.push(u);
  return u;
}

test('the arsenal target follows spare money, not difficulty, and is bounded', () => {
  const targets = ['easy', 'ultra'].map((difficulty) => {
    const s = fresh(difficulty);
    s.sides[1].credits = 500;
    const low = strikeStockTarget(s, 1, 400);
    s.sides[1].credits = 400 + STRIKE.creditsPerCraft * 5;
    const mid = strikeStockTarget(s, 1, 400);
    s.sides[1].credits = 1e7;
    return [low, mid, strikeStockTarget(s, 1, 400)];
  });
  assert.deepEqual(targets[0], [STRIKE.baseStock, STRIKE.baseStock + 5, STRIKE.maxStock]);
  assert.deepEqual(targets[1], targets[0]);
});

test('weapon production is paid, keeps the reserve and stops at the factory queue limit', () => {
  const s = fresh();
  const factory = ready(s, 1, 'factory', E.HQ_X - 65, -10);
  factory.queue = [];
  const before = s.sides[1].credits;
  let made = 0;
  for (let i = 0; i < 10; i++) if (updateStrikeProduction(s, 1, 500)) made++;
  assert.equal(made, STRIKE.queuePerFactory);
  assert.equal(factory.queue.length, STRIKE.queuePerFactory);
  assert.ok(s.sides[1].credits < before);
  s.sides[1].credits = 450;
  factory.queue = [];
  assert.equal(updateStrikeProduction(s, 1, 500), null, 'never spends into the reserve');
});

test('drone cover aims at an observed enemy group ahead of the assault, never next to own troops', () => {
  const s = fresh();
  const assault = soldier(s, 1, 300, -1500, {
    stance: { mode: 'attack' },
    defenseAttack: {
      phase: 'active',
      home: { x: 400, z: -1500 },
      initial: 1,
      wave: 1,
      nextAt: 1e9,
    },
  });
  assert.equal(assaultCoverTarget(s, 1), null, 'no observed target, no blind strike');
  const group = [0, 1, 2].map((i) => soldier(s, 0, 120, -1500 + i * 6));
  const close = soldier(s, 0, assault.x - 30, assault.z);
  const target = assaultCoverTarget(s, 1);
  assert.ok(target);
  assert.ok(group.some((u) => Math.hypot(u.x - target.x, u.z - target.z) < 1));
  assert.ok(Math.hypot(close.x - target.x, close.z - target.z) > 1);
  assert.ok(Math.hypot(assault.x - target.x, assault.z - target.z) >= STRIKE.safeDistance);
  delete assault.defenseAttack;
  assert.equal(assaultCoverTarget(s, 1), null, 'no assault, no cover');
});

test('an active assault is covered by real paid drones launched from a stocked pad', () => {
  const s = fresh();
  const pad = ready(s, 1, 'launcher', E.HQ_X - 120, 80);
  s.sides[1].inventory.drone = 3;
  E.initLaunchStore(pad);
  s.sides[1].inventory.drone -= E.acceptLaunchDelivery(pad, 'drone', 3);
  soldier(s, 1, 300, -1500, {
    stance: { mode: 'attack' },
    defenseAttack: {
      phase: 'active',
      home: { x: 400, z: -1500 },
      initial: 1,
      wave: 1,
      nextAt: 1e9,
    },
  });
  for (let i = 0; i < 3; i++) soldier(s, 0, 120, -1500 + i * 6);
  const launched = updateStrikes(s, 1, 500);
  assert.ok(launched >= 1);
  const drones = s.units.filter((u) => u.side === 1 && u.key === 'drone');
  assert.equal(drones.length, launched);
  assert.ok(drones.every((u) => u.targetKind === 'point' && Math.abs(u.tx - 120) < 1));
  assert.equal(updateStrikes(s, 1, 500), 0, 'decisions keep a fixed cadence');
});

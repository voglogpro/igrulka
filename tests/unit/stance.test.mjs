import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { executeCommand } from '../../src/network/commands.js';

function fresh() {
  const s = E.createGame(2024);
  s.mode = 'multiplayer';
  for (const f of s.sides) {
    f.credits = 1e6;
    f.materials = 1e6;
    f.tech = Object.keys(E.TECH);
  }
  s.buildings.push({
    id: s.nextId++,
    key: 'barracks',
    side: 0,
    x: -560,
    z: 60,
    hp: 700,
    maxHp: 700,
    progress: 1,
    armyQueue: [],
  });
  s.networkRevision++;
  return s;
}

test('recruits with a defend stance walk to a bridge, hold the post and dig in', () => {
  const s = fresh();
  assert.equal(E.recruit(s, 0, 'infantry', null, 3, { mode: 'defend', post: 'south' }), true);
  // The widened 8.8 map adds a longer physical march after disconnected barracks training.
  E.advance(s, 165);
  const troops = s.groundUnits.filter((u) => u.side === 0);
  assert.equal(troops.length, 3);
  assert.ok(troops.every((u) => u.stance?.post === 'south' && u.guard));
  const post = E.bridgePoint(0, 'south');
  assert.ok(troops.every((u) => Math.hypot(u.x - post.x, u.z - post.z) < 70));
  E.advance(s, 60);
  assert.ok(s.trenches.some((t) => t.side === 0 && t.progress >= 1));
});

test('automatic bridge choice balances defenders and attack stance heads for the enemy base', () => {
  const s = fresh();
  const a = E.makeGround(s, 0, 'infantry', -500, 0),
    b = E.makeGround(s, 0, 'infantry', -500, 12);
  s.groundUnits.push(a, b);
  assert.equal(typeof E.applyStance(s, 0, [a.id], { mode: 'defend', post: 'north' }), 'number');
  assert.equal(E.chooseBridge(s, 0), 'south');
  assert.equal(typeof E.applyStance(s, 0, [b.id], { mode: 'attack' }), 'number');
  assert.equal(b.order.mode, 'attackmove');
  assert.equal(b.stance.mode, 'attack');
  // A manual order replaces the stance.
  E.orderGround(s, 0, [b.id], { x: -300, z: 0 });
  assert.equal(b.stance, null);
});

test('network commands validate stances and save/load keeps them', () => {
  const s = fresh();
  const u = E.makeGround(s, 0, 'infantry', -500, 0);
  s.groundUnits.push(u);
  assert.equal(
    typeof executeCommand(s, 0, 'set-stance', { ids: [u.id], stance: { mode: 'x' } }),
    'string',
  );
  assert.equal(
    executeCommand(s, 0, 'recruit', { key: 'infantry', count: 1, stance: { mode: 'x' } }),
    'Некорректная команда',
  );
  assert.equal(
    typeof executeCommand(s, 0, 'set-stance', {
      ids: [u.id],
      stance: { mode: 'defend', post: 'auto' },
    }),
    'number',
  );
  const copy = E.load(E.save(s)).groundUnits.find((v) => v.id === u.id);
  assert.equal(copy.stance.mode, 'defend');
  E.recruit(s, 0, 'infantry', null, 1, { mode: 'attack' });
  assert.equal(
    E.load(E.save(s)).buildings.find((b) => b.key === 'barracks').armyQueue[0].stance.mode,
    'attack',
  );
});

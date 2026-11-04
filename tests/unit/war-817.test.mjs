import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { roadPreview as roadPlacement } from '../../src/game/city/roads.js';

test('big war: the player and an allied bot face two bots; only enemies get the difficulty bonus', () => {
  const s = E.createGame(5, { mode: 'war', difficulty: 'hard' });
  assert.equal(s.sides.length, 4);
  assert.deepEqual(E.aiSides(s), [1, 2, 3]);
  assert.equal(E.allied(s, 0, 2), true);
  assert.equal(E.hostile(s, 0, 1), true);
  assert.equal(E.economy(s, 2).bonus, 1);
  assert.ok(E.economy(s, 1).bonus > 1);
  const loaded = E.load(E.save(s));
  assert.deepEqual(Object.keys(loaded.aiBySide), ['2', '3']);
});

test('free-for-all: four cities, every one hostile, bots of different strength, last one wins', () => {
  const s = E.createGame(7, { mode: 'ffa' });
  assert.deepEqual(
    [0, 1, 2, 3].map((side) => E.teamOf(s, side)),
    [0, 1, 2, 3],
  );
  for (const a of [0, 1, 2, 3])
    for (const b of [0, 1, 2, 3]) assert.equal(E.hostile(s, a, b), a !== b);
  const bonuses = [1, 2, 3].map((side) => E.economy(s, side).bonus);
  assert.equal(new Set(bonuses).size, 3, 'each bot has its own strength');
  assert.equal(E.frontDirection(s, 0), 1);
  assert.equal(E.frontDirection(s, 1), -1);
  E.load(E.save(s));
  for (const side of [1, 2]) E.hqOf(s, side).hp = 0;
  // A rival on the same bank is the next enemy once the city across the sea is gone.
  assert.equal(E.pairedEnemy(s, 0), 3);
  E.hqOf(s, 3).hp = 0;
  E.step(s, 0.05);
  assert.equal(s.result, 'victory');
});

test('a free-for-all attack on a rival of the same bank goes overland, not across the sea', () => {
  const s = E.createGame(9, { mode: 'ffa' });
  s.rules.rear = false;
  E.hqOf(s, 1).hp = 0;
  E.hqOf(s, 3).hp = 0;
  for (let i = 0; i < 30; i++) {
    const u = E.makeGround(s, 0, 'machinegunner', -1700 + (i % 6) * 6, -1000 + i * 4);
    u.autoDefense = true;
    u.stance = { mode: 'defend', post: 'auto' };
    u.guard = { x: u.x, z: u.z };
    u.defensePost = { corridorId: 'north', slot: i % 3, row: 0 };
    s.groundUnits.push(u);
  }
  assert.equal(typeof E.launchDefenseAttack(s, 0), 'number');
  const wave = s.groundUnits.filter((u) => u.defenseAttack);
  assert.ok(wave.length > 0);
  assert.ok(wave.every((u) => u.order.x < 0 && u.routeQueue.every((p) => p.x < 0)));
});

test('a bomber drops a stick of FAB bombs on target, flies home and lands back on its pad', () => {
  const s = E.createGame(31);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextArmy = s.ai.nextStrike = 1e9;
  s.rules.oil = false;
  Object.assign(s.sides[0], { credits: 1e5, materials: 1e4, components: 500 });
  let pad = null;
  for (let dz = -200; dz < 200 && !pad; dz += 20) {
    const b = E.build(s, 0, 'launcher', -E.HQ_X + 150, dz);
    if (typeof b !== 'string') pad = b;
  }
  pad.progress = 1;
  pad.hp = pad.maxHp;
  assert.equal(E.launchSiteAllows(pad, 'bomber'), true);
  assert.equal(E.acceptLaunchDelivery(pad, 'bomber', 1), 1);
  const hq = E.hqOf(s, 1);
  assert.equal(E.launch(s, 0, 'bomber', hq.id, 1, pad.id), 1);
  let high = 0;
  for (let t = 0; t < 6000 && !s.events.some((e) => e.type === 'landed'); t++) {
    E.step(s, 0.05);
    for (const b of s.bombs) high = Math.max(high, b.y);
  }
  assert.ok(high > 80, 'bombs fall from altitude');
  for (let t = 0; t < 4000 && s.units.some((u) => u.hp > 0); t++) E.step(s, 0.05);
  const blasts = s.events.filter((e) => e.type === 'impact' && e.key === 'fab');
  assert.equal(blasts.length, E.WEAPONS.bomber.bombs);
  assert.ok(blasts.every((e) => Math.hypot(e.x - hq.x, e.z - hq.z) < 60));
  assert.ok(hq.hp < hq.maxHp * 0.6);
  assert.equal(pad.launchStore.bomber, 1, 'the aircraft is back on its pad');
  assert.ok(s.events.some((e) => e.type === 'landed'));
  E.load(E.save(s));
});

test('roads climb over hills at a higher price instead of being refused', () => {
  const s = E.createGame(3);
  const hill = E.HILLS.find((h) => E.groundHeight(h.x, h.z) > 5 && Math.abs(h.x) > 950);
  assert.ok(hill, 'a hill on land');
  const flat = roadPlacement(s, 0, hill.x - 300, hill.z + 900, hill.x + 300, hill.z + 900);
  const over = roadPlacement(s, 0, hill.x - 300, hill.z, hill.x + 300, hill.z);
  assert.ok(!/холм/.test(over.error || ''), over.error);
  assert.ok(over.cost > Math.ceil(600 * 0.8));
  assert.ok(!flat.error || !/холм/.test(flat.error));
});

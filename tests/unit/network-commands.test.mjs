import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../../src/game/index.js';
import { executeCommand } from '../../src/network/commands.js';
import { playerView } from '../../src/network/perspective.js';
import { damageGround } from '../../src/game/units/ground/combat.js';

function fresh() {
  const s = game.createGame(412);
  s.mode = 'multiplayer';
  for (const f of s.sides) {
    f.credits = 100000;
    f.materials = 10000;
    f.tech = [];
  }
  return s;
}

function unit(s, side, key, x, z) {
  const u = game.makeGround(s, side, key, x, z);
  s.groundUnits.push(u);
  return u;
}

function finiteTree(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), value);
  else if (value && typeof value === 'object')
    for (const nested of Object.values(value)) finiteTree(nested);
}

test('unknown and inherited configuration keys cannot mutate resources or crash the command gateway', () => {
  const s = fresh();
  const b = game.build(s, 0, 'barracks', -1080, -10);
  assert.notEqual(typeof b, 'string', b);
  b.hp = b.maxHp;
  b.progress = 1;
  const before = [s.sides[0].credits, s.sides[0].materials, s.buildings.length];
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    for (const [type, args] of [
      ['build', { key, x: -850, z: 300 }],
      ['produce', { key }],
      ['research', { key }],
      ['launch', { key, aim: { x: 0, z: 0 }, count: 1 }],
      ['recruit', { key, count: 1, siteId: b.id }],
      ['repeat', { key, enabled: true, id: b.id }],
    ])
      assert.equal(
        executeCommand(s, 0, type, JSON.parse(JSON.stringify(args))),
        'Некорректная команда',
      );
  }
  assert.deepEqual([s.sides[0].credits, s.sides[0].materials, s.buildings.length], before);
  finiteTree(s);
});

test('malformed JSON shapes are rejected without exceptions or authority changes', () => {
  const s = fresh();
  const before = JSON.stringify(s);
  for (const [type, args] of [
    ['group', { index: 1, ids: { length: 0 } }],
    ['group', { index: 1, ids: '' }],
    ['order', { ids: [3], aim: { x: Number.POSITIVE_INFINITY, z: 0, mode: 'move' } }],
    ['build', JSON.parse('{"key":"barracks","x":0,"z":0,"__proto__":{"side":1}}')],
    ['guard', { ids: [], here: true }],
  ]) {
    assert.doesNotThrow(() => executeCommand(s, 0, type, args));
    assert.equal(typeof executeCommand(s, 0, type, args), 'string');
  }
  assert.equal(executeCommand(s, 2, 'formation', { value: 'spread' }), 'Некорректная команда');
  assert.equal(executeCommand(s, 0, 'formation', []), 'Некорректная команда');
  assert.equal(JSON.stringify(s), before);
});

test('side 1 can command only its own units and objects with unchanged world coordinates and IDs', () => {
  const s = fresh();
  const one = unit(s, 1, 'infantry', 900, 250);
  const zero = unit(s, 0, 'infantry', -900, 250);
  const enemyBarracks = game.build(s, 0, 'barracks', -1080, -10);
  assert.notEqual(typeof enemyBarracks, 'string', enemyBarracks);
  assert.equal(executeCommand(s, 1, 'formation', { value: 'spread' }), true);
  assert.equal(s.formations[1], 'spread');
  assert.equal(s.formations[0], 'line');
  assert.deepEqual(executeCommand(s, 1, 'group', { index: 1, ids: [one.id] }), [one.id]);
  assert.equal(
    typeof executeCommand(s, 1, 'order', { ids: [zero.id], aim: { x: 800, z: 250, mode: 'move' } }),
    'string',
  );
  assert.equal(
    executeCommand(s, 1, 'order', { ids: [one.id], aim: { x: 850, z: 250, mode: 'move' } }),
    1,
  );
  assert.equal(one.order.x, 850);
  assert.equal(one.order.z, 250);
  assert.equal(
    executeCommand(s, 1, 'repair', { id: s.buildings[0].id }),
    'Объект вам не принадлежит',
  );
  for (const [type, args] of [
    ['recruit', { key: 'infantry', count: 1, siteId: enemyBarracks.id }],
    ['launch', { key: 'drone', count: 1, siteId: enemyBarracks.id, aim: { x: 0, z: 0 } }],
    ['rally', { id: enemyBarracks.id, point: { x: 900, z: 250 } }],
    ['rally-mode', { id: enemyBarracks.id, mode: 'guard' }],
    ['repeat', { id: enemyBarracks.id, key: 'infantry', enabled: true }],
  ])
    assert.equal(typeof executeCommand(s, 1, type, args), 'string');
  assert.equal(typeof executeCommand(s, 0, 'board', { ids: [zero.id], id: one.id }), 'string');
});

test('a hidden infantry ID cannot be used as a forced attack target', () => {
  const s = fresh();
  const patch = game.COVER_PATCHES.find((p) => p.x < -100 && p.x > -1300 && Math.abs(p.z) < 800);
  const hidden = unit(s, 0, 'infantry', patch.x, patch.z);
  hidden.camouflaged = true;
  const attacker = unit(s, 1, 'infantry', 850, 300);
  assert.equal(game.groundVisible(s, 1, hidden), false);
  assert.equal(
    executeCommand(s, 1, 'order', {
      ids: [attacker.id],
      aim: { x: hidden.x, z: hidden.z, mode: 'attack', targetId: hidden.id },
    }),
    'Недоступная цель',
  );
  assert.equal(attacker.order, null);
});

test('projection hides concealed infantry, private effects and future enemy plans', () => {
  const s = fresh();
  const patch = game.COVER_PATCHES.find(
    (p) =>
      p.x > 100 &&
      p.x < 1300 &&
      Math.abs(p.z) < 800 &&
      game.groundHeight(p.x, p.z) < 0.5 &&
      game.terrainClear(p.x - 180, p.z, 2.2, p.x + 40, p.z, 2.2),
  );
  const hidden = unit(s, 1, 'mog', patch.x, patch.z);
  hidden.camouflaged = true;
  const visible = unit(s, 1, 'infantry', 900, 420);
  // Friendly observers: one near the visible soldier, one near the drone below.
  unit(s, 0, 'sniper', 870, 420);
  unit(s, 0, 'sniper', 680, 20);
  visible.path = [{ x: -900, z: 420 }];
  visible.guard = { x: 910, z: 420 };
  visible.xp = 360;
  const b = game.build(s, 1, 'barracks', 1080, -10);
  assert.notEqual(typeof b, 'string', b);
  b.armyQueue = [{ key: 'sniper', progress: 0.5 }];
  b.recruitRepeat = { enabled: true, key: 'sniper' };
  b.rally = { x: 700, z: 120 };
  s.contacts[1].push({ x: -800, z: 300, unitId: 900, radius: 20, expires: 20, time: 0 });
  s.contacts[0].push({
    x: patch.x + 4,
    z: patch.z + 5,
    unitId: hidden.id,
    radius: 20,
    expires: 20,
    time: 0,
  });
  s.groups[1][2] = [hidden.id];
  s.projectiles.push({
    id: s.nextId++,
    side: 1,
    source: hidden.id,
    domain: 'ground',
    kind: 'bullet',
    x: patch.x,
    y: 2,
    z: patch.z,
  });
  s.projectiles.push({
    id: s.nextId++,
    side: 1,
    sourceId: hidden.id,
    kind: 'bullet',
    x: patch.x,
    y: 3,
    z: patch.z,
  });
  s.events.push({
    id: s.nextId++,
    type: 'shot',
    side: 1,
    buildingId: hidden.id,
    x: hidden.x,
    z: hidden.z,
    ground: true,
  });
  s.events.push({
    id: s.nextId++,
    type: 'shot',
    side: 1,
    buildingId: hidden.id,
    x: hidden.x,
    z: hidden.z,
  });
  s.events.push({
    id: s.nextId++,
    type: 'recruited',
    side: 1,
    unitId: hidden.id,
    x: hidden.x,
    z: hidden.z,
  });
  s.units.push({
    id: s.nextId++,
    side: 1,
    key: 'drone',
    x: 1000,
    y: 5,
    z: 0,
    hp: 30,
    delay: 5,
    launched: false,
    tx: -1000,
    tz: 0,
    route: [{ x: 0, z: 0 }],
  });
  s.units.push({
    id: s.nextId++,
    side: 1,
    key: 'drone',
    x: 700,
    y: 30,
    z: 20,
    hp: 30,
    maxHp: 30,
    delay: 0,
    launched: true,
    vx: -20,
    vy: 0,
    vz: 0,
    phase: 0,
    tx: -1000,
    tz: 0,
    route: [{ x: 0, z: 0 }],
    targetId: 1,
  });
  const view = playerView(s, 0);
  assert.ok(!view.groundUnits.some((u) => u.id === hidden.id));
  assert.ok(view.groundUnits.some((u) => u.id === visible.id));
  assert.equal(view.groundUnits.find((u) => u.id === visible.id).path, undefined);
  assert.equal(view.groundUnits.find((u) => u.id === visible.id).guard, undefined);
  assert.equal(view.groundUnits.find((u) => u.id === visible.id).xp, undefined);
  assert.equal(view.projectiles.length, 0);
  assert.ok(view.events.every((e) => e.type === 'build'));
  assert.equal(view.units.length, 1);
  assert.equal(view.units[0].route, undefined);
  assert.equal(view.units[0].targetId, undefined);
  assert.notEqual(view.units[0].tx, -600);
  assert.equal(view.buildings.find((site) => site.id === b.id).armyQueue, undefined);
  assert.equal(view.buildings.find((site) => site.id === b.id).recruitRepeat, undefined);
  assert.equal(view.sides[1].credits, 0);
  assert.deepEqual(view.groups[1], {});
  assert.deepEqual(view.contacts[1], []);
  assert.equal(view.contacts[0][0].unitId, undefined);
  assert.equal(view.seed, undefined);
  assert.equal(view.rng, undefined);
  assert.equal(view.nextId, undefined);
  finiteTree(view);
  assert.ok(JSON.stringify(view).length > 0);
  assert.equal(s.groundUnits.find((u) => u.id === hidden.id).camouflaged, true);
});

test('visible enemy death effects survive removal while concealed casualties stay private', () => {
  const s = fresh();
  const patch = game.COVER_PATCHES.find(
    (p) =>
      p.x > 100 &&
      p.x < 1300 &&
      Math.abs(p.z) < 800 &&
      game.groundHeight(p.x, p.z) < 0.5 &&
      game.terrainClear(p.x - 180, p.z, 2.2, p.x + 40, p.z, 2.2),
  );
  const hidden = unit(s, 1, 'infantry', patch.x, patch.z);
  hidden.camouflaged = true;
  const visible = unit(s, 1, 'infantry', 900, 420);
  const tank = unit(s, 0, 'leopard', -900, 420);
  unit(s, 0, 'sniper', 870, 420);
  assert.equal(game.groundVisible(s, 0, hidden), false);
  assert.equal(game.groundVisible(s, 0, visible), true);
  for (const u of [hidden, visible, tank]) damageGround(s, u, 100000);
  const deaths = s.events.filter((e) => e.type === 'groundDestroyed');
  assert.deepEqual(deaths.find((e) => e.unitId === hidden.id).visibleTo, [1]);
  assert.deepEqual(deaths.find((e) => e.unitId === visible.id).visibleTo, [0, 1]);
  // The far-away tank is outside every enemy observer's range.
  assert.deepEqual(deaths.find((e) => e.unitId === tank.id).visibleTo, [0]);
  s.groundUnits = [];
  const one = playerView(s, 1);
  const zero = playerView(s, 0);
  assert.deepEqual(
    zero.events.filter((e) => e.type === 'groundDestroyed').map((e) => e.unitId),
    [visible.id, tank.id],
  );
  assert.equal(one.events.filter((e) => e.type === 'groundDestroyed').length, 2);
  assert.ok(one.events.every((e) => !Object.hasOwn(e, 'visibleTo')));
  assert.ok(zero.events.every((e) => !Object.hasOwn(e, 'visibleTo')));
  assert.ok(deaths.every((e) => Array.isArray(e.visibleTo)));
  assert.equal(one.events.find((e) => e.unitId === visible.id).side, 0);
});

test('side 1 projection reverses ownership, private arrays and victory while preserving identity', () => {
  const s = fresh();
  const own = unit(s, 1, 'infantry', 900, 300);
  unit(s, 0, 'infantry', -900, 300);
  s.sides[0].credits = 8888;
  s.sides[1].credits = 1234;
  s.groups[0][1] = [9];
  s.groups[1][2] = [own.id];
  s.formations = ['column', 'spread'];
  s.contacts[0].push({ x: 900, z: 300, radius: 20, expires: 20, time: 0, unitId: own.id });
  s.contacts[1].push({ x: -900, z: 300, radius: 20, expires: 20, time: 0 });
  s.result = 'victory';
  s.events.push({ id: s.nextId++, type: 'result', result: 'victory' });
  const view = playerView(s, 1);
  assert.equal(view.sides[0].credits, 1234);
  assert.equal(view.sides[1].credits, 0);
  assert.deepEqual(view.groups[0][2], [own.id]);
  assert.deepEqual(view.groups[1], {});
  assert.equal(view.formations[0], 'spread');
  assert.equal(view.formations[1], 'line');
  assert.equal(view.contacts[0][0].x, -900);
  assert.deepEqual(view.contacts[1], []);
  assert.equal(view.groundUnits.find((u) => u.id === own.id).side, 0);
  assert.equal(view.groundUnits.find((u) => u.id === own.id).x, 900);
  assert.equal(view.buildings.find((b) => b.id === 2).side, 0);
  assert.equal(view.result, 'defeat');
  assert.equal(view.events[0].result, 'defeat');
  assert.equal(s.result, 'victory');
  finiteTree(view);
});

test('multiplayer has equal starting economy and never invokes the solo AI', () => {
  const s = game.createGame(8);
  s.mode = 'multiplayer';
  const a = game.economy(s, 0);
  const b = game.economy(s, 1);
  assert.equal(a.bonus, 1);
  assert.equal(b.bonus, 1);
  assert.equal(a.net, b.net);
  assert.equal(a.materials, b.materials);
  s.time = 231;
  s.ai.nextBuild = 0;
  s.ai.nextArmy = 0;
  const before = [s.buildings.length, s.groundUnits.length];
  game.step(s, 0.05);
  assert.deepEqual([s.buildings.length, s.groundUnits.length], before);
  assert.equal(s.ai.nextBuild, 0);
  assert.equal(s.ai.nextArmy, 0);
});

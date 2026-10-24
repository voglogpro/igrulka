import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../../src/game/index.js';
import { GUARD_POST_CLEARANCE, GUARD_POST_RADIUS } from '../../src/game/units/ground/guard.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function fresh() {
  const s = game.createGame(39);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  s.rules.oil = false;
  for (const side of s.sides) {
    side.credits = 1e6;
    side.materials = 1e6;
  }
  return s;
}

function barracks(s, key = 'infantry') {
  const b = game.build(s, 0, game.recruitmentFacility(key), -1080, -10);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}

function unit(s, key, x = -1100, z = 300) {
  const u = game.makeGround(s, 0, key, x, z);
  s.groundUnits.push(u);
  return u;
}

function produce(key, count, setup = () => ({ x: -900, z: -40 })) {
  const s = fresh();
  const b = barracks(s, key);
  const rally = setup(s);
  assert.equal(game.setRally(s, 0, b.id, rally), true);
  // Explicit manual guards remain local; the 8.8 default guard now volunteers for the corridors.
  assert.equal(game.setRallyMode(s, 0, b.id, 'wait'), true);
  assert.equal(game.setArmyTarget(s, 0, key, count), true);
  const pinned = new Set();
  while (s.groundUnits.length < count && s.time < 2000) {
    game.step(s, 0.05);
    for (const u of s.groundUnits)
      if (!pinned.has(u.id)) {
        assert.equal(game.guardGround(s, 0, [u.id], rally), 1);
        assert.equal(u.autoDefense, false);
        pinned.add(u.id);
      }
  }
  assert.equal(s.groundUnits.length, count);
  assert.equal(game.setArmyTarget(s, 0, key, 0), true);
  // Even the last recruit must physically cross the expanded map to its corner post.
  game.advance(s, 150);
  assert.equal(b.armyQueue.length, 0);
  assert.equal(s.groundUnits.length, count);
  return { s, b, rally, units: s.groundUnits };
}

function separated({ s, rally, units }) {
  assert.ok(
    units.every((u) => u.guard),
    'every recruit must receive a reachable reserved post',
  );
  assert.equal(new Set(units.map((u) => `${u.guard.x},${u.guard.z}`)).size, units.length);
  for (const u of units) {
    assert.ok(distance(u.guard, rally) <= GUARD_POST_RADIUS + 1e-6);
    assert.ok(Math.abs(u.guard.x) <= game.FIELD.x && Math.abs(u.guard.z) <= game.FIELD.z);
    assert.equal(
      game.walkable(s, u.guard.x, u.guard.z, game.GROUND_UNITS[u.key].size * 0.42),
      true,
    );
    assert.ok(
      distance(u, u.guard) <= 3,
      'the recruit must walk to its post instead of waiting at base',
    );
  }
  for (let i = 0; i < units.length; i++)
    for (let j = i + 1; j < units.length; j++) {
      const required =
        (game.GROUND_UNITS[units[i].key].size + game.GROUND_UNITS[units[j].key].size) * 0.5 +
        GUARD_POST_CLEARANCE;
      assert.ok(distance(units[i].guard, units[j].guard) >= required - 1e-6);
      assert.ok(distance(units[i], units[j]) > 2, 'settled recruits must not overlap');
    }
}

test('twenty actual auto-recruited soldiers obey manual guard with distinct posts at one rally', () => {
  const result = produce('infantry', 20);
  separated(result);
  assert.deepEqual(
    produce('infantry', 20).units.map((u) => u.guard),
    result.units.map((u) => u.guard),
    'the same seed and recruitment orders must reserve exactly the same posts',
  );
  const restored = game.load(game.save(result.s));
  assert.deepEqual(
    restored.groundUnits.map((u) => u.guard),
    result.units.map((u) => u.guard),
  );
  const ownPost = structuredClone(result.units[0].guard);
  const ownPosition = { x: result.units[0].x, z: result.units[0].z };
  assert.equal(game.guardGround(result.s, 0, [result.units[0].id], ownPost), 1);
  assert.deepEqual(result.units[0].guard, ownPost, 'a unit must not block its own reservation');
  assert.deepEqual({ x: result.units[0].x, z: result.units[0].z }, ownPosition);
  assert.equal(
    game.orderGround(result.s, 0, [result.units[0].id], { x: -850, z: -100, mode: 'move' }),
    1,
  );
  assert.equal(result.units[0].guard, null);
  assert.ok(result.units.slice(1).every((u) => u.guard));
});

test('ten actual auto-recruited APCs reserve larger footprints under manual guard', () => {
  separated(produce('apc', 10));
});

test('rally reservations remain separated near a city wall, forest, sea shore and map corner', async (t) => {
  const setups = {
    wall(s) {
      const wall = game.build(s, 0, 'launcher', -750, 100);
      assert.notEqual(typeof wall, 'string', wall);
      wall.progress = 1;
      wall.hp = wall.maxHp;
      return { x: wall.x + game.BUILDINGS.launcher.size * 0.56 + 25, z: wall.z };
    },
    forest: () => {
      const p = game.COVER_PATCHES.find(
        (p) => p.forest && p.r > 30 && p.x < 0 && Math.hypot(p.x + 615, p.z) < 700,
      );
      return { x: p.x, z: p.z };
    },
    shore: () => ({ x: -675, z: 0 }),
    corner: () => ({ x: -(game.FIELD.x - 9), z: -(game.FIELD.z - 6) }),
  };
  for (const [name, setup] of Object.entries(setups))
    await t.test(name, () => {
      const result = produce('infantry', 20, setup);
      separated(result);
      // Automatic digging can improve the cover after arrival; verify the original terrain too.
      const terrain = { ...result.s, trenches: [] };
      if (name === 'wall') assert.equal(game.coverInfo(terrain, result.units[0]).kind, 'Стена');
      if (name === 'forest') assert.equal(game.coverInfo(terrain, result.units[0]).kind, 'Лес');
      assert.ok(
        game.coverInfo(result.s, result.units[0]).cover >=
          game.coverInfo(terrain, result.units[0]).cover,
      );
      assert.doesNotThrow(() => game.load(game.save(result.s)));
    });
});

test('mixed infantry, MOG and vehicles reserve different spacing without teleporting', () => {
  const s = fresh();
  const units = [unit(s, 'infantry'), unit(s, 'mog'), unit(s, 'apc')];
  const rally = { x: -900, z: -40 };
  for (const u of units) {
    const before = { x: u.x, z: u.z };
    assert.equal(game.guardGround(s, 0, [u.id], rally), 1);
    assert.deepEqual({ x: u.x, z: u.z }, before, 'assigning a post must only set an order');
  }
  game.advance(s, 90);
  separated({ s, units, rally });
});

test('a drawn line keeps every exact preview post even when close spacing would fail rally occupancy', () => {
  const s = fresh();
  const units = Array.from({ length: 5 }, () => unit(s, 'apc'));
  const a = { x: -920, z: 250 },
    b = { x: -900, z: 250 };
  assert.equal(
    game.defendLineGround(
      s,
      0,
      units.map((u) => u.id),
      a,
      b,
    ),
    units.length,
  );
  assert.deepEqual(
    units.map((u) => u.guard),
    [
      { x: -920, z: 250 },
      { x: -915, z: 250 },
      { x: -910, z: 250 },
      { x: -905, z: 250 },
      { x: -900, z: 250 },
    ],
  );
});

test('a saturated rally refuses more posts and a paid recruit waits at its safe spawn', () => {
  const s = fresh();
  const b = barracks(s, 'apc');
  const rally = { x: -900, z: -40 };
  let rejected = 0;
  for (let i = 0; i < 80; i++) {
    const u = unit(s, 'apc');
    if (typeof game.guardGround(s, 0, [u.id], rally) === 'string') {
      assert.equal(u.guard, undefined);
      assert.equal(u.order, null);
      s.groundUnits.pop();
      rejected++;
    }
  }
  assert.ok(rejected > 0);
  assert.ok(s.groundUnits.length >= 10);
  const before = s.groundUnits.length;
  assert.equal(game.setRally(s, 0, b.id, rally), true);
  assert.equal(game.recruit(s, 0, 'apc', b.id), true);
  b.armyQueue[0].progress = 0.999;
  for (let i = 0; i < 10 && s.groundUnits.length === before; i++) game.step(s, 0.05);
  assert.equal(s.groundUnits.length, before + 1);
  const recruit = s.groundUnits.at(-1);
  assert.equal(recruit.guard, undefined);
  assert.equal(recruit.order, null);
  assert.ok(distance(recruit, b) < 80);
  assert.equal(game.walkable(s, recruit.x, recruit.z, game.GROUND_UNITS.apc.size * 0.42), true);
  assert.doesNotThrow(() => game.load(game.save(s)));
});

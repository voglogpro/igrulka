import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../../src/game/index.js';

function campaign() {
  const s = game.createGame(39);
  s.mode = 'multiplayer';
  const b = game.build(s, 0, 'barracks', -680, -10);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp;
  s.groundUnits.push(game.makeGround(s, 0, 'infantry', -500, -40));
  return { s, b, u: s.groundUnits[0] };
}

const invalidKeys = ['constructor', '__proto__', 'unknown-saved-key'];
const fields = {
  'automatic recruitment': ({ b }, key) => (b.recruitRepeat = { enabled: true, key }),
  'army queue': ({ b }, key) => (b.armyQueue = [{ key, progress: 0 }]),
  'guarded ground unit': ({ u }, key) => {
    u.key = key;
    u.guard = { x: -500, z: -40 };
  },
  building: ({ b }, key) => (b.key = key),
  'active research': ({ s }, key) => (s.sides[0].research = { key, progress: 0 }),
  'completed research': ({ s }, key) => s.sides[0].tech.push(key),
  'aircraft production queue': ({ b }, key) => (b.queue = [{ key, progress: 0 }]),
  aircraft: ({ s }, key) =>
    s.units.push({
      key,
      side: 0,
      x: 0,
      y: 20,
      z: 0,
      hp: 10,
      startX: 0,
      startZ: 0,
      tx: 100,
      tz: 0,
      total: 100,
      travelled: 0,
      delay: 0,
    }),
  inventory: ({ s }, key) =>
    Object.defineProperty(s.sides[0].inventory, key, {
      value: 1,
      enumerable: true,
      configurable: true,
    }),
};

for (const [label, change] of Object.entries(fields))
  test(`save import rejects inherited and unknown registry keys in ${label} before simulation`, () => {
    for (const key of invalidKeys) {
      const fixture = campaign();
      change(fixture, key);
      assert.throws(() => game.load(game.save(fixture.s)), undefined, `${label}: ${key}`);
    }
  });

test('valid repeat, rally and guard fields survive import, one tick and another save', () => {
  const { s, b, u } = campaign();
  const rally = { x: -500, z: -40 };
  assert.equal(game.setRally(s, 0, b.id, rally), true);
  assert.equal(game.setRallyMode(s, 0, b.id, 'guard'), true);
  assert.equal(game.setRecruitRepeat(s, 0, b.id, 'infantry'), true);
  assert.equal(game.guardGround(s, 0, [u.id], rally), 1);
  const restored = game.load(game.save(s));
  const savedBarracks = restored.buildings.find((site) => site.id === b.id);
  assert.deepEqual(savedBarracks.recruitRepeat, b.recruitRepeat);
  assert.deepEqual(savedBarracks.rally, rally);
  assert.equal(savedBarracks.rallyMode, 'guard');
  assert.deepEqual(restored.groundUnits[0].guard, u.guard);
  game.step(restored, 0.05);
  assert.ok(Number.isFinite(restored.sides[0].credits));
  assert.ok(Number.isFinite(restored.sides[0].materials));
  assert.ok(Number.isFinite(savedBarracks.armyQueue[0].progress));
  assert.doesNotThrow(() => game.load(game.save(restored)));
});

test('malformed rally values cannot enter an imported campaign', () => {
  const values = [
    ...invalidKeys,
    0,
    false,
    [],
    {},
    { x: '10', z: 20 },
    { x: 10, z: null },
    { x: Infinity, z: 20 },
    { x: game.FIELD.x + 1, z: 0 },
    { x: 0, z: game.FIELD.z + 1 },
  ];
  for (const rally of values) {
    const { s, b } = campaign();
    b.rally = rally;
    assert.throws(() => game.load(game.save(s)), /Повреждена точка сбора/);
  }
});

test('rally import preserves actual setRally boundaries and older absent/null rally fields', () => {
  for (const rally of [
    { x: 864, z: 584 },
    { x: -864, z: -584 },
  ]) {
    const { s, b } = campaign();
    assert.equal(game.setRally(s, 0, b.id, rally), true);
    assert.deepEqual(
      game.load(game.save(s)).buildings.find((site) => site.id === b.id).rally,
      rally,
    );
  }
  for (const rally of [undefined, null]) {
    const { s, b } = campaign();
    if (rally !== undefined) b.rally = rally;
    assert.doesNotThrow(() => game.load(game.save(s)));
  }
});

test('legacy retired scout inventory is migrated before current registry validation', () => {
  const { s } = campaign();
  s.version = 5;
  s.groundUnits = [];
  s.sides[0].inventory.scout = 2;
  const restored = game.load(game.save(s));
  assert.equal(Object.hasOwn(restored.sides[0].inventory, 'scout'), false);
  assert.ok(restored.sides[0].credits >= s.sides[0].credits + 130);
  assert.doesNotThrow(() => game.load(game.save(restored)));
});

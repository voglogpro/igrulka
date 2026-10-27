import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { moveGroundUnit, groundMovementMetrics } from '../../src/game/units/ground/movement.js';
import { groundStepClear } from '../../src/game/units/ground/navigation.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const radius = (u) => E.GROUND_UNITS[u.key].size * 0.42;
function fresh() {
  const s = E.createGame(812, { mode: 'multiplayer' });
  s.rules.oil = false;
  s.rules.rear = false;
  for (const d of s.districts) {
    d.owner = 0;
    d.control = 1;
  }
  return s;
}
function separation(units) {
  let margin = Infinity;
  for (let i = 0; i < units.length; i++)
    for (let j = i + 1; j < units.length; j++)
      margin = Math.min(
        margin,
        distance(units[i], units[j]) - radius(units[i]) - radius(units[j]) - 0.34,
      );
  assert.ok(margin >= -1e-6, `physical footprints overlap by ${-margin}m`);
}

test('two moving heavy units bypass their shared intermediate vertex and cold-save replay retains final orders', () => {
  const s = fresh(),
    settings = [
      ['ifv', -882.8296449332062, -122.00351196031042, { x: -780, z: -220 }],
      ['mlrs', -889.8215642865649, -118.51572579759736, { x: -800, z: -240 }],
    ];
  for (const [key, x, z, goal] of settings) {
    const u = E.makeGround(s, 0, key, x, z);
    u.path = [{ x: -888, z: -120 }, { x: -864, z: -144 }, { ...goal }];
    u.order = { ...goal, mode: 'move', targetId: null };
    s.groundUnits.push(u);
  }
  separation(s.groundUnits);
  const orders = s.groundUnits.map((u) => structuredClone(u.order));
  function travel(state, seconds) {
    for (let i = 0; i < seconds * 20; i++) {
      state.time += 0.05;
      for (const u of state.groundUnits) {
        const before = { x: u.x, z: u.z },
          speed = E.GROUND_UNITS[u.key].speed;
        moveGroundUnit(state, u, 0.05, speed);
        assert.ok(distance(before, u) <= speed * 0.05 + 1e-6);
        assert.ok(groundStepClear(state, before, u, radius(u)));
      }
      separation(state.groundUnits);
      assert.ok((groundMovementMetrics(state)?.replans || 0) <= 2);
    }
  }
  travel(s, 1);
  const cold = E.load(E.save(s));
  travel(s, 12);
  travel(cold, 12);
  for (let i = 0; i < s.groundUnits.length; i++) {
    const u = s.groundUnits[i],
      copy = cold.groundUnits[i];
    assert.equal(u.path.length, 0, 'a moving neighbor must not pin the shared route vertex');
    assert.ok(distance(u, orders[i]) <= 1);
    assert.deepEqual(u.order, orders[i]);
    assert.deepEqual(
      [copy.x, copy.z, copy.path, copy.yaw, copy.order],
      [u.x, u.z, u.path, u.yaw, u.order],
    );
  }
});

test('the actual dense8m mixed HQ deployment reaches every depot post by170s without teleporting or intersecting footprints', () => {
  const s = fresh(),
    keys = [
      ...Array(12).fill('infantry'),
      'atrifle',
      'atgm',
      'leopard',
      'lighttank',
      'tankdestroyer',
      'ifv',
      'shilka',
      'gepard',
      'mog',
      'howitzer',
      'mlrs',
    ];
  const troops = keys.map((key, i) => {
    const u = E.makeGround(s, 0, key, -900 - (i % 5) * 8, (Math.floor(i / 5) - 4) * 8);
    u.holdFire = true;
    s.groundUnits.push(u);
    return u;
  });
  separation(troops);
  assert.equal(
    E.applyStance(
      s,
      0,
      troops.map((u) => u.id),
      { mode: 'defend', post: 'auto' },
    ),
    troops.length,
  );
  for (let step = 0; step < 3400; step++) {
    const before = troops.map((u) => ({ x: u.x, z: u.z }));
    E.step(s, 0.05);
    for (let i = 0; i < troops.length; i++)
      assert.ok(
        distance(troops[i], before[i]) <= E.GROUND_UNITS[troops[i].key].speed * 0.05 + 1e-6,
        `${troops[i].key} exceeded its physical movement budget`,
      );
    separation(troops);
  }
  for (const u of troops) {
    assert.ok(u.guard && u.defensePost, `${u.key} has no real depot post`);
    assert.equal(u.path.length, 0, `${u.key} stalled in transit at ${u.x},${u.z}`);
    assert.ok(distance(u, u.guard) <= 3, `${u.key} failed to reach its position`);
  }
});

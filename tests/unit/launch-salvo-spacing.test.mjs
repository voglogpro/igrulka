import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { COMBAT } from '../../src/game/combat/config.js';

function fixture(key, count) {
  const s = E.createGame(81203, { mode: 'multiplayer' });
  s.rules.rear = false;
  s.sides[0].credits = 10000;
  s.sides[0].materials = 1000;
  const site = E.build(s, 0, 'launcher', -850, 100);
  assert.equal(typeof site, 'object', String(site));
  site.progress = 1;
  site.hp = site.maxHp;
  site.level = 2;
  assert.equal(E.acceptLaunchDelivery(site, key, count), count);
  const aim = {
    x: 900,
    z: 100,
    waypoints: [
      { x: -400, z: 200 },
      { x: 400, z: 200 },
    ],
  };
  return { s, site, aim };
}

for (const key of ['drone', 'heavy'])
  for (const count of [2, 5])
    test(`level-two ${key} salvo ${count} has physical separation throughout its route`, () => {
      const { s, site, aim } = fixture(key, count),
        credits = s.sides[0].credits,
        stock = s.sides[0].inventory[key];
      assert.equal(E.launch(s, 0, key, aim, count, site.id), count);
      assert.equal(s.sides[0].credits, credits);
      assert.equal(s.sides[0].inventory[key], stock);
      assert.equal(E.availableLaunchStock(site, key), 0);
      assert.deepEqual(
        s.units.map((u) => u.delay),
        Array.from(
          { length: count },
          (_, i) => Math.floor(i / 2) * 10 + (i % 2) * COMBAT.cadence[key],
        ),
      );
      const records = s.units.slice();
      let checks = 0;
      for (let i = 0; i < 440; i++) {
        E.step(s, 0.05);
        const airborne = records.filter((u) => u.launched && u.hp > 0);
        for (let a = 0; a < airborne.length; a++)
          for (let b = a + 1; b < airborne.length; b++) {
            const first = airborne[a],
              second = airborne[b],
              gap = Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
            assert.ok(gap > 20, `craft overlap at ${s.time}: ${gap} m`);
            checks++;
          }
      }
      assert.ok(checks > 100);
      assert.equal(records.filter((u) => u.launched).length, count);
    });

test('a staggered partial burst survives save/load and later clicks cannot reuse its first slot', () => {
  const initial = fixture('drone', 5),
    id = initial.site.id;
  let s = initial.s;
  assert.equal(E.launch(s, 0, 'drone', initial.aim, 1, id), 1);
  E.step(s, 0.05);
  s = E.load(E.save(s));
  const site = s.buildings.find((b) => b.id === id);
  assert.equal(E.launch(s, 0, 'drone', initial.aim, 1, id), 1);
  assert.equal(E.launch(s, 0, 'drone', initial.aim, 3, id), 3);
  assert.deepEqual(
    s.units.map((u) => u.delay),
    [0, 0.75, 9.95, 10.75, 19.95],
  );
  assert.equal(site.nextLaunchAt, 20);
  assert.equal(site.launchBurstLeft, 1);
  const schedule = s.units.map((u) => ({ id: u.id, delay: u.delay }));
  const loaded = E.load(E.save(s));
  assert.deepEqual(
    loaded.units.map((u) => ({ id: u.id, delay: u.delay })),
    schedule,
  );
  assert.equal(loaded.buildings.find((b) => b.id === id).launchBurstLeft, 1);
});

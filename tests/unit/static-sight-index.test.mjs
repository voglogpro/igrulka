import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { prepareDefensivePosition } from '../../src/game/defense/fortifications.js';

test('cover and sight ignore distant city blocks after one shared index build', () => {
  const s = E.createGame(8113);
  const u = E.makeGround(s, 0, 'infantry', -1100, -300);
  let distantReads = 0;
  for (let i = 0; i < 1000; i++)
    s.buildings.push({
      id: s.nextId++,
      side: 1,
      key: 'housing',
      get x() {
        distantReads++;
        return 1200 + (i % 20);
      },
      z: 500 + Math.floor(i / 20),
      hp: 100,
      maxHp: 100,
      progress: 1,
    });
  E.coverInfo(s, u);
  distantReads = 0;
  for (let i = 0; i < 100; i++) {
    const point = { key: 'infantry', x: u.x + i * 0.1, z: u.z };
    E.coverInfo(s, point);
    E.lineOfSight(s, point, { x: point.x + 30, z: point.z });
  }
  assert.equal(distantReads, 0, 'a nearby firefight must not scan 1000 distant buildings per ray');
});

test('new walls, ruins, demolition and revised placement remain visible to cover and sight', () => {
  const s = E.createGame(8114);
  for (let i = 0; i < 20; i++)
    s.buildings.push({
      id: s.nextId++,
      side: 1,
      key: 'housing',
      x: 1100 + i,
      z: 1000,
      hp: 100,
      maxHp: 100,
      progress: 1,
    });
  const wall = { id: s.nextId++, side: 0, key: 'housing', x: -1300, z: -300, hp: 100, progress: 1 };
  const half = E.BUILDINGS.housing.size * 0.56;
  const point = () => ({ key: 'infantry', x: wall.x + half + 2, z: wall.z });
  E.coverInfo(s, point());
  s.buildings.push(wall);
  assert.equal(E.coverInfo(s, point(), { x: wall.x + 100, z: wall.z }).kind, 'Стена');
  const ray = () => [
    { x: wall.x - 100, z: wall.z },
    { x: wall.x + 100, z: wall.z },
  ];
  assert.equal(E.lineOfSight(s, ...ray()), false);
  wall.hp = 0;
  assert.equal(E.lineOfSight(s, ...ray()), true);
  wall.demolished = true;
  assert.notEqual(E.coverInfo(s, point(), { x: wall.x + 100, z: wall.z }).kind, 'Стена');
  s.time += 0.05;
  s.networkRevision++;
  wall.x = -1450;
  wall.hp = 100;
  wall.demolished = false;
  assert.equal(E.lineOfSight(s, ...ray()), false);
  assert.equal(s.buildings.pop(), wall);
  assert.equal(E.lineOfSight(s, ...ray()), true);
});

test('local fortification lookup keeps first ownership match and notices newly dug positions', () => {
  const s = E.createGame(8115);
  const u = E.makeGround(s, 0, 'infantry', -1300, -300);
  u.guard = { x: u.x, z: u.z };
  s.groundUnits.push(u);
  for (let i = 0; i < 150; i++)
    s.trenches.push({ id: s.nextId++, side: 0, x: 1200 + i, z: 300, progress: 1 });
  const initial = prepareDefensivePosition(s, u);
  assert.equal(initial.x, u.x);
  assert.equal(prepareDefensivePosition(s, u), initial);
  s.trenches.push({ id: s.nextId++, side: 0, x: u.x, z: u.z, progress: 1 });
  assert.equal(prepareDefensivePosition(s, u), initial, 'first canonical matching position wins');
  initial.side = 1;
  assert.equal(prepareDefensivePosition(s, u), s.trenches.at(-1));
});

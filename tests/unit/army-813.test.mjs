import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { basePosition } from '../../src/game/units/aviation/flight.js';

function fixture(key, count = 1, level = 0, seed = 17) {
  const s = E.createGame(seed, { mode: 'multiplayer' });
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 100000;
    f.materials = 100000;
  }
  const crews = [];
  for (let i = 0; i < count; i++) {
    const z = 250 + (i - (count - 1) / 2) * 25,
      crew = key === 'gun' ? E.build(s, 0, key, -1050, z) : E.makeGround(s, 0, key, -1050, z);
    assert.equal(typeof crew, 'object', String(crew));
    Object.assign(crew, {
      progress: 1,
      level,
      setup: 1,
      autoDefense: false,
      guard: null,
      path: [],
    });
    crew.hp = crew.maxHp;
    crew.order = { mode: 'hold', x: crew.x, z: crew.z };
    if (key !== 'gun') s.groundUnits.push(crew);
    crews.push(crew);
  }
  return { s, crews };
}
function incoming(s, key = 'drone') {
  const site = E.build(s, 1, 'launcher', 1015, 250);
  assert.equal(typeof site, 'object', String(site));
  site.progress = 1;
  site.hp = site.maxHp;
  E.acceptLaunchDelivery(site, key, 1);
  assert.equal(E.launch(s, 1, key, { x: -1400, z: 250 }, 1, site.id), 1);
  const u = s.units[0];
  u.launched = true;
  u.travelled = u.total - 800;
  Object.assign(u, basePosition(u, u.travelled));
  u.prevX = u.x;
  u.prevY = u.y;
  u.prevZ = u.z;
  u.vx = -u.speed;
  return u;
}

test('ordinary light and heavy drones take meaningful finite MG fire; six MGs stop the light approach', () => {
  for (const key of ['drone', 'heavy'])
    for (const count of [1, 6]) {
      for (const seed of [17, 42, 101, 202]) {
        const { s, crews } = fixture('machinegunner', count, 0, seed);
        const u = incoming(s, key),
          hp = u.hp;
        assert.equal(hp, E.WEAPONS[key].hp);
        for (let i = 0; i < 440 && !s.stats.interceptions && u.travelled < u.total; i++)
          E.step(s, 0.05);
        assert.ok(u.hp < hp, `${count} MG did no damage to ${key}, seed ${seed}`);
        assert.ok(
          crews.some((c) => E.ammunitionStatus(s, c).total < E.ammunitionStatus(s, c).maxTotal),
        );
        if (key === 'drone' && count === 6) assert.equal(s.stats.interceptions, 1);
      }
    }
});

test('an attack-moving MOG acquires an aircraft, stops, and completes setup before firing', () => {
  const {
    s,
    crews: [crew],
  } = fixture('mog');
  const target = incoming(s);
  Object.assign(target, { x: crew.x + 60, z: crew.z, travelled: target.total - 400 });
  crew.setup = 0;
  crew.order = { x: crew.x + 200, z: crew.z, mode: 'attackmove' };
  crew.path = [{ x: crew.x + 200, z: crew.z }];
  E.advance(s, 0.2);
  assert.ok(crew.trackId != null);
  E.advance(s, 0.3);
  assert.equal(crew.moving, false);
  assert.ok(crew.setup > 0 && crew.setup < 1);
  assert.equal(crew.rounds || 0, 0);
});

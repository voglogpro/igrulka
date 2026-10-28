import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { fireDefenses } from '../../src/game/combat/air-defense.js';

function fixture() {
  const s = E.createGame(813, { mode: 'multiplayer' });
  s.rules.rear = false;
  Object.assign(s.sides[0], { credits: 10000, materials: 1000 });
  const radar = E.build(s, 0, 'radar', -1080, -10);
  assert.equal(typeof radar, 'object', String(radar));
  Object.assign(radar, { progress: 1, hp: radar.maxHp });
  return { s, radar };
}
function aircraft(s, side, x, z) {
  const u = {
    id: s.nextId++,
    side,
    key: 'drone',
    hp: E.WEAPONS.drone.hp,
    maxHp: E.WEAPONS.drone.hp,
    launched: true,
    delay: 0,
    x,
    y: 35,
    z,
    vx: -40,
    vy: 0,
    vz: 0,
    speed: 40,
    total: 1000,
    travelled: 100,
  };
  s.units.push(u);
  return u;
}
test('radar provides local fire control and loses support when destroyed or unpowered', () => {
  const { s, radar } = fixture();
  const base = E.radarFireSupport(s, 0, radar.x + 599, radar.z);
  assert.equal(base.sourceId, radar.id);
  assert.equal(base.rangeMultiplier, 1.3);
  assert.equal(base.spreadMultiplier, 0.65);
  assert.equal(E.radarFireSupport(s, 0, radar.x + 601, radar.z).active, false);
  assert.equal(E.radarFireSupport(s, 1, radar.x, radar.z).active, false);
  radar.level = 2;
  assert.ok(
    E.radarFireSupport(s, 0, radar.x + 700, radar.z).rangeMultiplier > base.rangeMultiplier,
  );
  assert.ok(E.radarFireSupport(s, 0, radar.x, radar.z).spreadMultiplier < base.spreadMultiplier);
  radar.hp = 0;
  assert.equal(E.radarFireSupport(s, 0, radar.x, radar.z).active, false);
  radar.hp = radar.maxHp;
  const d = E.BUILDINGS.electronics;
  for (let i = 0; i < 5; i++)
    s.buildings.push({
      id: s.nextId++,
      side: 0,
      key: 'electronics',
      x: -1000,
      z: i * 40,
      hp: d.hp,
      maxHp: d.hp,
      progress: 1,
    });
  assert.equal(E.radarFireSupport(s, 0, radar.x, radar.z).active, false);
  assert.equal(E.radarAirWarning(s, 0).active, false);
});
test('radar warning observes only hostile launched aircraft and estimates public velocity without reading private routes', () => {
  const { s, radar } = fixture(),
    home = E.hqOf(s, 0);
  const u = aircraft(s, 1, home.x + 700, home.z);
  for (const key of ['tx', 'tz', 'waypoints', 'routeQueue'])
    Object.defineProperty(u, key, {
      get() {
        throw Error('private aircraft route was read');
      },
      enumerable: true,
    });
  aircraft(s, 0, home.x + 100, 0);
  const queued = aircraft(s, 1, home.x + 80, 0);
  queued.delay = 5;
  const dead = aircraft(s, 1, home.x + 90, 0);
  dead.hp = 0;
  aircraft(s, 1, home.x + 1200, 0);
  const report = E.radarAirWarning(s, 0);
  assert.equal(report.targets, 1);
  assert.equal(report.bearing, 'В');
  assert.equal(report.eta, 18);
  assert.equal(report.sourceId, radar.id);
  assert.ok(Math.abs(report.rangeBonus - 0.3) < 1e-9);
  assert.equal(
    E.unitVisible(s, 0, s.units.at(-1)),
    true,
    'world visibility remains open without fog',
  );
  u.vx = 40;
  assert.equal(
    E.radarAirWarning(s, 0).eta,
    null,
    'outgoing craft does not have an invented arrival',
  );
  radar.hp = 0;
  assert.equal(E.radarAirWarning(s, 0).targets, 0);
});
test('a real battery acquires an ordinary drone outside its old range only while radar works', () => {
  const { s, radar } = fixture();
  const gun = E.build(s, 0, 'gun', -1080, 100);
  assert.equal(typeof gun, 'object', String(gun));
  Object.assign(gun, { progress: 1, hp: gun.maxHp });
  const u = aircraft(s, 1, gun.x + E.BUILDINGS.gun.range * 1.15, gun.z);
  const rates = E.sideIds(s).map((side) => E.economy(s, side));
  radar.hp = 0;
  fireDefenses(s, rates, 0.05);
  assert.equal(gun.trackId, null);
  assert.equal(s.projectiles.length, 0);
  radar.hp = radar.maxHp;
  fireDefenses(s, rates, 0.05);
  assert.equal(gun.trackId, u.id);
  assert.ok(s.projectiles.some((p) => p.sourceId === gun.id));
  assert.ok(E.ammunitionStatus(s, gun).total < E.ammunitionStatus(s, gun).maxTotal);
  assert.equal(u.hp, E.WEAPONS.drone.hp, 'target kept ordinary hit points');
});

test('a closer departing drone does not hide the warning for an approaching raid', () => {
  const { s } = fixture(),
    home = E.hqOf(s, 0);
  const outgoing = aircraft(s, 1, home.x + 100, home.z);
  outgoing.vx = 40;
  aircraft(s, 1, home.x, home.z + 600).vz = -40;
  const incoming = s.units.at(-1);
  incoming.vx = 0;
  const warning = E.radarAirWarning(s, 0);
  assert.equal(warning.targets, 2);
  assert.equal(warning.eta, 15);
  assert.equal(warning.bearing, 'Ю');
});

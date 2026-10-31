import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { navalStation } from '../../src/game/city/naval.js';

function fixture() {
  const s = E.createGame(8154);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextArmy = s.ai.nextStrike = 1e9;
  s.rules.oil = false;
  for (const f of s.sides) {
    f.credits = 1e5;
    f.materials = 1e4;
    f.components = 500;
  }
  const X = -E.HQ_X;
  const ready = (key, x, z) => {
    const b = E.build(s, 0, key, x, z);
    assert.notEqual(typeof b, 'string', b);
    b.progress = 1;
    b.hp = b.maxHp;
    return b;
  };
  ready('power', X - 55, -80);
  const factory = ready('factory', X - 65, -10);
  let base = null;
  for (let x = X + 300; x < -500 && !base; x += 4)
    if (!E.canPlace(s, 'navalbase', x, 0, 0)) base = ready('navalbase', x, 0);
  return { s, factory, base };
}

test('a naval base stands on the shore only and its ship loads cruise missiles at the berth', () => {
  const { s, factory, base } = fixture();
  assert.ok(base, 'a shore site exists in front of the city');
  assert.match(E.canPlace(s, 'navalbase', -E.HQ_X, 300, 0) || '', /воды|берег/);
  assert.equal(E.launchSiteAllows(base, 'stealth'), true);
  assert.equal(E.launchSiteAllows(base, 'ballistic'), false, 'no ballistic missiles at sea');
  assert.equal(E.launchSiteAllows(base, 'drone'), false);
  E.acceptLaunchDelivery(factory, 'cruise', 4);
  E.advance(s, 2);
  assert.equal(s.warships.length, 1);
  assert.equal(s.warships[0].state, 'docked');
  for (let i = 0; i < 120 && s.warships[0].state !== 'station'; i++) E.advance(s, 1);
  assert.equal(s.warships[0].state, 'station');
  assert.equal(base.launchStore.cruise, 4);
  const station = navalStation(base);
  assert.ok(Math.hypot(s.warships[0].x - station.x, s.warships[0].z - station.z) < 1);
  assert.ok(E.isWater(station.x, station.z));
});

test('the ship launches from open water, returns empty and a sunk ship is replaced for a fee', () => {
  const { s, factory, base } = fixture();
  E.acceptLaunchDelivery(factory, 'cruise', 4);
  for (let i = 0; i < 150 && s.warships[0]?.state !== 'station'; i++) E.advance(s, 1);
  const ship = s.warships[0];
  assert.equal(E.launch(s, 0, 'cruise', { x: E.HQ_X - 400, z: 500 }, 4, base.id), 4);
  assert.ok(s.units.every((u) => Math.abs(u.startX - ship.x) < 1e-9));
  for (let i = 0; i < 150 && ship.state !== 'docked'; i++) E.advance(s, 1);
  assert.equal(ship.state, 'docked');
  const loaded = E.load(E.save(s));
  assert.deepEqual(loaded.warships, s.warships);
  const credits = s.sides[0].credits;
  E.applyBlast(s, ship.x, ship.z, 5000, 4);
  assert.ok(base.hp > 0, 'the strike hit the ship, not the base');
  assert.equal(ship.hp, 0);
  assert.equal(
    E.launchStatus(s, 0, 'cruise', { x: 0, z: 0 }, base.id),
    'Корабль базы потоплен: ждём спуска нового',
  );
  E.advance(s, E.BUILDINGS.navalbase.naval.replaceDelay + 2);
  assert.equal(s.warships.filter((v) => v.hp > 0).length, 1);
  assert.ok(credits - s.sides[0].credits >= E.BUILDINGS.navalbase.naval.replaceCost - 200);
});

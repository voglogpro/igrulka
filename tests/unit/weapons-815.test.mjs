import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { flightRoute } from '../../src/game/units/aviation/routes.js';
import { fireDefenses } from '../../src/game/combat/air-defense.js';
import { damageAircraft, moveUnits } from '../../src/game/units/aviation/flight.js';

test('new missiles join their families: silo racks, SAM targets and straight ballistic routes', () => {
  assert.deepEqual(
    ['stealth', 'tactical', 'cluster'].map((key) => E.weaponFamily(key)),
    ['cruise', 'ballistic', 'ballistic'],
  );
  for (const key of ['stealth', 'tactical', 'cluster']) {
    assert.equal(E.isMissile(key), true);
    assert.equal(E.canEngageAir('sam', key), true);
    assert.equal(E.canEngageAir('mog', key), false, 'barrel AA cannot stop missiles');
    assert.equal(E.launchSiteAllows({ key: 'silo' }, key), true);
    assert.equal(E.launchSiteAllows({ key: 'launcher' }, key), false);
  }
  const route = flightRoute(
    { x: 0, z: 0 },
    { x: 900, z: 0, waypoints: [{ x: 300, z: 400 }] },
    'tactical',
  );
  assert.equal(route.length, 2, 'ballistic variants ignore waypoints');
  assert.ok(E.WEAPONS.stealth.signature < 1);
  assert.ok(E.WEAPONS.cluster.blast > E.WEAPONS.ballistic.blast);
  assert.ok(E.WEAPONS.tactical.speed > E.WEAPONS.ballistic.speed);
});

test('older campaigns without the new weapon types load with empty new stocks', () => {
  const s = E.createGame(8152);
  const raw = JSON.parse(E.save(s));
  for (const f of raw.sides)
    for (const key of ['stealth', 'tactical', 'cluster']) delete f.inventory[key];
  const loaded = E.load(JSON.stringify(raw));
  for (const f of loaded.sides)
    for (const key of Object.keys(E.WEAPONS)) assert.equal(f.inventory[key], 0);
});

test('a low-signature cruise missile is engaged by a SAM battery only at a shorter range', () => {
  const engagedAt = (key) => {
    const s = E.createGame(8153);
    s.ai.nextBuild = s.ai.nextAttack = s.ai.nextArmy = s.ai.nextStrike = 1e9;
    s.sides[0].credits = 1e5;
    s.sides[0].materials = 1e4;
    const sam = E.build(s, 0, 'sam', -E.HQ_X + 120, 80);
    assert.notEqual(typeof sam, 'string', sam);
    sam.progress = 1;
    sam.hp = sam.maxHp;
    const range = E.BUILDINGS.sam.range;
    for (let d = range * 1.2; d > 0; d -= 10) {
      s.units = [
        {
          id: 9000,
          side: 1,
          key,
          x: sam.x + d,
          y: 30,
          z: sam.z,
          hp: 1e6,
          maxHp: 1e6,
          status: 'flying',
          route: [
            { x: sam.x + d, z: sam.z, d: 0 },
            { x: sam.x - 10, z: sam.z, d: d + 10 },
          ],
          total: d + 10,
          travelled: 0,
          speed: 1,
          tx: sam.x - 10,
          tz: sam.z,
          delay: 0,
          launched: true,
        },
      ];
      sam.trackId = null;
      fireDefenses(
        s,
        s.sides.map((_, side) => E.economy(s, side)),
        0.05,
      );
      if (sam.trackId === 9000) return d;
    }
    return 0;
  };
  const cruise = engagedAt('cruise'),
    stealth = engagedAt('stealth');
  assert.ok(cruise > 0 && stealth > 0, `${cruise} ${stealth}`);
  assert.ok(stealth < cruise * 0.7, `${stealth} < ${cruise}`);
});

test('two missile-defence hits bring down any ballistic missile, and it leaves no ground debris', () => {
  for (const key of ['ballistic', 'tactical', 'cluster']) {
    const s = E.createGame(8155);
    const hq = E.hqOf(s, 0);
    const u = {
      id: s.nextId++,
      side: 1,
      key,
      x: hq.x,
      y: 80,
      z: hq.z,
      hp: E.WEAPONS[key].hp,
      maxHp: E.WEAPONS[key].hp,
      status: 'flying',
      vx: 0,
      vy: -60,
      vz: 0,
    };
    s.units.push(u);
    const hit = E.BUILDINGS.sam.damage;
    assert.equal(damageAircraft(s, u, hit, 0), false, `${key} survives one hit`);
    assert.equal(damageAircraft(s, u, hit, 0), true, `${key} falls to the second`);
    assert.equal(u.status, 'airburst');
    const before = hq.hp;
    moveUnits(s, 0.05);
    for (let i = 0; i < 200; i++) moveUnits(s, 0.05);
    assert.equal(hq.hp, before, 'no warhead lands under an intercepted missile');
    assert.equal(s.stats.crashes, 0);
  }
});

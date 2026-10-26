import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { basePosition } from '../../src/game/units/aviation/flight.js';

const seeds = [17, 42, 101, 202, 303, 404, 505, 606];
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
    if (key === 'mog') s.groundUnits.push(crew);
    crews.push(crew);
  }
  return { s, crews };
}
function incoming(s) {
  const site = E.build(s, 1, 'launcher', 1015, 250);
  assert.equal(typeof site, 'object', String(site));
  site.progress = 1;
  site.hp = site.maxHp;
  E.acceptLaunchDelivery(site, 'drone', 1);
  assert.equal(E.launch(s, 1, 'drone', { x: -1400, z: 250 }, 1, site.id), 1);
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
function stationaryTarget(s, crew) {
  const d = E.WEAPONS.drone;
  const u = {
    id: s.nextId++,
    side: 1,
    key: 'drone',
    status: 'flying',
    launched: true,
    hp: 1e6,
    maxHp: 1e6,
    speed: 0.001,
    damage: d.damage,
    x: crew.x + 40,
    z: crew.z,
    y: d.altitude,
    prevX: crew.x + 40,
    prevZ: crew.z,
    prevY: d.altitude,
    startX: crew.x + 40,
    startZ: crew.z,
    tx: crew.x + 1040,
    tz: crew.z,
    vx: 0.001,
    vy: 0,
    vz: 0,
    travelled: 100,
    total: 1000,
    delay: 0,
    phase: 0,
  };
  s.units.push(u);
  return u;
}

for (const key of ['gun', 'mog']) {
  test(`${key} upgrades improve true shot cadence without the old two-second heat cliff`, () => {
    const shots = [];
    for (const level of [0, 1, 2]) {
      const {
        s,
        crews: [crew],
      } = fixture(key, 1, level);
      stationaryTarget(s, crew);
      E.advance(s, 2);
      shots.push(crew.rounds || 0);
      assert.ok(crew.heat < 0.9, `${key} tier ${level} overheated before two seconds`);
      const ammo = E.ammunitionStatus(s, crew);
      assert.equal(ammo.total + (crew.rounds || 0), ammo.maxTotal);
    }
    assert.ok(shots[1] > shots[0], `${key}: first upgrade must actually fire faster: ${shots}`);
    assert.ok(shots[2] > shots[1], `${key}: final upgrade must actually fire faster: ${shots}`);
  });

  test(`${key} final equipment stays accurate across real magazines and still has finite ammo/reloading`, () => {
    const {
      s,
      crews: [crew],
    } = fixture(key, 1, 2);
    stationaryTarget(s, crew);
    let peakHeat = 0,
      reloadSeen = false;
    for (let i = 0; i < 500; i++) {
      E.step(s, 0.05);
      peakHeat = Math.max(peakHeat, crew.heat);
      reloadSeen ||= crew.groundReload > 0;
    }
    const ammo = E.ammunitionStatus(s, crew);
    assert.ok(reloadSeen);
    assert.ok(peakHeat < 0.9, `sustained final-tier heat ${peakHeat}`);
    assert.equal(ammo.total, 0);
    assert.equal(crew.rounds, ammo.maxTotal);
    const count = crew.rounds;
    E.advance(s, 3);
    assert.equal(crew.rounds, count, 'an empty finite reserve must stop firing');
  });

  test(`${key} group of three can protect a light-drone approach over independent live combat seeds`, () => {
    for (const seed of seeds) {
      const { s, crews } = fixture(key, 3, 0, seed),
        u = incoming(s);
      for (let i = 0; i < 440 && !s.stats.interceptions && u.travelled < u.total; i++)
        E.step(s, 0.05);
      assert.equal(s.stats.interceptions, 1, `${key} seed ${seed}`);
      assert.ok(crews.some((crew) => crew.rounds > 0));
    }
  });

  test(`${key} cash upgrades keep two tiers, charge the quoted final 500 and preserve paid combat state`, () => {
    const {
      s,
      crews: [crew],
    } = fixture(key);
    crew.hp *= 0.7;
    crew.xp = 50;
    crew.groundAmmo -= 10;
    const before = {
        hp: crew.hp,
        maxHp: crew.maxHp,
        xp: crew.xp,
        ammo: E.ammunitionStatus(s, crew).total,
      },
      base = E.defenseStats(s.sides[0], crew),
      first = E.upgradeStatus(s, 0, crew.id);
    assert.equal(E.upgradeDefense(s, 0, crew.id), true);
    const final = E.upgradeStatus(s, 0, crew.id);
    assert.equal(final.cost, 500);
    assert.ok(final.nextModifiers.cooling > final.modifiers.cooling);
    assert.ok(final.nextModifiers.spread < final.modifiers.spread);
    s.sides[0].credits = 499;
    assert.equal(typeof E.upgradeDefense(s, 0, crew.id), 'string');
    assert.equal(s.sides[0].credits, 499);
    s.sides[0].credits = 500;
    assert.equal(E.upgradeDefense(s, 0, crew.id), true);
    assert.equal(s.sides[0].credits, 0);
    assert.equal(crew.level, 2);
    assert.equal(E.upgradeStatus(s, 0, crew.id).ok, false);
    const upgraded = E.defenseStats(s.sides[0], crew);
    assert.equal(upgraded.damage, base.damage);
    assert.ok(upgraded.cooling > base.cooling && upgraded.heatPerShot < base.heatPerShot);
    assert.deepEqual(
      { hp: crew.hp, maxHp: crew.maxHp, xp: crew.xp, ammo: E.ammunitionStatus(s, crew).total },
      before,
    );
    assert.equal(
      first.cost,
      Math.round((key === 'gun' ? E.BUILDINGS.gun.cost : E.GROUND_UNITS.mog.cost) * 0.4),
    );
    const loaded = E.load(E.save(s)),
      restored = [...loaded.buildings, ...loaded.groundUnits].find((b) => b.id === crew.id);
    assert.equal(restored.level, 2);
    assert.equal(E.ammunitionStatus(loaded, restored).total, before.ammo);
    assert.equal(E.canEngageAir(key, 'cruise'), false);
    assert.equal(E.canEngageAir(key, 'ballistic'), false);
  });

  test(`${key} mixed ground/air fire consumes one shared magazine and cools exactly once`, () => {
    const {
        s,
        crews: [crew],
      } = fixture(key, 1, 2),
      target = E.makeGround(s, 1, 'infantry', crew.x + 80, crew.z);
    target.holdFire = true;
    target.autoDefense = false;
    target.path = [];
    target.order = { mode: 'hold', x: target.x, z: target.z };
    s.groundUnits.push(target);
    stationaryTarget(s, crew);
    crew.heat = 0.5;
    const profile = E.defenseStats(s.sides[0], crew),
      before = E.ammunitionStatus(s, crew).total;
    E.step(s, 0.05);
    const fired = s.projectiles.filter((p) => p.source === crew.id);
    assert.equal(fired.length, 2);
    assert.equal(fired.filter((p) => p.domain === 'ground').length, 1);
    assert.equal(E.ammunitionStatus(s, crew).total, before - 2);
    assert.ok(
      Math.abs(crew.heat - (0.5 + profile.heatPerShot * 2 - profile.cooling * 0.05)) < 1e-9,
    );
  });
}

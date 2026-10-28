import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { tickUnit } from '../../src/game/units/ground/update.js';
import { fireDefenses } from '../../src/game/combat/air-defense.js';
import {
  prepareDefensivePosition,
  updateFortification,
} from '../../src/game/defense/fortifications.js';
import {
  invalidateStaticGeometry,
  staticGeometryRevision,
} from '../../src/game/shared/static-spatial.js';

const hooks = { event: () => {}, random: () => 0.5 };
function state() {
  const s = E.createGame(813, { mode: 'multiplayer' });
  s.rules.oil = false;
  s.rules.rear = false;
  return s;
}
function guard(s) {
  const u = E.makeGround(s, 0, 'infantry', -850, 350);
  u.guard = { x: u.x, z: u.z };
  u.order = { ...u.guard, mode: 'guard' };
  s.groundUnits.push(u);
  return u;
}
const trench = (s, u, side = 0, dx = 0) => ({
  id: s.nextId++,
  side,
  x: u.x + dx,
  z: u.z,
  progress: 1,
});

test('cached trench geometry keeps ownership, progress and hostile occupancy live without a geometry revision', () => {
  const s = state(),
    u = guard(s),
    a = trench(s, u, 1, 1),
    b = trench(s, u, 0, 2);
  s.trenches.push(a, b);
  assert.equal(prepareDefensivePosition(s, u), b);
  const revision = staticGeometryRevision(s, 'trenches');
  a.side = 0;
  assert.equal(
    prepareDefensivePosition(s, u),
    a,
    'canonical first own trench must become eligible immediately',
  );
  a.progress = 0.2;
  assert.equal(prepareDefensivePosition(s, u), a);
  assert.equal(u.digging, true);
  assert.equal(staticGeometryRevision(s, 'trenches'), revision);
  a.progress = 1;
  a.side = 1;
  b.side = 1;
  u.digging = false;
  const enemy = E.makeGround(s, 1, 'infantry', u.x, u.z);
  s.groundUnits.push(enemy);
  assert.equal(prepareDefensivePosition(s, u), null);
  enemy.hp = 0;
  assert.equal(
    prepareDefensivePosition(s, u),
    a,
    'vacated enemy earthwork must be captured through live occupancy checks',
  );
  assert.equal(a.side, 0);
  assert.equal(staticGeometryRevision(s, 'trenches'), revision);
});

test('same-length trench replacement and explicit position edits invalidate both sorted spatial candidates and per-soldier geometry', () => {
  const s = state(),
    u = guard(s),
    a = trench(s, u);
  s.trenches.push(a);
  for (let i = 1; i < 240; i++) s.trenches.push(trench(s, { x: -1400, z: 650 + i }, 0));
  assert.equal(prepareDefensivePosition(s, u), a);
  const replacement = trench(s, u, 0, 1);
  s.trenches.splice(0, 1, replacement);
  invalidateStaticGeometry(s, 'trenches');
  assert.equal(s.trenches.length, 240);
  assert.equal(prepareDefensivePosition(s, u), replacement);
  const moved = s.trenches[1];
  replacement.x = -1450;
  Object.assign(moved, { x: u.x + 2, z: u.z });
  invalidateStaticGeometry(s, 'trenches');
  assert.equal(prepareDefensivePosition(s, u), moved);
  const fresh = trench(s, u);
  s.trenches = [fresh, ...s.trenches.slice(1)];
  assert.equal(
    prepareDefensivePosition(s, u),
    fresh,
    'array replacement also invalidates without a version call',
  );
  u.x += 50;
  u.guard.x += 50;
  assert.equal(
    prepareDefensivePosition(s, u),
    undefined,
    'moving the soldier invalidates its geometric lookup',
  );
});

test('canonical trench creation invalidates geometry while ordinary paid work does not', () => {
  const s = state(),
    u = guard(s);
  assert.equal(staticGeometryRevision(s, 'trenches'), 0);
  const t = prepareDefensivePosition(s, u);
  assert.equal(staticGeometryRevision(s, 'trenches'), 1);
  assert.equal(prepareDefensivePosition(s, u), t);
  updateFortification(s, u, 0.1);
  assert.equal(staticGeometryRevision(s, 'trenches'), 1);
  const v = E.makeGround(s, 0, 'infantry', -930, 350);
  s.groundUnits.push(v);
  assert.equal(E.commandUnits(s, 0, [v.id], 'dig'), 1);
  assert.equal(staticGeometryRevision(s, 'trenches'), 2);
});

test('ground reload scalars match the public pre-optimization defense formula for every role, equipment tier and veteran rank', () => {
  const s = state();
  for (const [key, d] of Object.entries({ ...E.GROUND_UNITS, gun: E.BUILDINGS.gun }))
    for (const level of [0, 1, 2])
      for (const xp of [0, 60, 180, 360]) {
        const u =
          key === 'gun'
            ? {
                id: s.nextId++,
                side: 0,
                key,
                x: -850,
                z: 350,
                hp: d.hp,
                maxHp: d.hp,
                progress: 1,
                path: [],
              }
            : E.makeGround(s, 0, key, -850, 350);
        Object.assign(u, {
          level,
          xp,
          groundAmmo: 0,
          ammoReserve: 10,
          groundReload: 0,
          holdFire: true,
        });
        s.groundUnits = key === 'gun' ? [] : [u];
        s.time += 0.05;
        const shared = (E.isInfantry(key) || key === 'gun') && d.range;
        const original = shared ? E.defenseStats(s.sides[0], u) : null;
        const expectedReload = d.groundRange ? original?.reload || d.groundReload || 3 : 0;
        tickUnit(s, u, 0.05, [], hooks);
        assert.equal(u.groundReload, expectedReload, `${key} level${level} xp${xp}`);
        assert.equal(
          u.ammoReserve,
          10,
          'starting a reload cannot manufacture or consume reserve rounds',
        );
      }
});

test('zero and missing config values retain original reload fallbacks; shared rifle, MG, MOG and gun heat retain tier modifiers', () => {
  const s = state(),
    d = E.GROUND_UNITS.infantry;
  const original = {
    groundMagazine: d.groundMagazine,
    magazine: d.magazine,
    groundReload: d.groundReload,
    reload: d.reload,
    range: d.range,
  };
  try {
    for (const values of [
      { groundMagazine: 0, magazine: 7, groundReload: 0, reload: 9, range: 125 },
      { groundMagazine: undefined, magazine: 7, groundReload: undefined, reload: 9, range: 125 },
      { groundMagazine: 2.2, magazine: 7, groundReload: 0, reload: 0, range: 125 },
      {
        groundMagazine: undefined,
        magazine: undefined,
        groundReload: undefined,
        reload: undefined,
        range: 0,
      },
    ]) {
      Object.assign(d, values);
      const u = E.makeGround(s, 0, 'infantry', -850, 350);
      Object.assign(u, { groundAmmo: 0, ammoReserve: 10, groundReload: 0, holdFire: true });
      const before = d.range ? E.defenseStats(s.sides[0], u) : null;
      const expected = before?.reload || d.groundReload || 3;
      s.groundUnits = [u];
      s.time += 0.05;
      tickUnit(s, u, 0.05, [], hooks);
      assert.equal(u.groundReload, expected);
    }
  } finally {
    Object.assign(d, original);
  }
  for (const key of ['infantry', 'machinegunner', 'mog', 'gun', 'sniper', 'apc', 'shilka'])
    for (const level of [0, 1, 2]) {
      const descriptor = E.GROUND_UNITS[key] || E.BUILDINGS[key];
      const u =
        key === 'gun'
          ? {
              id: s.nextId++,
              side: 0,
              key,
              x: -850,
              z: 350,
              hp: descriptor.hp,
              maxHp: descriptor.hp,
              progress: 1,
              path: [],
              groundAmmo: 30,
              ammoReserve: 30,
            }
          : E.makeGround(s, 0, key, -850, 350);
      Object.assign(u, { level, setup: 1, heat: 0, suppression: 0 });
      const enemy = E.makeGround(s, 1, 'infantry', -820, 350);
      s.groundUnits = [u, enemy];
      s.time += 0.05;
      s.projectiles = [];
      const aa =
        (E.isInfantry(key) || key === 'gun') && descriptor.range
          ? E.defenseStats(s.sides[0], u)
          : null;
      tickUnit(s, u, 0.05, [], hooks);
      if (descriptor.groundRange)
        assert.equal(s.projectiles.length, 1, `${key} must fire a real first round`);
      assert.equal(
        u.heat,
        descriptor.groundRange && descriptor.heatPerShot
          ? Math.min(1.5, aa?.heatPerShot ?? descriptor.heatPerShot)
          : 0,
        `${key} heat level${level}`,
      );
    }
});

test('rifle, sniper, APC and shared/separate AA reload cycles conserve exactly three paid reserve rounds at every tier and rank', () => {
  const s = state(),
    buildings = s.buildings;
  for (const key of ['infantry', 'sniper', 'apc', 'shilka', 'mog', 'gun'])
    for (const level of [0, 1, 2])
      for (const xp of [0, 60, 180, 360]) {
        const d = E.GROUND_UNITS[key] || E.BUILDINGS[key];
        const u =
          key === 'gun'
            ? {
                id: s.nextId++,
                side: 0,
                key,
                x: -850,
                z: 350,
                hp: d.hp,
                maxHp: d.hp,
                progress: 1,
                path: [],
              }
            : E.makeGround(s, 0, key, -850, 350);
        Object.assign(u, {
          level,
          xp,
          setup: 1,
          groundAmmo: 0,
          ammo: 0,
          ammoReserve: 3,
          groundReload: 0,
          reloadLeft: 0,
          holdFire: true,
        });
        s.buildings = key === 'gun' ? [...buildings, u] : buildings;
        s.groundUnits = key === 'gun' ? [] : [u];
        for (let i = 0; i < 150; i++) {
          s.time += 0.1;
          tickUnit(s, u, 0.1, [], hooks);
          fireDefenses(s, [], 0.1);
          assert.equal(E.ammunitionStatus(s, u).total, 3, `${key} finite ammunition during reload`);
        }
        assert.equal(u.ammoReserve, 0, `${key} tier${level} xp${xp} completed paid reload`);
        assert.equal(s.projectiles.length, 0, 'hold fire must retain every reloaded round');
      }
});

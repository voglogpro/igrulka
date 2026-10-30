import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../../src/game/index.js';
import { walkable } from '../../src/game/units/ground/navigation.js';

function fresh() {
  const s = game.createGame(39);
  s.mode = 'multiplayer';
  for (const side of s.sides) {
    side.credits = 100000;
    side.materials = 10000;
  }
  return s;
}

function building(s, key = 'launcher') {
  const b = game.build(s, 0, key, -942, 100);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}

function soldier(s, side, x, z) {
  const u = game.makeGround(s, side, 'infantry', x, z);
  s.groundUnits.push(u);
  return u;
}

test('a soldier touching city cover cannot see through the building in either direction', () => {
  const s = fresh();
  const b = building(s);
  const a = soldier(s, 0, b.x + game.BUILDINGS.launcher.size * 0.56 + 1, b.z);
  const enemy = soldier(s, 1, b.x - 35, b.z);
  assert.equal(walkable(s, a.x, a.z, game.GROUND_UNITS.infantry.size * 0.42), true);
  assert.equal(game.coverInfo(s, a).kind, 'Стена');
  assert.equal(game.lineOfSight(s, a, enemy), false);
  assert.equal(game.lineOfSight(s, enemy, a), false);
  game.advance(s, 4);
  assert.equal(a.hp, a.maxHp);
  assert.equal(enemy.hp, enemy.maxHp);
  assert.equal(
    s.events.some((e) => e.type === 'shot' && e.buildingId === a.id),
    false,
  );
});

test('real city gunfire reaches wall cover from its open face and flanks cause more damage', () => {
  function encounter(flank) {
    const s = fresh();
    const b = building(s);
    const defender = soldier(s, 0, b.x + game.BUILDINGS.launcher.size * 0.56 + 4, b.z);
    defender.holdFire = true;
    const attacker = soldier(s, 1, defender.x + (flank ? 0 : 50), defender.z + (flank ? 50 : 0));
    assert.equal(game.lineOfSight(s, attacker, defender), true);
    assert.equal(game.lineOfSight(s, defender, attacker), true);
    assert.equal(game.coverInfo(s, defender, attacker).cover, flank ? 0.08 : 0.33);
    game.advance(s, 1);
    assert.ok(s.events.some((e) => e.type === 'shot' && e.buildingId === attacker.id));
    assert.ok(defender.hp < defender.maxHp);
    return defender.maxHp - defender.hp;
  }
  assert.ok(encounter(true) > encounter(false));
});

test('a static gun shoots out of its own footprint and remains a reachable building target', () => {
  const s = fresh();
  const gun = building(s, 'gun');
  const enemy = soldier(s, 1, gun.x + 50, gun.z);
  assert.equal(game.lineOfSight(s, gun, enemy), true);
  assert.equal(game.lineOfSight(s, enemy, gun), true);
  game.advance(s, 1);
  assert.ok(enemy.hp < enemy.maxHp);
  assert.ok(gun.hp < gun.maxHp);
  assert.ok(s.events.some((e) => e.type === 'shot' && e.buildingId === gun.id));
});

test('a SAM and its own footprint do not obstruct an outgoing shot or a building target', () => {
  const s = fresh();
  const sam = building(s, 'sam');
  const target = { x: sam.x + 80, z: sam.z, id: s.nextId++ };
  assert.equal(game.lineOfSight(s, sam, target), true);
  assert.equal(game.lineOfSight(s, target, sam), true);
});

test('ruins allow fire and retain cover and blocked ground until they are demolished', () => {
  const s = fresh();
  const b = building(s);
  const a = soldier(s, 0, b.x + game.BUILDINGS.launcher.size * 0.56 + 1, b.z);
  const enemy = soldier(s, 1, b.x - 35, b.z);
  assert.equal(walkable(s, b.x, b.z), false);
  b.hp = 0;
  s.networkRevision++;
  assert.equal(game.lineOfSight(s, a, enemy), true);
  assert.equal(game.lineOfSight(s, enemy, a), true);
  assert.deepEqual(game.coverInfo(s, a, enemy), { cover: 0.5, concealment: 0.4, kind: 'Руины' });
  assert.equal(walkable(s, b.x, b.z), false);
  assert.equal(game.demolish(s, b.id, 0), true);
  assert.equal(walkable(s, b.x, b.z), true);
  assert.notEqual(game.coverInfo(s, a).kind, 'Руины');
});

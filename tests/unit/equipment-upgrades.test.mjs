import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

test('cash equipment upgrades preserve health, damage, ammunition and earned experience', () => {
  const s = E.createGame(8903),
    u = E.makeGround(s, 0, 'gepard', -850, 250);
  s.groundUnits.push(u);
  s.sides[0].credits = 10000;
  s.sides[0].materials = 0;
  u.xp = 80;
  u.hp *= 0.6;
  const before = { hp: u.hp, maxHp: u.maxHp, xp: u.xp, groundAmmo: u.groundAmmo };
  const base = E.defenseStats(s.sides[0], u),
    quote = E.upgradeStatus(s, 0, u.id);
  assert.equal(quote.ok, true);
  assert.equal(E.upgradeDefense(s, 0, u.id), true);
  assert.equal(s.sides[0].credits, 10000 - quote.cost);
  assert.equal(s.sides[0].materials, 0);
  const first = E.defenseStats(s.sides[0], u);
  assert.ok(
    first.range > base.range && first.accuracy < base.accuracy && first.cooldown < base.cooldown,
  );
  assert.equal(first.damage, base.damage);
  for (const [key, value] of Object.entries(before)) assert.equal(u[key], value);
  assert.equal(E.upgradeDefense(s, 0, u.id), true);
  const paid = s.sides[0].credits;
  assert.equal(typeof E.upgradeDefense(s, 0, u.id), 'string');
  assert.equal(s.sides[0].credits, paid);
  assert.equal(typeof E.upgradeDefense(s, 1, u.id), 'string');
  const loaded = E.load(E.save(s));
  assert.equal(loaded.groundUnits[0].level, 2);
  assert.equal(loaded.groundUnits[0].xp, 80);
});

test('legacy paid levels survive research retirement without a second cash refund', () => {
  const s = E.createGame(8904),
    u = E.makeGround(s, 0, 'gepard', -500, 250);
  s.groundUnits.push(u);
  u.level = 2;
  u.xp = 50;
  s.version = 14;
  const credits = s.sides[0].credits;
  const loaded = E.load(E.save(s));
  assert.equal(loaded.groundUnits[0].level, 2);
  assert.equal(loaded.sides[0].credits, credits);
  assert.deepEqual(loaded.sides[0].tech, []);
});

test('paid ground equipment fires more accurate real rounds faster and acquires its extended range', () => {
  function battle(level, distance) {
    const s = E.createGame(8905);
    s.mode = 'multiplayer';
    s.rules.rear = false;
    s.sides[0].credits = 10000;
    const shooter = E.makeGround(s, 0, 'machinegunner', -1000, 450);
    const target = E.makeGround(s, 1, 'infantry', -1000 + distance, 450);
    target.hp = target.maxHp = 1e6;
    target.holdFire = true;
    s.groundUnits.push(shooter, target);
    for (let i = 0; i < level; i++) assert.equal(E.upgradeDefense(s, 0, shooter.id), true);
    E.step(s, 0.05);
    const round = s.projectiles.find((p) => p.source === shooter.id);
    const first = round && {
      damage: round.damage,
      error: Math.hypot(round.tx - target.x, round.tz - target.z),
    };
    E.advance(s, 8);
    return {
      first,
      shots: s.events.filter((e) => e.type === 'shot' && e.buildingId === shooter.id).length,
    };
  }
  const base = battle(0, 70),
    upgraded = battle(2, 70);
  assert.ok(upgraded.shots > base.shots, `${upgraded.shots} > ${base.shots}`);
  assert.ok(upgraded.first.error < base.first.error);
  assert.equal(upgraded.first.damage, base.first.damage);
  const distance = E.GROUND_UNITS.machinegunner.groundRange * 1.08;
  assert.equal(battle(0, distance).shots, 0);
  assert.ok(battle(2, distance).shots > 0);
});

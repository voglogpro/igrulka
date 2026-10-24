import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { damageGround } from '../../src/game/units/ground/combat.js';

function fresh(tech = Object.keys(E.TECH)) {
  const s = E.createGame(91);
  s.mode = 'multiplayer';
  for (const f of s.sides) {
    f.credits = 1e6;
    f.materials = 1e6;
    f.tech = [...tech];
  }
  return s;
}
const LADDER = ['armoredcar', 'lighttank', 'ifv', 'leopard', 'heavytank'];

test('vehicle ladder grows from cheap scout cars to heavy tanks', () => {
  for (let i = 1; i < LADDER.length; i++) {
    const weaker = E.GROUND_UNITS[LADDER[i - 1]],
      stronger = E.GROUND_UNITS[LADDER[i]];
    assert.ok(stronger.cost >= weaker.cost, LADDER[i]);
    assert.ok(stronger.hp >= weaker.hp, LADDER[i]);
  }
  assert.equal(E.GROUND_UNITS.armoredcar.tech, undefined);
  assert.equal(E.GROUND_UNITS.heavytank.tech, 'heavyArmor');
  assert.equal(E.TECH.heavyArmor.requires, 'armor');
  assert.equal(E.TECH.armor.requires, 'lightArmor');
});

test('every new vehicle fights a real target', () => {
  for (const key of ['armoredcar', 'lighttank', 'ifv', 'heavytank']) {
    const s = fresh(),
      u = E.makeGround(s, 0, key, -500, 250),
      enemy = E.makeGround(s, 1, 'apc', -400, 250);
    enemy.hp = enemy.maxHp = 1e5;
    s.groundUnits.push(u, enemy);
    E.advance(s, 12);
    assert.ok(
      s.events.some((e) => e.type === 'shot' && e.shooter === key),
      key + ' must fire',
    );
    assert.ok(enemy.hp < enemy.maxHp, key + ' must hit');
  }
});

test('an MLRS fires a twelve-rocket salvo and then reloads', () => {
  const s = fresh(),
    launcher = E.makeGround(s, 0, 'mlrs', -560, 250),
    target = E.makeGround(s, 1, 'heavytank', -60, 250);
  target.hp = target.maxHp = 1e6;
  target.holdFire = true;
  // Rockets need a target that a friendly observer sees.
  s.groundUnits.push(launcher, target, E.makeGround(s, 0, 'sniper', -100, 250));
  s.groundUnits.at(-1).holdFire = true;
  E.advance(s, 8);
  const shots = s.events.filter((e) => e.type === 'shot' && e.shooter === 'mlrs').length;
  assert.equal(shots, 12);
  assert.ok(launcher.groundReload > 20);
});

test('composite armour and body armour change new units', () => {
  const plain = fresh([]),
    researched = fresh(['composite']);
  assert.equal(E.makeGround(plain, 0, 'lighttank', 0, 0).maxHp, E.GROUND_UNITS.lighttank.hp);
  assert.equal(
    E.makeGround(researched, 0, 'lighttank', 0, 0).maxHp,
    Math.round(E.GROUND_UNITS.lighttank.hp * 1.25),
  );
  const s = fresh(['bodyArmor']),
    soldier = E.makeGround(s, 0, 'infantry', 0, 300);
  s.groundUnits.push(soldier);
  damageGround(s, soldier, 10, () => {}, 'bullet');
  assert.ok(Math.abs(soldier.maxHp - soldier.hp - 8.5) < 1e-9);
});

test('new vehicles require their research and the bot difficulty is saved', () => {
  const s = fresh([]);
  s.buildings.push({
    id: s.nextId++,
    key: 'barracks',
    side: 0,
    x: -500,
    z: 120,
    hp: 600,
    maxHp: 600,
    progress: 1,
  });
  assert.equal(E.recruit(s, 0, 'heavytank'), 'Нужно исследование');
  const game = E.createGame(5, { difficulty: 'easy' });
  assert.equal(E.load(E.save(game)).difficulty, 'easy');
  const old = JSON.parse(E.save(game));
  delete old.difficulty;
  assert.equal(E.load(JSON.stringify(old)).difficulty, 'hard');
  assert.equal(E.economy(game, 1).bonus, 1);
});

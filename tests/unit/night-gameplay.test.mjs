import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../../src/game/index.js';
import { impactGround } from '../../src/game/units/ground/combat.js';
import { damageGround } from '../../src/game/units/ground/combat.js';
import { moveProjectiles } from '../../src/game/combat/projectiles.js';
import { guardGround, defendLineGround } from '../../src/game/units/ground/guard.js';
import {
  setRecruitRepeat,
  recruitRepeatStatus,
  updateRecruitRepeat,
} from '../../src/game/units/ground/repeat.js';
import {
  gainGroundExperience,
  veteranRank,
  VETERAN_XP_CAP,
} from '../../src/game/units/ground/veterancy.js';
import { setRallyMode, defaultRallyMode } from '../../src/game/units/ground/recruitment.js';
import { fireDefenses } from '../../src/game/combat/air-defense.js';

function fresh() {
  const s = game.createGame(39);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextResearch = s.ai.nextArmy = 1e9;
  for (const f of s.sides) {
    f.credits = 100000;
    f.materials = 10000;
    f.tech = Object.keys(game.TECH);
  }
  return s;
}

function unit(s, side, key, x, z) {
  const u = game.makeGround(s, side, key, x, z);
  s.groundUnits.push(u);
  return u;
}

test('veterans gain finite experience only from actual enemy damage and a single defeat', () => {
  const s = fresh();
  const shooter = unit(s, 0, 'machinegunner', -430, 250);
  const enemy = unit(s, 1, 'infantry', -380, 250);
  const friendly = unit(s, 0, 'infantry', -380, 255);
  const projectile = {
    source: shooter.id,
    side: 0,
    shooterKey: shooter.key,
    kind: 'bullet',
    tx: enemy.x,
    tz: enemy.z,
    px: shooter.x,
    pz: shooter.z,
    damage: 8,
    suppression: 0.1,
  };
  impactGround(s, { ...projectile, tx: 50, tz: 400 });
  assert.equal(shooter.xp, 0);
  impactGround(s, projectile);
  assert.ok(enemy.hp < enemy.maxHp);
  assert.equal(friendly.hp, friendly.maxHp);
  assert.ok(shooter.xp > 0);
  enemy.hp = 1;
  const before = shooter.xp;
  impactGround(s, projectile);
  assert.equal(shooter.xp, before + 1 + 16);
  impactGround(s, projectile);
  assert.equal(shooter.xp, before + 17);
  for (let i = 0; i < 100; i++) gainGroundExperience(s, shooter.id, 100, true);
  assert.equal(shooter.xp, VETERAN_XP_CAP);
  assert.equal(veteranRank(shooter), 3);
  assert.equal(game.load(game.save(s)).groundUnits[0].xp, VETERAN_XP_CAP);
});

test('guard line assigns posts and a direct order takes precedence', () => {
  const s = fresh();
  const a = unit(s, 0, 'infantry', -510, 250);
  const b = unit(s, 0, 'infantry', -500, 270);
  assert.equal(defendLineGround(s, 0, [a.id, b.id], { x: -500, z: 250 }, { x: -400, z: 250 }), 2);
  assert.deepEqual(a.guard, { x: -500, z: 250 });
  assert.deepEqual(b.guard, { x: -400, z: 250 });
  assert.equal(game.orderGround(s, 0, [a.id], { x: -450, z: 310 }), 1);
  assert.equal(a.guard, null);
  assert.ok(b.guard);
  assert.equal(game.commandUnits(s, 0, [b.id], 'stop'), 1);
  assert.equal(b.guard, null);
});

test('guard intercepts nearby threat and returns to its post when safe', () => {
  const s = fresh();
  const guard = unit(s, 0, 'assault', -410, 250);
  const enemy = unit(s, 1, 'infantry', -310, 250);
  enemy.holdFire = true;
  guard.holdFire = true;
  assert.equal(guardGround(s, 0, [guard.id], { x: -410, z: 250 }), 1);
  game.advance(s, 0.5);
  assert.equal(guard.guardTargetId, null);
  guard.holdFire = false;
  enemy.x = -325;
  game.advance(s, 0.8);
  assert.equal(guard.guardTargetId, enemy.id);
  enemy.hp = 0;
  game.advance(s, 5);
  assert.equal(guard.guardTargetId, null);
  assert.ok(Math.hypot(guard.x + 410, guard.z - 250) <= 3);
  assert.equal(guard.order.mode, 'guard');
});

test('a guard helps an adjacent post but holds fire when ordered', () => {
  const s = fresh();
  const helper = unit(s, 0, 'assault', -460, 230);
  const neighbor = unit(s, 0, 'infantry', -395, 230);
  const enemy = unit(s, 1, 'infantry', -340, 230);
  enemy.holdFire = true;
  neighbor.holdFire = true;
  assert.equal(guardGround(s, 0, [helper.id], { x: -460, z: 230 }), 1);
  assert.equal(guardGround(s, 0, [neighbor.id], { x: -395, z: 230 }), 1);
  game.advance(s, 0.8);
  assert.equal(helper.guardTargetId, enemy.id);
  helper.holdFire = true;
  game.advance(s, 1);
  assert.equal(helper.guardTargetId, null);
  assert.ok(Math.hypot(helper.x + 460, helper.z - 230) <= 3);
});

test('guard abandons a chase past its leash and returns without a fresh command', () => {
  const s = fresh();
  const defender = unit(s, 0, 'assault', -410, 250);
  const enemy = unit(s, 1, 'infantry', -330, 250);
  enemy.holdFire = true;
  assert.equal(guardGround(s, 0, [defender.id], { x: -410, z: 250 }), 1);
  game.advance(s, 0.8);
  assert.equal(defender.guardTargetId, enemy.id);
  enemy.x = -200;
  game.advance(s, 5);
  assert.equal(defender.guardTargetId, null);
  assert.equal(defender.order.mode, 'guard');
  assert.ok(Math.hypot(defender.x + 410, defender.z - 250) <= 3);
});

test('an actual aircraft hit grants experience to the surviving shooter once', () => {
  const s = fresh();
  const shooter = unit(s, 0, 'mog', -450, 250);
  const drone = {
    id: s.nextId++,
    key: 'drone',
    side: 1,
    hp: 3,
    x: -400,
    y: 20,
    z: 250,
    prevX: -400,
    prevY: 20,
    prevZ: 250,
    delay: 0,
  };
  s.units.push(drone);
  s.projectiles.push({
    id: s.nextId++,
    sourceId: shooter.id,
    side: 0,
    kind: 'bullet',
    x: -405,
    y: 20,
    z: 250,
    vx: 100,
    vy: 0,
    vz: 0,
    life: 0,
    maxLife: 1,
    damage: 5,
  });
  moveProjectiles(s, 0.1);
  assert.equal(drone.hp, 0);
  assert.equal(shooter.xp, 19);
  moveProjectiles(s, 0.1);
  assert.equal(shooter.xp, 19);
});

test('experienced mobile AA applies its rank when firing at a real airborne target', () => {
  function firstSpread(xp) {
    const s = fresh();
    const shooter = unit(s, 0, 'shilka', -430, 250);
    shooter.xp = xp;
    s.units.push({
      id: s.nextId++,
      key: 'drone',
      side: 1,
      hp: 30,
      x: -380,
      y: 40,
      z: 250,
      delay: 0,
      launched: true,
      status: 'flying',
      vx: 0,
      vy: 0,
      vz: 0,
      total: 200,
      travelled: 0,
    });
    fireDefenses(s, [game.economy(s, 0), game.economy(s, 1)], 0.05);
    assert.equal(s.projectiles.filter((p) => p.sourceId === shooter.id).length, 1);
    assert.ok(Number.isFinite(shooter.lastSpread) && shooter.lastSpread > 0);
    return shooter.lastSpread;
  }
  assert.ok(firstSpread(360) < firstSpread(0));
});

test('repeat recruitment pays each cycle, pauses at resource shortage and resumes', () => {
  const s = fresh();
  const b = game.build(s, 0, 'barracks', -680, -10);
  assert.notEqual(typeof b, 'string', b);
  b.hp = b.maxHp;
  b.progress = 1;
  const cost = game.GROUND_UNITS.infantry.cost;
  s.sides[0].credits = cost;
  assert.equal(setRecruitRepeat(s, 0, b.id, 'infantry'), true);
  updateRecruitRepeat(s);
  assert.equal(b.armyQueue.length, 1);
  assert.equal(s.sides[0].credits, 0);
  assert.equal(recruitRepeatStatus(s, 0, b.id).status, 'queued');
  b.armyQueue[0].progress = 0.999;
  game.advance(s, 0.1);
  assert.equal(s.groundUnits.filter((u) => u.side === 0).length, 1);
  assert.equal(b.armyQueue.length, 0);
  assert.equal(recruitRepeatStatus(s, 0, b.id).status, 'resources');
  s.sides[0].credits = cost;
  game.advance(s, 0.05);
  assert.equal(b.armyQueue.length, 1);
  assert.equal(setRecruitRepeat(s, 0, b.id, 'infantry', false), true);
  assert.equal(recruitRepeatStatus(s, 0, b.id).status, 'off');
  assert.equal(
    game.load(game.save(s)).buildings.find((site) => site.id === b.id).recruitRepeat,
    null,
  );
  b.armyQueue = [];
  for (let i = s.groundUnits.filter((u) => u.side === 0).length; i < game.GROUND_LIMIT; i++)
    unit(s, 0, 'infantry', -500, 400);
  s.sides[0].credits = cost;
  assert.equal(setRecruitRepeat(s, 0, b.id, 'infantry'), true);
  assert.equal(recruitRepeatStatus(s, 0, b.id).status, 'unit-limit');
  updateRecruitRepeat(s);
  assert.equal(b.armyQueue.length, 0);
  assert.equal(s.sides[0].credits, cost);
  assert.deepEqual(
    game.load(game.save(s)).buildings.find((site) => site.id === b.id).recruitRepeat,
    { enabled: true, key: 'infantry' },
  );
});

test('barracks can send recruits to guard, wait, or move with combat to rally', () => {
  for (const mode of ['guard', 'wait', 'attackmove']) {
    const s = fresh();
    const b = game.build(s, 0, 'barracks', -680, -10);
    assert.notEqual(typeof b, 'string', b);
    b.hp = b.maxHp;
    b.progress = 1;
    const rally = { x: -500, z: -40 };
    assert.equal(game.setRally(s, 0, b.id, rally), true);
    if (mode !== 'guard') assert.equal(setRallyMode(s, 0, b.id, mode), true);
    assert.equal(game.recruit(s, 0, 'infantry', b.id), true);
    b.armyQueue[0].progress = 0.999;
    game.advance(s, 0.1);
    const u = s.groundUnits.find((v) => v.side === 0);
    assert.ok(u);
    if (mode === 'guard') {
      assert.ok(u.guard);
      assert.ok(Math.hypot(u.guard.x - rally.x, u.guard.z - rally.z) <= 26);
      assert.equal(u.order.mode, 'guard');
    } else if (mode === 'attackmove') {
      assert.equal(u.order.mode, 'attackmove');
      assert.equal(u.guard, null);
    } else {
      assert.equal(u.order, null);
      assert.equal(u.guard, undefined);
    }
    assert.equal(
      game.load(game.save(s)).buildings.find((site) => site.id === b.id).rallyMode,
      mode === 'guard' ? undefined : mode,
    );
  }
});

test('default rally guards both human sides but leaves solo bot available for its AI', () => {
  const s = fresh();
  const b = game.build(s, 1, 'barracks', 680, -10);
  assert.notEqual(typeof b, 'string', b);
  b.hp = b.maxHp;
  b.progress = 1;
  assert.equal(defaultRallyMode(s, b), 'wait');
  assert.equal(game.recruit(s, 1, 'infantry', b.id), true);
  b.armyQueue[0].progress = 0.999;
  game.advance(s, 0.1);
  const first = s.groundUnits.find((u) => u.side === 1);
  assert.equal(first.guard, undefined);
  for (let i = 0; i < 6; i++) unit(s, 1, 'infantry', 500, 200 + i * 8);
  s.ai.nextArmy = 0;
  s.time = 231;
  game.advance(s, 0.1);
  assert.ok(
    first.order?.mode === 'attackmove' ||
      (first.aiDistrict && first.guard && first.path.length > 0),
    'the actual army AI must give the recruit an attack or a reachable district post',
  );
  const districtGuards = s.groundUnits.filter((u) => u.side === 1 && u.aiDistrict && u.guard);
  assert.ok(districtGuards.length > 0 && districtGuards.length <= 3);
  const attacker = s.groundUnits.find((u) => u.side === 1 && u.order?.mode === 'attackmove');
  assert.ok(attacker, 'district garrisons must leave an actual attacking reserve');
  const enemyHQ = s.buildings.find((site) => site.side === 0 && site.key === 'hq');
  const before = Math.hypot(attacker.x - enemyHQ.x, attacker.z - enemyHQ.z);
  game.advance(s, 2);
  assert.ok(
    Math.hypot(attacker.x - enemyHQ.x, attacker.z - enemyHQ.z) < before - 5,
    'the attacking reserve must really move toward the enemy instead of idling at base',
  );
  s.mode = 'multiplayer';
  assert.equal(defaultRallyMode(s, b), 'guard');
  s.ai.nextArmy = 1e9;
  b.armyQueue = [];
  b.armyQueue.push({ key: 'infantry', progress: 0.999 });
  game.advance(s, 0.1);
  const second = s.groundUnits.filter((u) => u.side === 1).at(-1);
  assert.ok(second.guard);
  assert.equal(second.order.mode, 'guard');
});

test('a city wall gives directional cover while flanks and blasts remain exposed', () => {
  const s = fresh();
  const b = game.build(s, 0, 'launcher', -350, 100);
  assert.notEqual(typeof b, 'string', b);
  b.hp = b.maxHp;
  b.progress = 1;
  const half = game.BUILDINGS.launcher.size * 0.56;
  const defender = unit(s, 0, 'infantry', b.x + half + 4, b.z);
  const front = { x: defender.x + 100, z: defender.z };
  const flank = { x: defender.x, z: defender.z + 100 };
  const across = { x: b.x - half - 30, z: b.z };
  assert.equal(game.lineOfSight(s, defender, across), false);
  assert.equal(game.coverInfo(s, defender, front).kind, 'Стена');
  assert.ok(game.coverInfo(s, defender, front).cover > game.coverInfo(s, defender, flank).cover);
  const before = defender.hp;
  damageGround(s, defender, 10, undefined, 'bullet', front);
  const frontalLoss = before - defender.hp;
  defender.hp = before;
  damageGround(s, defender, 10, undefined, 'bullet', flank);
  assert.ok(before - defender.hp > frontalLoss);
  defender.hp = before;
  damageGround(s, defender, 10, undefined, 'blast', front);
  assert.equal(before - defender.hp, 10);
  b.hp = 0;
  s.networkRevision++;
  assert.equal(game.coverInfo(s, defender, front).kind, 'Руины');
});

test('a single guard seeks nearby cover; a drawn defense line keeps exact posts', () => {
  const s = fresh();
  const b = game.build(s, 0, 'launcher', -350, 100);
  assert.notEqual(typeof b, 'string', b);
  b.hp = b.maxHp;
  b.progress = 1;
  const half = game.BUILDINGS.launcher.size * 0.56;
  const point = { x: b.x + half + 25, z: b.z };
  const a = unit(s, 0, 'infantry', point.x + 5, point.z);
  const bUnit = unit(s, 0, 'infantry', point.x + 7, point.z + 20);
  assert.equal(guardGround(s, 0, [a.id], point), 1);
  assert.ok(Math.hypot(a.guard.x - point.x, a.guard.z - point.z) <= 26);
  assert.ok(
    game.coverInfo(s, { ...a.guard, key: 'infantry' }).cover >
      game.coverInfo(s, { ...point, key: 'infantry' }).cover,
  );
  assert.equal(typeof guardGround(s, 0, [a.id], { x: b.x, z: b.z }), 'string');
  assert.notDeepEqual(a.guard, { x: b.x, z: b.z });
  assert.equal(defendLineGround(s, 0, [bUnit.id], point, point), 1);
  assert.deepEqual(bUnit.guard, point);
});

test('guard yields cleanly to dig, boarding and retreat; MOG packs before changing post', () => {
  const s = fresh();
  const infantry = unit(s, 0, 'infantry', -450, 280);
  const apc = unit(s, 0, 'apc', -430, 280);
  const mog = unit(s, 0, 'mog', -500, 300);
  assert.equal(guardGround(s, 0, [infantry.id], { x: -450, z: 280 }), 1);
  assert.equal(game.commandUnits(s, 0, [infantry.id], 'dig'), 1);
  assert.equal(infantry.guard, null);
  assert.ok(infantry.digging);
  assert.equal(guardGround(s, 0, [infantry.id], { x: -450, z: 280 }), 1);
  assert.equal(infantry.digging, false);
  assert.equal(game.boardGround(s, 0, [infantry.id], apc.id), 1);
  assert.equal(infantry.guard, null);
  assert.equal(infantry.order.mode, 'board');
  game.unloadGround(s, 0, apc.id);
  infantry.boardingId = null;
  assert.equal(guardGround(s, 0, [infantry.id], { x: infantry.x, z: infantry.z }), 1);
  assert.equal(game.commandUnits(s, 0, [infantry.id], 'retreat'), 1);
  assert.equal(infantry.guard, null);
  assert.equal(infantry.order.mode, 'retreat');
  mog.holdFire = true;
  game.advance(s, 3.2);
  assert.equal(mog.setup, 1);
  assert.equal(guardGround(s, 0, [mog.id], { x: -450, z: 300 }), 1);
  game.advance(s, 0.2);
  assert.equal(mog.setup, 0);
});

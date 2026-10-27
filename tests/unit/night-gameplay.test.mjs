import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../../src/game/index.js';
import { impactGround } from '../../src/game/units/ground/combat.js';
import { damageGround } from '../../src/game/units/ground/combat.js';
import { moveProjectiles } from '../../src/game/combat/projectiles.js';
import { guardGround, defendLineGround } from '../../src/game/units/ground/guard.js';
import {
  setArmyTarget,
  armyCompositionStatus,
  updateArmyComposition,
} from '../../src/game/units/ground/composition.js';
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
  const shooter = unit(s, 0, 'machinegunner', -830, 250);
  const enemy = unit(s, 1, 'infantry', -780, 250);
  const friendly = unit(s, 0, 'infantry', -780, 255);
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
  const a = unit(s, 0, 'infantry', -910, 250);
  const b = unit(s, 0, 'infantry', -900, 270);
  assert.equal(defendLineGround(s, 0, [a.id, b.id], { x: -900, z: 250 }, { x: -800, z: 250 }), 2);
  assert.deepEqual(a.guard, { x: -900, z: 250 });
  assert.deepEqual(b.guard, { x: -800, z: 250 });
  assert.equal(game.orderGround(s, 0, [a.id], { x: -850, z: 310 }), 1);
  assert.equal(a.guard, null);
  assert.ok(b.guard);
  assert.equal(game.commandUnits(s, 0, [b.id], 'stop'), 1);
  assert.equal(b.guard, null);
});

test('guard intercepts nearby threat and returns to its post when safe', () => {
  const s = fresh();
  const guard = unit(s, 0, 'assault', -810, 250);
  const enemy = unit(s, 1, 'infantry', -710, 250);
  enemy.holdFire = true;
  guard.holdFire = true;
  assert.equal(guardGround(s, 0, [guard.id], { x: -810, z: 250 }), 1);
  game.advance(s, 0.5);
  assert.equal(guard.guardTargetId, null);
  guard.holdFire = false;
  enemy.x = -725;
  game.advance(s, 0.8);
  assert.equal(guard.guardTargetId, enemy.id);
  enemy.hp = 0;
  game.advance(s, 5);
  assert.equal(guard.guardTargetId, null);
  assert.ok(Math.hypot(guard.x + 810, guard.z - 250) <= 3);
  assert.equal(guard.order.mode, 'guard');
});

test('a guard helps an adjacent post but holds fire when ordered', () => {
  const s = fresh();
  const helper = unit(s, 0, 'assault', -860, 230);
  const neighbor = unit(s, 0, 'infantry', -795, 230);
  const enemy = unit(s, 1, 'infantry', -740, 230);
  enemy.holdFire = true;
  neighbor.holdFire = true;
  assert.equal(guardGround(s, 0, [helper.id], { x: -860, z: 230 }), 1);
  assert.equal(guardGround(s, 0, [neighbor.id], { x: -795, z: 230 }), 1);
  game.advance(s, 0.8);
  assert.equal(helper.guardTargetId, enemy.id);
  helper.holdFire = true;
  game.advance(s, 1);
  assert.equal(helper.guardTargetId, null);
  assert.ok(Math.hypot(helper.x + 860, helper.z - 230) <= 3);
});

test('guard abandons a chase past its leash and returns without a fresh command', () => {
  const s = fresh();
  const defender = unit(s, 0, 'assault', -810, 250);
  const enemy = unit(s, 1, 'infantry', -730, 250);
  enemy.holdFire = true;
  assert.equal(guardGround(s, 0, [defender.id], { x: -810, z: 250 }), 1);
  game.advance(s, 0.8);
  assert.equal(defender.guardTargetId, enemy.id);
  enemy.x = -600;
  game.advance(s, 5);
  assert.equal(defender.guardTargetId, null);
  assert.equal(defender.order.mode, 'guard');
  assert.ok(Math.hypot(defender.x + 810, defender.z - 250) <= 3);
});

test('an actual aircraft hit grants experience to the surviving shooter once', () => {
  const s = fresh();
  const shooter = unit(s, 0, 'mog', -850, 250);
  const drone = {
    id: s.nextId++,
    key: 'drone',
    side: 1,
    hp: 3,
    x: -800,
    y: 20,
    z: 250,
    prevX: -800,
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
    x: -805,
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
    const shooter = unit(s, 0, 'shilka', -830, 250);
    shooter.xp = xp;
    s.units.push({
      id: s.nextId++,
      key: 'drone',
      side: 1,
      hp: 30,
      x: -780,
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

test('desired army replacement pays ordinary costs, preserves reserves and never erases paid recruits', () => {
  const s = fresh();
  const b = game.build(s, 0, 'barracks', -1080, -10);
  assert.notEqual(typeof b, 'string', b);
  b.hp = b.maxHp;
  b.progress = 1;
  const d = game.GROUND_UNITS.infantry;
  s.sides[0].credits = d.cost + 250;
  s.sides[0].materials = d.metal + 5;
  assert.equal(setArmyTarget(s, 0, 'infantry', 2), true);
  updateArmyComposition(s);
  assert.equal(b.armyQueue.length, 1);
  assert.equal(s.sides[0].credits, 250);
  b.armyQueue[0].progress = 0.999;
  game.advance(s, 0.1);
  assert.equal(s.groundUnits.filter((u) => u.side === 0).length, 1);
  const status = () => armyCompositionStatus(s, 0).types.find((r) => r.key === 'infantry');
  assert.equal(status().status, 'reserve');
  s.sides[0].credits += d.cost;
  s.sides[0].materials += d.metal;
  game.advance(s, 4);
  assert.equal(b.armyQueue.length, 1);
  const paid = structuredClone(b.armyQueue);
  assert.equal(setArmyTarget(s, 0, 'infantry', 0), true);
  assert.deepEqual(b.armyQueue, paid);
  const restored = game.load(game.save(s));
  assert.deepEqual(restored.sides[0].armyComposition.targets, {});
  assert.deepEqual(restored.buildings.find((site) => site.id === b.id).armyQueue, paid);
});

test('barracks can send recruits to guard, wait, or move with combat to rally', () => {
  for (const mode of ['guard', 'wait', 'attackmove']) {
    const s = fresh();
    const b = game.build(s, 0, 'barracks', -1080, -10);
    assert.notEqual(typeof b, 'string', b);
    b.hp = b.maxHp;
    b.progress = 1;
    const rally = { x: -900, z: -40 };
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

test('default rally guards human troops and lets the solo bot enter the shared depot commander', () => {
  const s = fresh();
  const b = game.build(s, 1, 'barracks', 1080, -10);
  assert.notEqual(typeof b, 'string', b);
  b.hp = b.maxHp;
  b.progress = 1;
  assert.equal(defaultRallyMode(s, b), 'wait');
  assert.equal(game.recruit(s, 1, 'infantry', b.id), true);
  b.armyQueue[0].progress = 0.999;
  game.advance(s, 0.1);
  const first = s.groundUnits.find((u) => u.side === 1);
  assert.equal(first.guard ?? null, null);
  for (let i = 0; i < 6; i++) unit(s, 1, 'infantry', 900, 200 + i * 8);
  s.ai.nextArmy = 0;
  s.time = 231;
  game.advance(s, 0.1);
  assert.ok(first.autoDefense && first.stance?.mode === 'defend');
  const districtGuards = s.groundUnits.filter((u) => u.side === 1 && u.autoDefense);
  assert.equal(districtGuards.length, 7);
  assert.ok(districtGuards.every((u) => u.order?.mode !== 'attackmove'));
  const advancing = districtGuards.find((u) => u.guard && u.path.length > 0);
  assert.ok(advancing, 'the shared planner must issue a reachable depot post');
  const goal = { ...advancing.guard },
    before = Math.hypot(advancing.x - goal.x, advancing.z - goal.z);
  game.advance(s, 2);
  assert.ok(
    Math.hypot(advancing.x - goal.x, advancing.z - goal.z) < before - 5,
    'the guard must really move toward the depot approach instead of idling at base',
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
  const b = game.build(s, 0, 'launcher', -750, 100);
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
  const b = game.build(s, 0, 'launcher', -750, 100);
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
  const infantry = unit(s, 0, 'infantry', -850, 280);
  const apc = unit(s, 0, 'apc', -830, 280);
  const mog = unit(s, 0, 'mog', -900, 300);
  assert.equal(guardGround(s, 0, [infantry.id], { x: -850, z: 280 }), 1);
  assert.equal(game.commandUnits(s, 0, [infantry.id], 'dig'), 1);
  assert.equal(infantry.guard, null);
  assert.ok(infantry.digging);
  assert.equal(guardGround(s, 0, [infantry.id], { x: -850, z: 280 }), 1);
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
  assert.equal(guardGround(s, 0, [mog.id], { x: -850, z: 300 }), 1);
  game.advance(s, 0.2);
  assert.equal(mog.setup, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateAutomaticFPV, launchFPV } from '../../src/game/units/infantry/fpv.js';
import { moveUnits, impacts } from '../../src/game/units/aviation/flight.js';
import { executeCommand } from '../../src/network/commands.js';

function fresh() {
  const s = E.createGame(888);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  s.rules.oil = false;
  for (const f of s.sides) {
    f.credits = 10000;
    f.materials = 1000;
    f.rearAuto = false;
  }
  return s;
}
function unit(s, side, key, x, z, hold = true) {
  const u = E.makeGround(s, side, key, x, z);
  u.holdFire = hold;
  s.groundUnits.push(u);
  return u;
}
function row(s, gap = 120) {
  for (const z of [250, -250, 400, -400, 0, 150]) {
    const points = [
      { x: -1092, z },
      { x: -1092 + gap, z },
    ];
    if (
      points.every(
        (p) => E.walkable(s, p.x, p.z, 6) && E.coverInfo(s, { ...p, key: 'infantry' }).cover === 0,
      ) &&
      E.lineOfSight(s, points[0], points[1])
    )
      return points;
  }
  throw Error('No exposed dry row for actual fire');
}
const shots = (s, id) => s.events.filter((e) => e.type === 'shot' && e.buildingId === id);
function until(s, condition, limit) {
  const deadline = s.time + limit;
  while (!condition() && s.time < deadline) E.step(s, 0.05);
  assert.ok(condition(), `condition not met by ${s.time}`);
}

test('early AT rifle actually fires one round, spends a full reload and cannot fire while marching', () => {
  for (const side of [0, 1]) {
    const s = fresh(),
      [a, b] = row(s, 100),
      rifle = unit(s, side, 'atrifle', a.x, a.z, false),
      target = unit(s, 1 - side, 'apc', b.x, b.z);
    target.hp = target.maxHp = 5000;
    // Isolate the weapon cycle from an idle soldier's autonomous reload retreat.
    // Explicit manual posts remain stationary even while the magazine is empty.
    rifle.guard = { x: a.x, z: a.z };
    rifle.order = { ...rifle.guard, mode: 'guard' };
    assert.equal(E.GROUND_UNITS.atrifle.tech, undefined);
    until(s, () => shots(s, rifle.id).length === 1, 2);
    const first = shots(s, rifle.id)[0].time;
    assert.equal(rifle.groundAmmo, 0);
    E.advance(s, 7.3);
    assert.equal(shots(s, rifle.id).length, 1);
    until(s, () => shots(s, rifle.id).length === 2, 1);
    assert.ok(shots(s, rifle.id)[1].time - first >= 7.5);
    assert.ok(target.hp < target.maxHp, 'real bullet impacts damage the vehicle');
    assert.equal(E.orderGround(s, side, [rifle.id], { x: a.x, z: a.z + 140, mode: 'move' }), 1);
    const count = shots(s, rifle.id).length,
      start = { x: rifle.x, z: rifle.z };
    E.advance(s, 4);
    assert.ok(rifle.moving);
    assert.equal(shots(s, rifle.id).length, count);
    assert.ok(Math.hypot(rifle.x - start.x, rifle.z - start.z) > 30);
  }
});

test('the same real AT rifle round damages light armour more than a heavy tank', () => {
  const damages = {};
  for (const key of ['apc', 'leopard']) {
    const s = fresh(),
      [a, b] = row(s, 85),
      rifle = unit(s, 0, 'atrifle', a.x, a.z, false),
      target = unit(s, 1, key, b.x, b.z);
    const before = target.hp;
    until(s, () => target.hp < before, 3);
    assert.equal(shots(s, rifle.id).length, 1);
    damages[key] = before - target.hp;
  }
  assert.ok(damages.apc > damages.leopard * 1.8);
  assert.ok(
    damages.leopard < 50,
    'one early rifle is not a substitute for heavy anti-tank weapons',
  );
});

test('AT rifle does not shoot a real airborne drone even when it passes within rifle ground range', () => {
  const s = fresh(),
    [a, b] = row(s, 120),
    rifle = unit(s, 0, 'atrifle', a.x, a.z, false),
    operator = unit(s, 1, 'operator', b.x, b.z);
  assert.equal(launchFPV(s, 1, [operator.id], { x: a.x, z: a.z + 80 }), true);
  // Air-only inspection: move the actual aircraft without presenting the enemy operator as a ground target.
  s.groundUnits = s.groundUnits.filter((u) => u !== operator);
  E.advance(s, 1);
  assert.ok(s.units.some((u) => u.hp > 0 && u.subtype === 'fpv'));
  assert.equal(shots(s, rifle.id).length, 0);
  assert.ok(!s.projectiles.some((p) => p.sourceId === rifle.id || p.source === rifle.id));
  assert.equal(E.GROUND_UNITS.atrifle.range, 0);
});

test('autonomous FPV prioritizes observed tanks and reserves in-flight damage rather than overspending an operator group', () => {
  const s = fresh(),
    [a, b] = row(s, 100);
  const operators = Array.from({ length: 5 }, (_, i) =>
    unit(s, 0, 'operator', a.x, a.z + i * 2, false),
  );
  const tank = unit(s, 1, 'leopard', b.x, b.z),
    apc = unit(s, 1, 'apc', a.x + 40, a.z + 20);
  tank.hp = tank.maxHp = 300;
  apc.hp = apc.maxHp = 200;
  const before = [s.sides[0].credits, s.sides[0].materials];
  updateAutomaticFPV(s);
  const strikes = s.units.filter((u) => u.subtype === 'fpv');
  assert.equal(strikes.length, 4);
  assert.deepEqual(
    strikes.slice(0, 2).map((u) => u.fpvTargetId),
    [tank.id, tank.id],
  );
  assert.equal(strikes.filter((u) => u.fpvTargetId === tank.id).length, 2);
  assert.equal(strikes.filter((u) => u.fpvTargetId === apc.id).length, 2);
  assert.deepEqual(
    [s.sides[0].credits, s.sides[0].materials],
    before,
    'launch consumes the operator’s paid local FPV stock without a second resource charge',
  );
  assert.equal(
    operators.reduce((n, u) => n + u.fpvAmmo, 0),
    11,
  );
  assert.equal(operators.filter((u) => u.fpvAmmo === 3).length, 1);
  updateAutomaticFPV(s);
  assert.equal(s.units.length, 4, 'cadence and cooldown prevent duplicate launches');
});

test('automatic operators respect hold fire, motion, suppression, passenger state and carried targets', () => {
  for (const blocked of ['holdFire', 'moving', 'suppression', 'carrierId', 'carriedTarget']) {
    const s = fresh(),
      [a, b] = row(s, 100),
      operator = unit(s, 0, 'operator', a.x, a.z, false),
      target = unit(s, 1, 'leopard', b.x, b.z);
    if (blocked === 'carriedTarget') {
      target.carrierId = 123;
      assert.equal(E.groundVisible(s, 0, target), false);
    } else
      operator[blocked] = blocked === 'suppression' ? 0.9 : blocked === 'carrierId' ? 123 : true;
    const before = [operator.fpvAmmo, s.sides[0].credits, s.sides[0].materials];
    updateAutomaticFPV(s);
    assert.equal(s.units.length, 0, blocked);
    assert.deepEqual([operator.fpvAmmo, s.sides[0].credits, s.sides[0].materials], before);
  }
});

test('a guided FPV physically chases and hits a moving observed tank away from its initial target point', () => {
  for (const side of [0, 1]) {
    const s = fresh(),
      [a, b] = row(s, 140),
      operator = unit(s, side, 'operator', a.x, a.z),
      tank = unit(s, 1 - side, 'leopard', b.x, b.z);
    unit(s, side, 'infantry', b.x - 20, b.z + 50);
    assert.equal(launchFPV(s, side, [operator.id], b, tank.id), true);
    const initial = { x: tank.x, z: tank.z },
      before = tank.hp,
      air = s.units[0];
    assert.equal(
      E.orderGround(s, 1 - side, [tank.id], { x: tank.x, z: tank.z + 120, mode: 'move' }),
      1,
    );
    until(s, () => s.stats.impacts > 0, 8);
    assert.ok(Math.hypot(tank.x - initial.x, tank.z - initial.z) > air.blast * 2);
    assert.ok(tank.hp < before);
    const impact = s.events.find((e) => e.type === 'impact' && e.key === 'fpv');
    assert.ok(Math.hypot(impact.x - tank.x, impact.z - tank.z) < air.blast);
    assert.equal(air.hp, 0);
  }
});

test('guidance never reads concealed infantry new position and the real flight impacts only its last observed coordinates', () => {
  const s = fresh(),
    [a, b] = row(s, 130),
    operator = unit(s, 0, 'operator', a.x, a.z),
    tank = unit(s, 1, 'infantry', b.x, b.z);
  tank.moving = true;
  assert.equal(launchFPV(s, 0, [operator.id], b, tank.id), true);
  const air = s.units[0],
    aim = { x: air.tx, z: air.tz };
  tank.x = 1192;
  tank.z = 700;
  tank.moving = false;
  tank.camouflaged = true;
  s.trenches.push({ id: s.nextId++, side: 1, x: tank.x, z: tank.z, progress: 1 });
  assert.equal(E.groundVisible(s, 0, tank), false);
  const hp = tank.hp;
  for (let i = 0; i < 100 && air.hp > 0; i++) {
    s.time += 0.05;
    moveUnits(s, 0.05);
    impacts(s);
    assert.equal(air.tx, aim.x);
    assert.equal(air.tz, aim.z);
  }
  assert.equal(air.hp, 0);
  assert.equal(tank.hp, hp);
  const impact = s.events.find((e) => e.type === 'impact');
  assert.equal(impact.x, aim.x);
  assert.equal(impact.z, aim.z);
});

test('the actual command gateway locks a visible vehicle for either owner and rejects hidden or invalid targets without payment', () => {
  for (const side of [0, 1]) {
    const s = fresh(),
      [a, b] = row(s, 120),
      operator = unit(s, side, 'operator', a.x, a.z),
      target = unit(s, 1 - side, 'leopard', b.x, b.z);
    assert.equal(E.groundVisible(s, side, target), true);
    assert.equal(
      executeCommand(s, side, 'fpv', {
        ids: [operator.id],
        point: { x: target.x, z: target.z, targetId: target.id },
      }),
      true,
    );
    assert.equal(s.units[0].fpvTargetId, target.id);
    assert.equal(operator.fpvAmmo, 2);
    const denied = fresh(),
      op = unit(denied, side, 'operator', a.x, a.z),
      hidden = unit(denied, 1 - side, 'infantry', a.x - 260, a.z);
    hidden.camouflaged = true;
    denied.trenches.push({
      id: denied.nextId++,
      side: 1 - side,
      x: hidden.x,
      z: hidden.z,
      progress: 1,
    });
    assert.equal(E.groundVisible(denied, side, hidden), false);
    const before = E.save(denied);
    for (const targetId of [hidden.id, op.id, -1, 'constructor', 999999]) {
      assert.equal(
        typeof executeCommand(denied, side, 'fpv', {
          ids: [op.id],
          point: { x: hidden.x, z: hidden.z, targetId },
        }),
        'string',
      );
      assert.equal(
        E.save(denied),
        before,
        'rejected target cannot consume ammo, resources, cooldown, events or ids',
      );
    }
    const building = {
      id: denied.nextId++,
      side: 1 - side,
      key: 'industry',
      x: a.x + 100,
      z: a.z + 70,
      hp: E.BUILDINGS.industry.hp,
      maxHp: E.BUILDINGS.industry.hp,
      progress: 1,
    };
    denied.buildings.push(building);
    assert.equal(
      executeCommand(denied, side, 'fpv', {
        ids: [op.id],
        point: { x: building.x, z: building.z, targetId: building.id },
      }),
      true,
    );
    assert.equal(
      denied.units[0].fpvTargetId,
      undefined,
      'a known building remains an ordinary point strike',
    );
  }
});

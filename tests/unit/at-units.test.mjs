import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

// Pre-position already purchased weapons for isolated combat tests; no free rack stock.
function stage(s, site, key, count) {
  E.initLaunchStore(site);
  const accepted = E.acceptLaunchDelivery(
    site,
    key,
    Math.min(count, s.sides[site.side].inventory[key]),
  );
  s.sides[site.side].inventory[key] -= accepted;
  assert.equal(accepted, count);
}
import * as T from '../../vendor/three/three.module.js';
import { groundWeaponProfile, groundEngagement } from '../../src/game/units/ground/engagement.js';
import { groundModel, animateGround } from '../../src/rendering/models/ground.js';
import { InfantryBatch } from '../../src/rendering/models/infantry/soldiers.js';
import { RTSWorld } from '../../src/rendering/world.js';

function fresh() {
  const s = E.createGame(832);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 1e6;
    f.materials = 1e6;
  }
  return s;
}
function unit(s, side, key, x, z) {
  const u = E.makeGround(s, side, key, x, z);
  s.groundUnits.push(u);
  return u;
}
function openRow(s, gap) {
  for (const z of [-450, -350, -200, 200, 250, 300, 350, 400, 450]) {
    const a = { x: -1000, z },
      b = { x: -1000 + gap, z };
    if (
      [a, b].every(
        (p) => E.walkable(s, p.x, p.z, 5) && E.coverInfo(s, { key: 'infantry', ...p }).cover === 0,
      )
    )
      return [a, b];
  }
  throw Error('No open fixture row');
}
function attack(s, u, target) {
  assert.equal(
    E.orderGround(s, u.side, [u.id], {
      x: target.x,
      z: target.z,
      targetId: target.id,
      mode: 'attack',
    }),
    1,
  );
}
function runUntil(s, condition, seconds = 40) {
  while (!condition() && s.time < seconds && !s.result) E.step(s, 0.05);
  assert.ok(condition(), `duel did not finish by ${s.time.toFixed(2)}s`);
}

test('both anti-tank roles are registered, ground-only, immediately available and have their own magazines', () => {
  const s = fresh();
  for (const key of ['atgm', 'tankdestroyer']) {
    const d = E.GROUND_UNITS[key];
    assert.ok(d, key);
    assert.equal(d.range, 0);
    assert.equal(d.tech, undefined);
    const u = unit(s, 0, key, -900, 250);
    assert.equal(u.groundAmmo, d.groundMagazine);
    assert.equal(groundWeaponProfile(key).id, 'antiArmor');
  }
  assert.equal(E.GROUND_UNITS.atgm.members, 2);
  assert.equal(E.isInfantry('atgm'), true);
  assert.equal(E.isInfantry('tankdestroyer'), false);
});

test('AT automatically chooses armour over closer infantry and still obeys an explicit infantry order', () => {
  const s = fresh(),
    [a, b] = openRow(s, 180);
  const at = unit(s, 0, 'atgm', a.x, a.z);
  const infantry = unit(s, 1, 'infantry', a.x + 80, a.z);
  const tank = unit(s, 1, 'leopard', b.x, b.z);
  infantry.holdFire = tank.holdFire = true;
  assert.equal(groundEngagement(s, at).target.id, tank.id);
  attack(s, at, infantry);
  at.nextThink = 0;
  assert.equal(groundEngagement(s, at).target.id, infantry.id);
});

test('two cheaper dispersed AT crews stop an advancing tank from their intended standoff range', () => {
  for (const side of [0, 1]) {
    const s = fresh(),
      [a, b] = openRow(s, 220);
    // Separate firing positions: the former 8m cluster put both crews inside one tank splash.
    // Distance alone no longer hides a crew after the explicit removal of map fog.
    const first = unit(s, side, 'atgm', a.x, a.z - 20);
    const second = unit(s, side, 'atgm', a.x, a.z + 20);
    const tank = unit(s, 1 - side, 'leopard', b.x, b.z);
    for (const crew of [first, second]) {
      assert.equal(E.walkable(s, crew.x, crew.z, 3), true);
      assert.equal(
        E.coverInfo(s, crew).cover,
        0,
        'these exposed crews do not gain a hidden cover buff',
      );
      const range = Math.hypot(crew.x - tank.x, crew.z - tank.z);
      assert.ok(
        range < E.GROUND_UNITS.atgm.groundRange && range > E.GROUND_UNITS.leopard.groundRange,
      );
      assert.equal(
        E.groundVisible(s, tank.side, crew),
        true,
        'both crews are visible before firing',
      );
    }
    attack(s, tank, first);
    runUntil(s, () => tank.hp <= 0, 35);
    assert.ok(first.hp > 0 || second.hp > 0, 'dispersed pair should retain a surviving crew');
    assert.ok(2 * E.GROUND_UNITS.atgm.cost < E.GROUND_UNITS.leopard.cost);
    assert.ok(2 * E.GROUND_UNITS.atgm.metal < E.GROUND_UNITS.leopard.metal);
    assert.ok(s.events.some((e) => e.type === 'groundDestroyed' && e.unitId === tank.id));
  }
});

test('anti-tank vehicle defeats an advancing tank from its intended range without teleporting', () => {
  for (const side of [0, 1]) {
    const s = fresh(),
      [a, b] = openRow(s, 220);
    const hunter = unit(s, side, 'tankdestroyer', a.x, a.z);
    const tank = unit(s, 1 - side, 'leopard', b.x, b.z);
    attack(s, tank, hunter);
    runUntil(s, () => tank.hp <= 0 || hunter.hp <= 0, 35);
    assert.equal(tank.hp, 0);
    assert.ok(hunter.hp > 0);
    assert.equal(hunter.x, a.x);
    assert.equal(hunter.z, a.z);
  }
});

test('actual airborne drones receive no AA fire from either new anti-tank role', () => {
  const s = fresh();
  const at = unit(s, 0, 'atgm', -850, 250);
  const hunter = unit(s, 0, 'tankdestroyer', -850, 270);
  const launcher = E.build(s, 1, 'launcher', -700, 250);
  assert.notEqual(typeof launcher, 'string', launcher);
  launcher.progress = 1;
  launcher.hp = launcher.maxHp;
  s.sides[1].inventory.drone = 1;
  stage(s, launcher, 'drone', 1);
  assert.equal(E.launch(s, 1, 'drone', { x: -850, z: 250 }, 1, launcher.id), 1);
  E.advance(s, 1);
  assert.ok(s.units.some((u) => u.key === 'drone' && u.hp > 0));
  assert.ok(!s.projectiles.some((p) => p.sourceId === at.id || p.sourceId === hunter.id));
});

test('assault infantry counters an exposed AT crew and a pair counters the light AT vehicle', () => {
  for (const key of ['atgm', 'tankdestroyer']) {
    const s = fresh(),
      [a, b] = openRow(s, 75);
    const at = unit(s, 0, key, a.x, a.z);
    const attackers = [unit(s, 1, 'assault', b.x, b.z)];
    if (key === 'tankdestroyer') attackers.push(unit(s, 1, 'assault', b.x, b.z + 6));
    for (const u of attackers) attack(s, u, at);
    runUntil(s, () => at.hp <= 0, 40);
    assert.ok(
      attackers.every((u) => u.hp > 0),
      key,
    );
  }
});

test('suppression, movement and hold fire prevent AT launches; recovered crews resume real fire', () => {
  const s = fresh(),
    [a, b] = openRow(s, 180);
  const at = unit(s, 0, 'atgm', a.x, a.z);
  const target = unit(s, 1, 'leopard', b.x, b.z);
  target.holdFire = true;
  at.suppression = 1.4;
  E.advance(s, 2);
  assert.equal(s.events.filter((e) => e.type === 'shot' && e.buildingId === at.id).length, 0);
  at.suppression = 0;
  at.holdFire = true;
  E.advance(s, 1);
  assert.equal(target.hp, target.maxHp);
  at.holdFire = false;
  assert.equal(E.orderGround(s, 0, [at.id], { x: a.x, z: a.z + 70, mode: 'move' }), 1);
  E.advance(s, 1);
  assert.equal(s.events.filter((e) => e.type === 'shot' && e.buildingId === at.id).length, 0);
  E.commandUnits(s, 0, [at.id], 'stop');
  E.advance(s, 2);
  assert.ok(target.hp < target.maxHp);
});

test('new crews consume two APC seats and new roles actually recruit and round trip for either owner', () => {
  for (const side of [0, 1]) {
    const s = fresh();
    const apc = unit(s, side, 'apc', -900, 250);
    const crews = Array.from({ length: 5 }, (_, i) => unit(s, side, 'atgm', -906, 246 + i * 2));
    assert.equal(
      E.boardGround(
        s,
        side,
        crews.map((u) => u.id),
        apc.id,
      ),
      4,
    );
    E.advance(s, 0.1);
    assert.equal(crews.filter((u) => u.carrierId === apc.id).length, 4);
    assert.equal(E.unloadGround(s, side, apc.id), 4);
    const x = side === 0 ? -1080 : 1080;
    const site = E.build(s, side, 'barracks', x, -10);
    assert.notEqual(typeof site, 'string', site);
    site.hp = site.maxHp;
    site.progress = 1;
    assert.equal(E.setRallyMode(s, side, site.id, 'wait'), true);
    assert.equal(E.recruit(s, side, 'atgm', site.id), true);
    const base = E.build(s, side, 'vehiclebase', side === 0 ? -960 : 960, -80);
    assert.equal(typeof base, 'object', String(base));
    base.progress = 1;
    base.hp = base.maxHp;
    assert.equal(E.recruit(s, side, 'tankdestroyer', base.id), true);
    E.advance(s, 65);
    assert.equal(site.armyQueue.length, 0);
    assert.ok(s.groundUnits.some((u) => u.key === 'tankdestroyer' && u.side === side));
    const restored = E.load(E.save(s));
    assert.deepEqual(restored.groundUnits, s.groundUnits);
    assert.deepEqual(restored.sides, s.sides);
  }
});

test('AT models share geometry and a hundred infantry crews use two instanced role draws', () => {
  const s = fresh();
  const world = {
    state: s,
    armySelection: [],
    scene: new T.Scene(),
    boxGeo: new T.BoxGeometry(1, 1, 1),
    cylGeo: new T.CylinderGeometry(1, 1, 1, 12),
    materials: new Map(),
    sharedGeometries: new Set(),
    sharedMaterials: new Set(),
    mat: RTSWorld.prototype.mat,
    box: RTSWorld.prototype.box,
    cyl: RTSWorld.prototype.cyl,
  };
  const u = unit(s, 0, 'tankdestroyer', -900, 250);
  const a = groundModel(world, u),
    b = groundModel(world, { ...u, id: 999 });
  const geometry = (root) => {
    const ids = [];
    root.traverse((m) => {
      if (m.geometry) ids.push(m.geometry.uuid);
    });
    return ids.sort();
  };
  assert.deepEqual(geometry(a), geometry(b));
  assert.ok(a.userData.turret && a.userData.pitch);
  let draws = 0;
  a.traverse((m) => {
    if (m.isMesh) draws++;
  });
  assert.ok(draws < 16, `AT machine has ${draws} meshes after batching`);
  animateGround(a, { ...u, targetX: -800, targetZ: 300, moving: true }, 1, 0.05);
  const batch = new InfantryBatch(world);
  world.camera = new T.OrthographicCamera(-1000, 1000, 1000, -1000, 0.1, 3000);
  world.camera.position.set(0, 1500, 0);
  world.camera.up.set(0, 0, -1);
  world.camera.lookAt(0, 0, 0);
  const crews = Array.from({ length: 100 }, (_, i) => unit(s, 0, 'atgm', -650 + i, 350));
  batch.sync(crews, 0);
  assert.equal(batch.pools.size, 1);
  assert.equal(batch.meshes.filter((mesh) => mesh.visible && mesh.count > 0).length, 2);
  assert.equal(batch.pools.get('atgm0').body.count, 200);
});

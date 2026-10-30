import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { moveProjectiles } from '../../src/game/combat/projectiles.js';
import { damageAircraft, moveUnits, impacts } from '../../src/game/units/aviation/flight.js';
import {
  recordGroundScar,
  restoreGroundScars,
  GROUND_SCARS,
} from '../../src/game/combat/ground-scars.js';
import { GroundScarBatch } from '../../src/rendering/effects/ground-scars.js';
import { CombatEffects } from '../../src/rendering/effects/combat-effects.js';
import { Scene, PerspectiveCamera } from '../../vendor/three/three.module.js';

test('a paid tank consumes local ammunition without a second charge and its shallow ballistic round damages the enemy', () => {
  const s = E.createGame(89);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  s.sides[0].credits = 100000;
  s.sides[0].materials = 10000;
  const base = E.build(s, 0, 'vehiclebase', -1272, -10);
  assert.equal(typeof base, 'object', String(base));
  base.progress = 1;
  base.hp = base.maxHp;
  const recruitmentCredits = s.sides[0].credits;
  assert.equal(E.recruit(s, 0, 'leopard', base.id), true);
  assert.equal(s.sides[0].credits, recruitmentCredits - E.GROUND_UNITS.leopard.cost);
  base.armyQueue[0].progress = 1;
  E.step(s, 0.05);
  const tank = s.groundUnits.find((u) => u.key === 'leopard' && u.side === 0),
    target = E.makeGround(s, 1, 'leopard', -1092, 250);
  assert.ok(tank, 'the ordinarily paid production queue must produce the tank');
  Object.assign(tank, {
    x: -1192,
    z: 250,
    path: [],
    order: null,
    guard: null,
    autoDefense: false,
    nextThink: 0,
    enemyId: null, // Reset the spawn-position scan when positioning this isolated duel.
  });
  target.holdFire = true;
  s.groundUnits.push(target);
  const credits = s.sides[0].credits,
    hp = target.hp,
    rounds = tank.groundAmmo,
    reserve = tank.ammoReserve,
    materials = s.sides[0].materials,
    income = E.economy(s, 0).net;
  E.step(s, 0.05);
  const p = s.projectiles.find((p) => p.source === tank.id && p.domain === 'ground');
  assert.ok(p, 'tank must emit a real projectile, not only a muzzle event');
  assert.equal(p.kind, 'shell');
  assert.ok(p.loft >= 0.7 && p.loft <= 10);
  assert.equal(tank.groundAmmo, rounds - 1);
  assert.equal(tank.ammoReserve, reserve);
  assert.equal(s.sides[0].materials, materials);
  assert.ok(Math.abs(s.sides[0].credits - (credits + income * 0.05)) < 1e-8);
  const untilMid = Math.max(0, p.flight * 0.5 - p.life);
  moveProjectiles(s, untilMid);
  const k = p.life / p.flight,
    linear = p.originY * (1 - k) + p.endY * k;
  assert.ok(p.y > linear + 0.5);
  moveProjectiles(s, p.flight);
  assert.equal(p.dead, true);
  assert.equal(p.y, p.endY);
  assert.ok(target.hp < hp);
  assert.ok(s.events.some((e) => e.type === 'impact' && e.key === 'tank'));
});

test('persistent cosmetic scars are deterministic, ignore bullets/water, and bound history', () => {
  const s = E.createGame(89);
  s.groundScars = [];
  for (let i = 1; i <= 300; i++)
    recordGroundScar(s, {
      id: i,
      type: 'impact',
      key: i % 2 ? 'drone' : 'tank',
      side: 0,
      x: -792,
      z: 250,
      time: 0,
      radius: 12,
    });
  assert.equal(s.groundScars.length, GROUND_SCARS.capacity);
  assert.equal(s.groundScars[0].id, 205);
  assert.ok(s.groundScars.every((scar) => scar.radius >= 0.8 && scar.radius <= 12));
  const before = structuredClone(s.groundScars);
  for (const e of [
    { key: 'infantry', x: -792, z: 250 },
    { key: 'drone', x: 0, z: 0 },
  ])
    recordGroundScar(s, { id: 999, type: 'impact', side: 0, time: 0, ...e });
  recordGroundScar(s, { id: 300, type: 'impact', key: 'tank', side: 0, x: -792, z: 250, time: 0 });
  assert.deepEqual(s.groundScars, before);
  const copy = structuredClone(s);
  restoreGroundScars(copy, 15);
  assert.deepEqual(copy.groundScars, before);
  for (const mutate of [
    (scar) => (scar.radius = 100),
    (scar) => (scar.time = 1),
    (scar) => (scar.side = 9),
    (scar) => (scar.kind = '__proto__'),
  ]) {
    const bad = structuredClone(s);
    mutate(bad.groundScars[0]);
    assert.throws(() => restoreGroundScars(bad, 15));
  }
  restoreGroundScars(copy, 14);
  assert.deepEqual(copy.groundScars, []);
});

test('real drone impacts and shot-down ground crashes both leave bounded cosmetic scars', () => {
  const s = E.createGame(1);
  const aircraft = (changes = {}) => ({
    id: s.nextId++,
    side: 0,
    key: 'drone',
    x: -792,
    z: 250,
    y: 30,
    hp: 10,
    maxHp: 10,
    status: 'flying',
    delay: 0,
    launched: true,
    travelled: 100,
    total: 100,
    tx: -792,
    tz: 250,
    vx: 10,
    vy: 0,
    vz: 0,
    ...changes,
  });
  const incoming = aircraft();
  s.units.push(incoming);
  impacts(s);
  assert.equal(incoming.hp, 0);
  assert.equal(s.groundScars.length, 1);
  const falling = aircraft({ travelled: 0, total: 200 });
  s.units.push(falling);
  damageAircraft(s, falling, 20, 1);
  assert.equal(falling.status, 'falling');
  for (let i = 0; i < 100 && falling.status === 'falling'; i++) moveUnits(s, 0.1);
  assert.equal(falling.status, 'crashed');
  assert.equal(s.groundScars.length, 2);
  assert.ok(s.groundScars.every((scar) => scar.kind === 'drone' && scar.radius < 3));
  assert.ok(s.events.some((e) => e.type === 'crash'));
});

test('crater batch reuses one mesh, fades old and overflow scars, and hides after expiry', () => {
  const scene = new Scene(),
    batch = new GroundScarBatch(scene);
  const scars = Array.from({ length: 96 }, (_, id) => ({
    id: id + 1,
    x: 100,
    z: 100,
    time: 0,
    radius: 2,
  }));
  const mesh = batch.mesh,
    geometry = mesh.geometry,
    material = mesh.material;
  batch.update(scars, 0, () => 3);
  assert.equal(mesh.count, 96);
  assert.equal(scene.children.length, 1);
  assert.ok(batch.alpha.getX(0) < batch.alpha.getX(12));
  batch.update(scars, GROUND_SCARS.life - 60, () => 3);
  assert.ok(batch.alpha.getX(12) < 0.5);
  batch.update(scars, GROUND_SCARS.life + 1, () => 3);
  assert.equal(mesh.visible, false);
  assert.equal(batch.mesh.geometry, geometry);
  assert.equal(batch.mesh.material, material);
});

test('repeated drone crashes keep a bounded long-lived small smoke pool without per-impact scene objects', () => {
  const scene = new Scene(),
    camera = new PerspectiveCamera();
  camera.position.set(-792, 100, 250);
  camera.updateMatrixWorld();
  const fx = new CombatEffects({ scene, camera, height: () => 0 });
  const objects = scene.children.length,
    geometry = fx.scars.mesh.geometry;
  for (let i = 0; i < 100; i++)
    fx.handle({ id: i, type: i % 2 ? 'crash' : 'impact', key: 'drone', x: -792, z: 250, y: 2 });
  assert.equal(scene.children.length, objects);
  assert.equal(fx.wrecks.length, 40);
  assert.ok(fx.wrecks.every((w) => w.smolder && w.life === 45));
  const state = E.createGame(89);
  state.units = [];
  state.groundUnits = [];
  for (let i = 0; i < 20; i++) {
    fx.emit(state, 1);
    fx.update(1, i, camera);
  }
  assert.equal(
    fx.wrecks.length,
    40,
    'small drone smoke outlives the old 14s building wreck duration',
  );
  assert.ok(fx.smoke.slots.some((p) => p.life > 0));
  assert.equal(fx.scars.mesh.geometry, geometry);
  assert.equal(fx.lights.length, 3);
  assert.equal(scene.children.length, objects);
});

test('distant blasts admit fewer particles and do not consume the shared close-range lights', () => {
  const make = (x) => {
    const scene = new Scene(),
      camera = new PerspectiveCamera();
    camera.position.set(x, 100, 250);
    camera.updateMatrixWorld();
    return new CombatEffects({ scene, camera, height: () => 0 });
  };
  const near = make(-600),
    far = make(2000);
  near.explode(-792, 2, 250, 1);
  far.explode(-792, 2, 250, 1);
  const particles = (fx) =>
    fx.smoke.slots.filter((p) => p.life > 0).length +
    fx.glow.slots.filter((p) => p.life > 0).length;
  assert.ok(particles(far) < particles(near) * 0.6);
  assert.ok(near.lights.some((light) => light.userData.life > 0));
  assert.ok(far.lights.every((light) => light.userData.life === 0));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { impactGround } from '../../src/game/units/ground/combat.js';
import {
  groundEngagement,
  groundEngagementMetrics,
  groundWeaponProfile,
  prepareGroundEngagement,
  ENGAGEMENT_LOS_BUDGET,
} from '../../src/game/units/ground/engagement.js';

function fresh() {
  const s = E.createGame(831);
  s.mode = 'multiplayer';
  for (const f of s.sides) {
    f.credits = 1e6;
    f.materials = 1e6;
    f.tech = Object.keys(E.TECH);
  }
  return s;
}
function unit(s, side, key, x, z = 250) {
  const u = E.makeGround(s, side, key, x, z);
  s.groundUnits.push(u);
  return u;
}
function wall(s, x, z = 250) {
  const b = { id: s.nextId++, key: 'radar', side: 1, x, z, hp: 300, maxHp: 300, progress: 1 };
  s.buildings.push(b);
  s.networkRevision++;
  return b;
}
function round(shooter, victim, changes = {}) {
  return {
    source: shooter.id,
    side: shooter.side,
    shooterKey: shooter.key,
    targetId: victim.id,
    kind: 'bullet',
    damage: 10,
    suppression: 0.1,
    tx: victim.x,
    tz: victim.z,
    px: shooter.x,
    pz: shooter.z,
    originX: shooter.x,
    originZ: shooter.z,
    ...changes,
  };
}

test('an explicit building attack beats a nearby distracting soldier in a real firing tick', () => {
  const s = fresh(),
    tank = unit(s, 0, 'leopard', -450);
  const target = E.build(s, 1, 'launcher', -300, 250);
  assert.notEqual(typeof target, 'string', target);
  target.progress = 1;
  target.hp = target.maxHp;
  const distraction = unit(s, 1, 'infantry', -410);
  distraction.holdFire = true;
  assert.equal(
    E.orderGround(s, 0, [tank.id], {
      x: target.x,
      z: target.z,
      targetId: target.id,
      mode: 'attack',
    }),
    1,
  );
  E.step(s, 0.05);
  assert.equal(tank.enemyId, target.id);
  assert.equal(s.projectiles.find((p) => p.source === tank.id).targetId, target.id);
});

test('an ordinary rifle round damages one physical victim rather than every soldier in a small explosion', () => {
  const s = fresh(),
    shooter = unit(s, 0, 'infantry', -450);
  const a = unit(s, 1, 'infantry', -400),
    b = unit(s, 1, 'infantry', -400, 251);
  impactGround(s, round(shooter, a));
  assert.ok(a.hp < a.maxHp);
  assert.equal(b.hp, b.maxHp);
  assert.ok(b.suppression > 0, 'near misses may suppress without inflicting area bullet damage');
});

test('the original firing line blocks both damage and suppression even after a round has flown beyond a wall', () => {
  const s = fresh(),
    shooter = unit(s, 0, 'infantry', -450);
  const victim = unit(s, 1, 'infantry', -390);
  wall(s, -420);
  impactGround(s, round(shooter, victim, { px: -395, pz: victim.z }));
  assert.equal(victim.hp, victim.maxHp);
  assert.equal(victim.suppression, 0);
});

test('tank shells retain actual splash while rifle and anti-tank warheads have different armour effects', () => {
  const s = fresh(),
    tank = unit(s, 0, 'leopard', -450);
  const a = unit(s, 1, 'infantry', -400),
    b = unit(s, 1, 'infantry', -400, 258);
  impactGround(s, round(tank, a, { kind: 'shell', damage: 20 }));
  assert.ok(a.hp < a.maxHp && b.hp < b.maxHp);
  function damage(key, targetKey) {
    const s = fresh(),
      u = unit(s, 0, key, -450),
      v = unit(s, 1, targetKey, -400);
    impactGround(s, round(u, v, { damage: 20, kind: groundWeaponProfile(key).kind }));
    return v.maxHp - v.hp;
  }
  assert.ok(damage('infantry', 'apc') > damage('infantry', 'leopard') * 8);
  assert.ok(damage('atgm', 'leopard') > damage('infantry', 'leopard') * 30);
  assert.ok(damage('atgm', 'infantry') < damage('infantry', 'infantry') * 0.1);
});

test('cached targets that leave range cannot freeze an attackmove unit until its next scan', () => {
  const s = fresh(),
    u = unit(s, 0, 'infantry', -450),
    foe = unit(s, 1, 'infantry', -400);
  foe.holdFire = true;
  assert.equal(E.orderGround(s, 0, [u.id], { x: -250, z: 250, mode: 'attackmove' }), 1);
  E.step(s, 0.05);
  assert.equal(u.enemyId, foe.id);
  const before = u.x;
  foe.x = 400;
  E.step(s, 0.05);
  assert.ok(u.x > before, 'out-of-range cached enemy must not halt movement');
});

test('real rifle shots lead a moving infantry target rather than always hitting its old position', () => {
  const s = fresh(),
    u = unit(s, 0, 'infantry', -450),
    foe = unit(s, 1, 'infantry', -370);
  foe.holdFire = true;
  assert.equal(E.orderGround(s, 1, [foe.id], { x: -370, z: 400 }), 1);
  E.advance(s, 2.5);
  assert.ok(foe.z > 280);
  assert.ok(foe.hp < foe.maxHp, 'the ordinary simulation must resolve actual moving-target hits');
  assert.ok(s.events.filter((e) => e.type === 'shot' && e.buildingId === u.id).length >= 3);
});

test('target scans are cadenced, indexed once and bounded before visibility/LoS work', () => {
  const s = fresh(),
    u = unit(s, 0, 'infantry', -450);
  for (let i = 0; i < 40; i++) unit(s, 1, 'infantry', -390 + i * 0.5, 250 + i * 0.2);
  assert.ok(groundEngagement(s, u).target);
  const first = groundEngagementMetrics(s);
  assert.equal(first.indexBuilds, 1);
  assert.equal(first.searches, 1);
  assert.ok(first.lineTests <= ENGAGEMENT_LOS_BUDGET);
  assert.ok(first.visibilityTests <= ENGAGEMENT_LOS_BUDGET);
  for (let i = 0; i < 20; i++) groundEngagement(s, u);
  const cached = groundEngagementMetrics(s);
  assert.equal(cached.indexBuilds, 1);
  assert.equal(cached.searches, 1);
  assert.equal(cached.lineTests, first.lineTests);
  const distant = fresh(),
    lone = unit(distant, 0, 'infantry', -700, 450);
  for (let i = 0; i < 80; i++) unit(distant, 1, 'infantry', 450 + i, -350);
  groundEngagement(distant, lone);
  assert.equal(groundEngagementMetrics(distant).visibilityTests, 0);
  assert.equal(groundEngagementMetrics(distant).lineTests, 0);
});

test('the LoS budget cannot permanently starve the ninth visible target behind eight blocked priorities', () => {
  const s = fresh(),
    u = unit(s, 0, 'atgm', -600, 400);
  for (let i = 0; i < 8; i++) unit(s, 1, 'apc', -470, 397 + i);
  wall(s, -530, 400);
  const visible = unit(s, 1, 'infantry', -570, 450);
  let selected = null;
  for (let i = 0; i < 10 && selected?.id !== visible.id; i++) {
    s.time = i * 0.4;
    selected = groundEngagement(s, u).target;
  }
  assert.equal(selected?.id, visible.id);
});

test('a real 132-unit battle shares one index per tick and amortizes visibility and line checks', () => {
  const s = fresh();
  const keys = ['infantry', 'machinegunner', 'atgm', 'apc', 'leopard', 'tankdestroyer'];
  for (let side = 0; side < 2; side++)
    for (let i = 0; i < 66; i++) {
      const u = unit(
        s,
        side,
        keys[i % keys.length],
        (side ? -370 : -470) + (i % 11) * 3,
        250 + Math.floor(i / 11) * 5,
      );
      u.hp = u.maxHp = 1e6;
    }
  for (let i = 0; i < 40; i++) E.step(s, 0.05);
  const metrics = groundEngagementMetrics(s);
  assert.equal(s.groundUnits.length, 132);
  assert.equal(metrics.indexBuilds, 40);
  assert.ok(
    metrics.searches < (132 * 40) / 2,
    'cadence must avoid scanning every unit on every tick',
  );
  assert.ok(
    metrics.lineTests < (132 * 40) / 2,
    'cached LoS must avoid testing all nearby pairs every frame',
  );
  assert.ok(metrics.visibilityTests < (132 * 40) / 2);
});

test('a peaceful city does not build a ground target index, while a legacy static gun still does', () => {
  const s = fresh();
  for (let i = 0; i < 40; i++) E.step(s, 0.05);
  assert.equal(groundEngagementMetrics(s).indexBuilds, 0);
  const gun = {
    id: s.nextId++,
    key: 'gun',
    side: 0,
    x: -450,
    z: 250,
    hp: 100,
    maxHp: 100,
    progress: 1,
  };
  s.buildings.push(gun);
  const target = wall(s, -370);
  const cache = prepareGroundEngagement(s);
  assert.equal(cache.ids.get(gun.id), gun);
  assert.equal(cache.ids.get(target.id), target);
  assert.equal(groundEngagementMetrics(s).indexBuilds, 1);
});

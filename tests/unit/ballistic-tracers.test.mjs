import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { moveProjectiles } from '../../src/game/combat/projectiles.js';
import { projectileTrailPoint } from '../../src/rendering/effects/projectile-trail.js';
import { Scene, PerspectiveCamera } from '../../vendor/three/three.module.js';
import { CombatEffects } from '../../src/rendering/effects/combat-effects.js';

function round(changes = {}) {
  return {
    id: 9999,
    side: 0,
    domain: 'ground',
    kind: 'bullet',
    tracer: true,
    x: -500,
    y: 2.6,
    z: 400,
    vx: 100,
    vy: 17.7,
    vz: 0,
    gravity: 18,
    originY: 2.6,
    life: 0,
    flight: 2,
    tx: -300,
    tz: 400,
    damage: 0,
    ...changes,
  };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('a bullet drops under gravity, reaches the intended height, and its tracer reconstructs the actual path', () => {
  const s = E.createGame(6),
    p = round();
  s.projectiles = [p];
  moveProjectiles(s, 0.7);
  const previous = { x: p.x, y: p.y, z: p.z };
  assert.ok(p.y > 2.6);
  moveProjectiles(s, 0.3);
  const tail = projectileTrailPoint(p, 0.3, {});
  for (const axis of ['x', 'y', 'z']) close(tail[axis], previous[axis]);
  moveProjectiles(s, 1.4); // final partial step must stop exactly at impact, not below the ground
  close(p.y, 2);
  close(p.x, p.tx);
  assert.equal(p.dead, true);
});

test('artillery trails reconstruct the lob rather than extrapolating a straight line behind the shell', () => {
  const s = E.createGame(7),
    p = round({ kind: 'shell', arc: 80, originY: 6, y: 6, vy: 158, gravity: undefined });
  s.projectiles = [p];
  moveProjectiles(s, 0.65);
  const previous = { x: p.x, y: p.y, z: p.z };
  moveProjectiles(s, 0.4);
  const tail = projectileTrailPoint(p, 0.4, {});
  for (const axis of ['x', 'y', 'z']) close(tail[axis], previous[axis]);
  assert.ok(tail.y < p.y);
});

test('real ground fire launches a compensated arc without changing its destination or impact timing', () => {
  const s = E.createGame(831);
  s.mode = 'multiplayer';
  s.sides[0].credits = 1e5;
  const a = E.makeGround(s, 0, 'machinegunner', -450, 250),
    b = E.makeGround(s, 1, 'infantry', -360, 250);
  b.holdFire = true;
  s.groundUnits.push(a, b);
  E.step(s, 0.05);
  const p = s.projectiles.find((p) => p.source === a.id);
  assert.ok(p);
  assert.equal(p.gravity, 18);
  assert.equal(p.originY, 2.6);
  close(
    p.originY + (p.vy + p.gravity * p.life) * p.flight - 0.5 * p.gravity * p.flight * p.flight,
    2,
  );
  assert.ok(Math.hypot(p.tx - b.x, p.tz - b.z) < 10);
});

test('tracer ribbons and hot cores reuse bounded shared GPU buffers through repeated volleys', () => {
  const scene = new Scene(),
    camera = new PerspectiveCamera(45, 1, 2, 5000);
  camera.position.set(-500, 100, 500);
  camera.updateMatrixWorld();
  const fx = new CombatEffects({ scene, camera }),
    p = round({ life: 1, x: -400, y: 11.3, vy: -0.3 });
  const buffers = [
    fx.streaks.mesh.geometry,
    fx.streaks.mesh.material,
    fx.tracePositions,
    fx.streaks.mesh.instanceMatrix.array,
  ];
  for (let i = 0; i < 50; i++) {
    fx.updateTracers([p]);
    fx.update(0.01, i * 0.01, camera);
    assert.equal(fx.tracerHeads, 1);
    assert.equal(fx.streaks.mesh.count, 6);
  }
  assert.deepEqual(
    [
      fx.streaks.mesh.geometry,
      fx.streaks.mesh.material,
      fx.tracePositions,
      fx.streaks.mesh.instanceMatrix.array,
    ],
    buffers,
  );
  assert.ok(fx.streaks.mesh.count <= fx.streaks.capacity);
});

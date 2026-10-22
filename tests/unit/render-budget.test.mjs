import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPixelRatio, RenderBudget } from '../../src/rendering/performance/render-budget.js';
import { aircraftAttitude } from '../../src/rendering/models/aircraft-motion.js';
import { flightRoute } from '../../src/game/units/aviation/routes.js';

test('physical render pixels stay bounded on 4K and high DPI; regular viewport remains native', () => {
  for (const [w, h, dpr] of [
    [3840, 2160, 2],
    [2560, 1440, 2],
    [1920, 1080, 2],
    [1280, 720, 2],
  ]) {
    const ratio = renderPixelRatio(w, h, dpr);
    assert.ok(w * h * ratio ** 2 <= 1920 * 1080 + 1);
    assert.ok(ratio <= dpr);
  }
  assert.equal(renderPixelRatio(1280, 720, 1), 1);
});
test('render budget has warmup, hysteresis, bounded reduction and recovery', () => {
  const b = new RenderBudget();
  assert.equal(b.observe(2), false);
  for (let i = 0; i < 50; i++) b.observe(0.04);
  assert.equal(b.scale, 1);
  for (let i = 0; i < 1000; i++) b.observe(0.04);
  assert.equal(b.scale, 0.75);
  for (let i = 0; i < 300; i++) b.observe(0.016);
  assert.equal(b.scale, 0.75);
  for (let i = 0; i < 3000; i++) b.observe(0.016);
  assert.equal(b.scale, 1);
});
test('sustained very slow frames still adapt while a restored-tab pause is ignored', () => {
  const b = new RenderBudget();
  for (let i = 0; i < 5; i++) b.observe(20);
  assert.equal(b.scale, 1);
  for (let i = 0; i < 80; i++) b.observe(0.4);
  assert.equal(b.scale, 0.75);
});
test('aircraft nose follows cardinal and diagonal velocity even when final target lies elsewhere', () => {
  for (const [vx, vz] of [
    [90, 0],
    [-90, 0],
    [0, 90],
    [0, -90],
    [60, 60],
    [-60, 60],
  ]) {
    const a = aircraftAttitude({ x: 0, z: 0, tx: 900, tz: 900, vx, vz, vy: 0 });
    assert.ok(Math.abs(Math.sin(a.yaw) - vx / Math.hypot(vx, vz)) < 1e-9);
    assert.ok(Math.abs(Math.cos(a.yaw) - vz / Math.hypot(vx, vz)) < 1e-9);
    assert.ok(Math.abs(a.pitch) < 1e-9);
  }
});
test('stationary launch preview follows first route leg, falling aircraft keeps velocity heading', () => {
  const route = flightRoute(
    { x: -600, z: 0 },
    {
      x: 600,
      z: 0,
      waypoints: [
        { x: -600, z: 400 },
        { x: 600, z: 400 },
      ],
    },
    'light',
  );
  assert.equal(aircraftAttitude({ x: -600, z: 0, tx: 600, tz: 0, route, travelled: 0 }).yaw, 0);
  const falling = aircraftAttitude({
    x: 0,
    z: 0,
    tx: 600,
    tz: 600,
    vx: -40,
    vz: 0,
    vy: -35,
    status: 'falling',
  });
  assert.equal(falling.yaw, -Math.PI / 2);
  assert.ok(falling.pitch > 0);
});

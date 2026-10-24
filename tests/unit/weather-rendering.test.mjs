import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from '../../vendor/three/three.module.js';
import { WeatherFX } from '../../src/rendering/effects/weather-fx.js';
import {
  RAIN,
  rainSeeds,
  rainWind,
  weatherStyle,
} from '../../src/rendering/effects/weather-style.js';

test('light rain is distributed across the field instead of selecting one side of the volume', () => {
  const seeds = rainSeeds(),
    quadrants = [0, 0, 0, 0];
  for (let i = 0; i < RAIN.count; i++) {
    if (seeds[i * 4 + 3] >= weatherStyle({ kind: 'rain', amount: 1 }).rain) continue;
    quadrants[(seeds[i * 4] > 0.5 ? 1 : 0) + (seeds[i * 4 + 2] > 0.5 ? 2 : 0)]++;
  }
  for (const n of quadrants) assert.ok(n > 160 && n < 260, JSON.stringify(quadrants));
  assert.equal(weatherStyle({ kind: 'fog', amount: 1 }).rain, 0);
  assert.ok(weatherStyle({ kind: 'storm', amount: 1 }).rain < 0.5);
});

test('wind stays close to vertical even in a long storm and cannot accelerate with session age', () => {
  const scene = new Scene(),
    fx = new WeatherFX(scene),
    target = new Vector3();
  fx.time = 100000;
  for (let i = 0; i < 60; i++) {
    const wind = rainWind(fx.time, 6);
    assert.ok(Math.atan2(Math.hypot(wind.x, wind.z), RAIN.minSpeed) < Math.PI / 36);
    const before = fx.uniforms.drift.value.clone();
    fx.update(0.05, target, { kind: 'storm', amount: 1 });
    assert.ok(fx.uniforms.drift.value.distanceTo(before) <= 0.4);
  }
  assert.equal(scene.children.length, 1);
  assert.equal(fx.rain.geometry.attributes.aDensity.count, RAIN.count * 2);
});

test('pausing freezes rain, wind drift and lightning while the camera can recenter the volume', () => {
  const fx = new WeatherFX(new Scene()),
    target = new Vector3(300, 0, 200);
  fx.update(2, target, { kind: 'rain', amount: 1 });
  fx.lightning();
  const before = {
    time: fx.time,
    amount: fx.amount,
    drift: fx.uniforms.drift.value.toArray(),
    flash: fx.flash,
  };
  target.set(-500, 0, -300);
  for (let i = 0; i < 20; i++) fx.update(0, target, { kind: 'storm', amount: 1 });
  assert.deepEqual(
    { time: fx.time, amount: fx.amount, drift: fx.uniforms.drift.value.toArray(), flash: fx.flash },
    before,
  );
  assert.deepEqual(fx.uniforms.center.value.toArray(), target.toArray());
});

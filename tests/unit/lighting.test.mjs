import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { RTSWorld } from '../../src/rendering/world.js';

function fixture(time = 1000) {
  const w = Object.create(RTSWorld.prototype);
  Object.assign(w, {
    state: { time },
    controls: { target: new T.Vector3(-615, 0, 0) },
    sun: new T.DirectionalLight(),
    sunDisc: new T.Object3D(),
    hemi: new T.HemisphereLight(),
    ambient: new T.AmbientLight(),
    sky: { material: { uniforms: { daylight: { value: 0 } } } },
    scene: new T.Scene(),
    renderer: { shadowMap: { needsUpdate: false } },
    sharedMaterials: new Set(),
  });
  w.scene.fog = new T.FogExp2();
  w.scene.background = new T.Color();
  return w;
}
const direction = (w) => w.sun.position.clone().sub(w.sun.target.position).normalize();

test('panning across the entire map moves shadow coverage without changing sunlight at a fixed time', () => {
  const w = fixture();
  w.updateDaylight();
  const reference = direction(w),
    color = w.sun.color.clone(),
    power = w.sun.intensity;
  for (const [x, z] of [
    [-795, -480],
    [795, 480],
    [615, 0],
    [-615, 0],
    [0, 0],
  ]) {
    w.controls.target.set(x, 0, z);
    w.updateDaylight();
    assert.ok(w.sun.target.position.distanceTo(w.controls.target) <= 24);
    assert.ok(
      direction(w).distanceTo(reference) < 1e-12,
      'camera movement changed sunlight direction',
    );
    assert.deepEqual(w.sun.color, color);
    assert.equal(w.sun.intensity, power);
  }
});

test('sun direction, colour and exposure remain continuous through sunrise, sunset and the midnight wrap', () => {
  const w = fixture(0);
  w.updateDaylight();
  let previous = direction(w),
    color = w.sun.color.clone(),
    exposure = w.renderer.toneMappingExposure;
  for (let i = 1; i <= 24000; i++) {
    w.state.time = i * 0.05;
    w.updateDaylight();
    const next = direction(w);
    assert.ok(next.distanceTo(previous) < 0.002, 'direction jumped at ' + w.state.time);
    assert.ok(
      Math.hypot(w.sun.color.r - color.r, w.sun.color.g - color.g, w.sun.color.b - color.b) < 0.005,
      'colour jumped at ' + w.state.time,
    );
    assert.ok(Math.abs(w.renderer.toneMappingExposure - exposure) < 0.001);
    previous = next;
    color.copy(w.sun.color);
    exposure = w.renderer.toneMappingExposure;
  }
});

test('a paused view reuses its shadow map while panning, time changes and imported time invalidate it', () => {
  const w = fixture();
  w.updateDaylight();
  w.renderer.shadowMap.needsUpdate = false;
  for (let i = 0; i < 120; i++) w.updateDaylight();
  assert.equal(w.renderer.shadowMap.needsUpdate, false);
  w.controls.target.x += 60;
  w.updateDaylight();
  assert.equal(w.renderer.shadowMap.needsUpdate, true);
  w.renderer.shadowMap.needsUpdate = false;
  w.state.time += 0.1;
  w.updateDaylight();
  assert.equal(w.renderer.shadowMap.needsUpdate, false);
  w.state.time += 0.2;
  w.updateDaylight();
  assert.equal(w.renderer.shadowMap.needsUpdate, true);
  w.renderer.shadowMap.needsUpdate = false;
  w.state.time = 20;
  w.updateDaylight();
  assert.equal(w.renderer.shadowMap.needsUpdate, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { FixedCamera, CAMERA } from '../../src/rendering/camera.js';
import { updateDaylight } from '../../src/rendering/lighting.js';
import { RTSWorld } from '../../src/rendering/world.js';
import { FIELD } from '../../src/game/map.js';

function fixture() {
  const camera = new T.PerspectiveCamera(45, 1, 2, 9000),
    controls = new FixedCamera(camera, { addEventListener() {} });
  controls.distance = controls.zoomDistance = 330;
  controls.update(0);
  const world = {
    state: { time: 1000 },
    controls,
    sun: new T.DirectionalLight(),
    sunDisc: new T.Object3D(),
    hemi: new T.HemisphereLight(),
    ambient: new T.AmbientLight(),
    sky: { material: { uniforms: { daylight: { value: 0 } } } },
    scene: new T.Scene(),
    renderer: { shadowMap: { needsUpdate: false } },
    sharedMaterials: new Set(),
  };
  world.scene.fog = new T.FogExp2();
  world.scene.background = new T.Color();
  return { world, controls, camera };
}

test('instant map focus moves once at the current zoom and leaves keyboard pan and camera angle intact', () => {
  const { world, controls, camera } = fixture(),
    yaw = controls.yaw,
    pitch = controls.pitch,
    orientation = camera.quaternion.clone();
  RTSWorld.prototype.focus.call(world, 1015, 450, undefined, { instant: true });
  assert.deepEqual(controls.target.toArray(), [1015, 0, 450]);
  assert.ok(controls.desired.equals(controls.target));
  assert.equal(controls.distance, 330);
  assert.equal(controls.zoomDistance, 330);
  assert.equal(controls.yaw, yaw);
  assert.equal(controls.pitch, pitch);
  assert.ok(camera.quaternion.angleTo(orientation) < 1e-7);
  assert.ok(
    camera.position.distanceTo(controls.target.clone().addScaledVector(controls.angle, 330)) < 1e-9,
  );
  const previous = controls.target.clone();
  controls.update(0.1, { KeyW: true });
  assert.ok(controls.desired.distanceTo(previous) > 1);
  assert.ok(controls.target.distanceTo(previous) > 1);
  assert.equal(controls.distance, 330);
  assert.equal(controls.yaw, yaw);
  assert.equal(controls.pitch, pitch);
});

test('instant focus clamps position and an explicit zoom while ordinary focus keeps easing and defaults', () => {
  const { controls } = fixture(),
    old = controls.target.clone();
  controls.focus(1015, 450);
  assert.ok(controls.target.equals(old), 'ordinary focus is still eased');
  assert.equal(controls.zoomDistance, CAMERA.max);
  controls.focus(10000, -10000, 10000, { instant: true });
  assert.deepEqual(controls.target.toArray(), [FIELD.x - 60, 0, -(FIELD.z - 60)]);
  assert.equal(controls.distance, CAMERA.max);
  controls.focus(0, 0, 0, { instant: true });
  assert.equal(controls.distance, CAMERA.min);
});

test('a paused instant map jump requests one shadow coverage update instead of many easing updates', () => {
  const measure = (instant) => {
    const { world, controls } = fixture();
    updateDaylight.call(world);
    const direction = world.sun.position.clone().sub(world.sun.target.position).normalize();
    world.renderer.shadowMap.needsUpdate = false;
    controls.focus(1015, 450, 330, { instant });
    let refreshes = 0;
    for (let i = 0; i < 60; i++) {
      controls.update(1 / 60);
      updateDaylight.call(world);
      if (world.renderer.shadowMap.needsUpdate) {
        refreshes++;
        world.renderer.shadowMap.needsUpdate = false;
      }
      const next = world.sun.position.clone().sub(world.sun.target.position).normalize();
      assert.ok(next.distanceTo(direction) < 1e-12, 'focus must not change sunlight direction');
    }
    return refreshes;
  };
  assert.ok(measure(false) > 10, 'the reference jump crosses multiple shadow focus cells');
  assert.equal(measure(true), 1);
});

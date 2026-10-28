import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { RTSWorld } from '../../src/rendering/world.js';
import { renderPixelRatio } from '../../src/rendering/performance/render-budget.js';
import { EveningPost } from '../../src/rendering/effects/post-processing.js';
import { bindShadowRestore } from '../../src/rendering/performance/context-recovery.js';

function fixture() {
  const calls = [],
    size = new T.Vector2(1280, 720),
    canvas = { width: 1280, height: 720, style: { width: '1280px', height: '720px' } };
  let pixelRatio = 1;
  const renderer = {
    domElement: canvas,
    getSize: (out) => out.copy(size),
    getPixelRatio: () => pixelRatio,
    getDrawingBufferSize: (out) => out.set(canvas.width, canvas.height),
    setPixelRatio() {
      throw new Error('setPixelRatio performs an extra canvas resize');
    },
    setSize() {
      throw new Error('setSize must not duplicate the drawing-buffer resize');
    },
    setDrawingBufferSize(width, height, ratio) {
      calls.push(['canvas', width, height, ratio]);
      size.set(width, height);
      pixelRatio = ratio;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      this.viewport = [0, 0, width, height];
    },
  };
  const world = {
    host: { clientWidth: 1280, clientHeight: 720 },
    renderBudget: { scale: 1 },
    renderer,
    post: {
      renderScale: 1,
      resize(...args) {
        calls.push(['post', ...args]);
        this.renderScale = args[2];
      },
    },
  };
  return { world, calls, canvas };
}

test('unchanged resize notifications never reset the drawing buffer or post attachments', () => {
  const oldDpr = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 1;
  try {
    const f = fixture();
    for (let i = 0; i < 100; i++) RTSWorld.prototype.resizeRender.call(f.world);
    assert.deepEqual(f.calls, []);
    assert.equal(f.canvas.width, 1280);
    assert.equal(f.canvas.height, 720);
    f.world.host.clientWidth = 0;
    RTSWorld.prototype.resizeRender.call(f.world);
    assert.deepEqual(f.calls, [], 'hidden zero-width hosts do not reset the canvas');
  } finally {
    if (oldDpr === undefined) delete globalThis.devicePixelRatio;
    else globalThis.devicePixelRatio = oldDpr;
  }
});

test('host and base DPR changes reset the bounded canvas once and preserve CSS dimensions', () => {
  const oldDpr = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 1;
  try {
    const f = fixture();
    for (const [width, height, dpr, scale] of [
      [1280, 720, 2, 0.9],
      [1024, 600, 2, 0.9],
      [2560, 1440, 2, 1],
      [1280, 720, 1, 1],
    ]) {
      f.calls.length = 0;
      f.world.host.clientWidth = width;
      f.world.host.clientHeight = height;
      f.world.renderBudget.scale = scale;
      globalThis.devicePixelRatio = dpr;
      RTSWorld.prototype.resizeRender.call(f.world);
      const ratio = renderPixelRatio(width, height, dpr);
      assert.deepEqual(f.calls, [
        ['canvas', width, height, ratio],
        ['post', width, height, scale],
      ]);
      assert.equal(f.canvas.width, Math.floor(width * ratio));
      assert.equal(f.canvas.height, Math.floor(height * ratio));
      assert.equal(f.canvas.style.width, width + 'px');
      assert.equal(f.canvas.style.height, height + 'px');
      assert.deepEqual(f.world.renderer.viewport, [0, 0, width, height]);
      f.calls.length = 0;
      RTSWorld.prototype.resizeRender.call(f.world);
      assert.deepEqual(f.calls, []);
    }
  } finally {
    if (oldDpr === undefined) delete globalThis.devicePixelRatio;
    else globalThis.devicePixelRatio = oldDpr;
  }
});

test('adaptive scale changes only internal targets, preserving exact old 3D/bloom resolution and picking', () => {
  const oldDpr = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 1;
  try {
    const f = fixture();
    f.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 });
    f.world.post = new EveningPost(f.world.renderer);
    f.world.post.resize(1280, 720);
    f.world.pointer = new T.Vector2();
    f.world.ray = new T.Raycaster();
    f.world.plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    f.world.camera = new T.PerspectiveCamera(45, 1280 / 720, 1, 1000);
    f.world.camera.position.set(0, 100, 100);
    f.world.camera.lookAt(0, 0, 0);
    f.world.camera.updateMatrixWorld();
    const point = RTSWorld.prototype.groundPoint.call(f.world, { clientX: 800, clientY: 400 });
    const originalStyle = { ...f.canvas.style };
    for (const scale of [0.9, 0.8, 0.75, 0.8, 0.9, 0.95, 1]) {
      f.world.renderBudget.scale = scale;
      RTSWorld.prototype.resizeRender.call(f.world);
      const ratio = renderPixelRatio(1280, 720, 1, scale),
        width = Math.floor(1280 * ratio),
        height = Math.floor(720 * ratio);
      assert.equal(f.world.post.target.width, width);
      assert.equal(f.world.post.target.height, height);
      assert.equal(f.world.post.bloom.width, Math.ceil(width / 2));
      assert.equal(f.world.post.bloom.height, Math.ceil(height / 2));
      assert.equal(f.world.post.scenePixelRatio, ratio);
      assert.deepEqual(f.world.post.uniforms.pixel.value.toArray(), [1 / width, 1 / height]);
      assert.deepEqual(f.world.post.uniforms.grainPixelScale.value.toArray(), [
        width / 1280,
        height / 720,
      ]);
      assert.equal(f.canvas.width, 1280);
      assert.equal(f.canvas.height, 720);
      assert.deepEqual(f.canvas.style, originalStyle);
      const actual = RTSWorld.prototype.groundPoint.call(f.world, { clientX: 800, clientY: 400 });
      assert.ok(
        actual.distanceTo(point) < 1e-9,
        'CSS ray picking cannot depend on adaptive framebuffer size',
      );
      RTSWorld.prototype.resizeRender.call(f.world);
    }
    assert.deepEqual(
      f.calls,
      [],
      'no adaptive transition or repeated notification writes the canvas',
    );
  } finally {
    if (oldDpr === undefined) delete globalThis.devicePixelRatio;
    else globalThis.devicePixelRatio = oldDpr;
  }
});

test('context restoration invalidates the new shadow map even when paused and preserves render policy', () => {
  const canvas = new EventTarget(),
    sun = new T.DirectionalLight(),
    oldMap = { needsUpdate: false },
    restoredMap = {
      needsUpdate: false,
      autoUpdate: false,
      enabled: true,
      type: T.PCFSoftShadowMap,
    },
    renderer = { domElement: canvas, shadowMap: oldMap };
  sun.castShadow = true;
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = false;
  // Three installs this listener before the world binds its recovery hook.
  canvas.addEventListener('webglcontextrestored', () => {
    renderer.shadowMap = restoredMap;
  });
  const unbind = bindShadowRestore(renderer, [sun]),
    before = sun.shadow.mapSize.clone();
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(oldMap.needsUpdate, false);
  assert.equal(restoredMap.needsUpdate, true);
  assert.equal(sun.shadow.needsUpdate, true);
  assert.equal(restoredMap.autoUpdate, false);
  assert.equal(restoredMap.enabled, true);
  assert.equal(restoredMap.type, T.PCFSoftShadowMap);
  assert.equal(sun.shadow.autoUpdate, false);
  assert.deepEqual(sun.shadow.mapSize, before);
  unbind();
  restoredMap.needsUpdate = sun.shadow.needsUpdate = false;
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(restoredMap.needsUpdate, false);
  assert.equal(sun.shadow.needsUpdate, false);
});

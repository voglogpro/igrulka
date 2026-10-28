import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { RTSWorld } from '../../src/rendering/world.js';
import { renderPixelRatio } from '../../src/rendering/performance/render-budget.js';
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
    post: { resize: (...args) => calls.push(['post', ...args]) },
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

test('host, DPR and budget changes keep identical dimensions/styles with one resize each', () => {
  const oldDpr = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 1;
  try {
    const f = fixture();
    for (const [width, height, dpr, scale] of [
      [1280, 720, 1, 0.9],
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
      const ratio = renderPixelRatio(width, height, dpr, scale);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { warmSceneShaders } from '../../src/rendering/performance/shader-warmup.js';

function fixture(compile = () => Promise.resolve()) {
  const previous = { name: 'previous' },
    scene = { name: 'world' },
    camera = { name: 'camera' },
    post = {
      target: { name: 'world-target' },
      bloom: { name: 'bloom-target' },
      bloomScene: { name: 'bloom-scene' },
      scene: { name: 'post-scene' },
      camera: { name: 'post-camera' },
    },
    calls = [],
    canvas = new EventTarget();
  let target = previous;
  const renderer = {
    domElement: canvas,
    getRenderTarget: () => target,
    setRenderTarget: (value) => {
      target = value;
    },
    getContext: () => ({ isContextLost: () => false }),
    compileAsync: (compilingScene, compilingCamera) => {
      calls.push({ scene: compilingScene, camera: compilingCamera, target });
      return compile(compilingScene);
    },
  };
  return { previous, scene, camera, post, calls, canvas, renderer };
}

test('shader warmup starts three passes at their real targets and restores the previous target before awaiting', async () => {
  let complete;
  const pending = new Promise((resolve) => (complete = resolve)),
    f = fixture(() => pending),
    ready = warmSceneShaders(f.renderer, f.scene, f.camera, f.post);
  assert.equal(f.renderer.getRenderTarget(), f.previous);
  assert.deepEqual(f.calls, [
    { scene: f.scene, camera: f.camera, target: f.post.target },
    { scene: f.post.bloomScene, camera: f.post.camera, target: f.post.bloom },
    { scene: f.post.scene, camera: f.post.camera, target: null },
  ]);
  complete();
  assert.deepEqual(await ready, { status: 'ready' });
});

test('a rejected shader pass releases startup and still restores the render target', async () => {
  const f = fixture(() => Promise.reject(new Error('compilation rejected')));
  assert.deepEqual(await warmSceneShaders(f.renderer, f.scene, f.camera, f.post), {
    status: 'failed',
  });
  assert.equal(f.renderer.getRenderTarget(), f.previous);
});

test('a synchronous later shader failure cannot leave a target or an earlier rejected promise unhandled', async () => {
  const f = fixture((scene) => {
    if (scene.name === 'bloom-scene') throw new Error('context failed');
    return Promise.reject(new Error('earlier pass rejected'));
  });
  assert.deepEqual(await warmSceneShaders(f.renderer, f.scene, f.camera, f.post), {
    status: 'failed',
  });
  assert.equal(f.renderer.getRenderTarget(), f.previous);
  await new Promise((resolve) => setImmediate(resolve));
});

test('a shader that never finishes cannot keep startup waiting indefinitely', async () => {
  const f = fixture(() => new Promise(() => {}));
  assert.deepEqual(
    await warmSceneShaders(f.renderer, f.scene, f.camera, f.post, { timeoutMs: 5 }),
    { status: 'timeout' },
  );
  assert.equal(f.renderer.getRenderTarget(), f.previous);
});

test('context loss releases shader startup and does not wait for compiler promises', async () => {
  const f = fixture(() => new Promise(() => {})),
    ready = warmSceneShaders(f.renderer, f.scene, f.camera, f.post);
  f.canvas.dispatchEvent(new Event('webglcontextlost'));
  assert.deepEqual(await ready, { status: 'context-lost' });
  assert.equal(f.renderer.getRenderTarget(), f.previous);
});

test('an already lost context does not start shader jobs or change the previous target', async () => {
  const f = fixture();
  f.renderer.getContext = () => ({ isContextLost: () => true });
  assert.deepEqual(await warmSceneShaders(f.renderer, f.scene, f.camera, f.post), {
    status: 'context-lost',
  });
  assert.equal(f.calls.length, 0);
  assert.equal(f.renderer.getRenderTarget(), f.previous);
});

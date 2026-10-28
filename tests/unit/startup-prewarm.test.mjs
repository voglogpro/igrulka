import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import * as E from '../../src/game/index.js';
import { RTSWorld } from '../../src/rendering/world.js';
import {
  WarmupFamilies,
  warmupModelJobs,
} from '../../src/rendering/performance/warmup-families.js';
import { warmStartupScene } from '../../src/rendering/performance/startup-prewarm.js';
import { drawWarmupFrame } from '../../src/rendering/performance/warmup-draw.js';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const noNavigation = function* () {};

function fixture() {
  const scene = new T.Scene(),
    geometry = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial(),
    object = new T.InstancedMesh(geometry, material, 1),
    canvas = new EventTarget(),
    previous = new T.WebGLRenderTarget(8, 8),
    view = new T.Vector4(1, 2, 800, 600),
    scissor = new T.Vector4(3, 4, 500, 400),
    calls = [];
  object.count = 0;
  object.visible = false;
  object.castShadow = true;
  object.setColorAt(0, new T.Color('#668877'));
  scene.add(object);
  geometry.setDrawRange(6, 18);
  let target = previous,
    scissorTest = false;
  const renderer = {
    domElement: canvas,
    shadowMap: { needsUpdate: false },
    info: { programs: [] },
    getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => target,
    setRenderTarget: (value) => {
      target = value;
    },
    getViewport: (out) => out.copy(view),
    setViewport: (value) => view.copy(value),
    getScissor: (out) => out.copy(scissor),
    setScissor: (x, y, z, w) => (x?.isVector4 ? scissor.copy(x) : scissor.set(x, y, z, w)),
    getScissorTest: () => scissorTest,
    setScissorTest: (enabled) => (scissorTest = enabled),
    compileAsync: (compilingScene) => {
      calls.push({ phase: 'compile', scene: compilingScene, target });
      return Promise.resolve();
    },
  };
  const world = {
    scene,
    renderer,
    state: E.createGame(8121),
    controls: { target: new T.Vector3(-900, 0, 300) },
    camera: new T.PerspectiveCamera(),
    battleTime: 12,
    sharedGeometries: new Set([geometry]),
    sharedMaterials: new Set([material]),
    updateDaylight() {
      calls.push({ phase: 'daylight' });
    },
    post: {
      target: new T.WebGLRenderTarget(800, 600),
      bloom: new T.WebGLRenderTarget(400, 300),
      bloomScene: new T.Scene(),
      scene: new T.Scene(),
      camera: new T.OrthographicCamera(),
      render() {
        calls.push({ phase: 'draw' });
        renderer.shadowMap.needsUpdate = false;
        renderer.setRenderTarget(null);
      },
    },
  };
  return { world, scene, geometry, material, object, renderer, canvas, previous, calls };
}

function modelFixture() {
  let treeCuts = 0;
  const world = {
    scene: new T.Scene(),
    state: E.createGame(8121),
    controls: { target: new T.Vector3(-900, 0, 0) },
    facade: new T.Texture(),
    emission: new T.Texture(),
    glowTexture: new T.Texture(),
    boxGeo: new T.BoxGeometry(),
    cylGeo: new T.CylinderGeometry(1, 1, 1, 12),
    coneGeo: new T.ConeGeometry(1, 1, 8),
    sphereGeo: new T.IcosahedronGeometry(1, 1),
    materials: new Map(),
    sharedGeometries: new Set(),
    sharedMaterials: new Set(),
    height: () => 0,
    clearTrees: () => treeCuts++,
    mat: RTSWorld.prototype.mat,
    box: RTSWorld.prototype.box,
    cyl: RTSWorld.prototype.cyl,
    model: RTSWorld.prototype.model,
  };
  for (const geometry of [world.boxGeo, world.cylGeo, world.coneGeo, world.sphereGeo])
    world.sharedGeometries.add(geometry);
  return { world, treeCuts: () => treeCuts };
}

test('warm draw uploads the real far-tile buffers and restores culling/ranges/targets even on failure', () => {
  for (const fail of [false, true]) {
    const f = fixture(),
      instanceGeometry = new T.InstancedBufferGeometry(),
      pool = new T.Mesh(instanceGeometry, new T.ShaderMaterial()),
      originalScene = f.scene.children.slice(),
      original = f.geometry.attributes.position.array.slice(),
      state = E.save(f.world.state),
      oldView = f.renderer.getViewport(new T.Vector4()),
      oldScissor = f.renderer.getScissor(new T.Vector4());
    instanceGeometry.setAttribute(
      'position',
      new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    instanceGeometry.instanceCount = 0;
    instanceGeometry.setDrawRange(0, 0);
    pool.position.x = 3000;
    f.scene.add(pool);
    f.world.post.target.scissor.set(2, 3, 4, 5);
    const oldTargetScissor = f.world.post.target.scissor.clone();
    f.world.post.render = (scene, camera, time) => {
      assert.equal(scene, f.scene);
      assert.equal(camera, f.world.camera);
      assert.equal(time, 12);
      assert.equal(f.object.frustumCulled, false);
      assert.equal(
        pool.frustumCulled,
        false,
        'original far tile is drawn, not a substitute buffer',
      );
      assert.equal(instanceGeometry.instanceCount, 1, 'empty shader pool gets one upload');
      assert.deepEqual(f.geometry.drawRange, { start: 0, count: 3 });
      assert.deepEqual(f.world.post.target.scissor.toArray(), [0, 0, 1, 1]);
      assert.deepEqual(f.renderer.getScissor(new T.Vector4()).toArray(), [0, 0, 0, 0]);
      assert.equal(f.renderer.shadowMap.needsUpdate, true);
      if (fail) throw new Error('draw failed');
    };
    if (fail) assert.throws(() => drawWarmupFrame(f.world), /draw failed/);
    else drawWarmupFrame(f.world);
    assert.deepEqual(f.geometry.drawRange, { start: 6, count: 18 });
    assert.deepEqual(instanceGeometry.drawRange, { start: 0, count: 0 });
    assert.equal(instanceGeometry.instanceCount, 0);
    assert.equal(f.object.frustumCulled, true);
    assert.equal(pool.frustumCulled, true);
    assert.equal(f.object.visible, false);
    assert.equal(f.object.count, 0);
    assert.equal(f.renderer.getRenderTarget(), f.previous);
    assert.deepEqual(f.renderer.getViewport(new T.Vector4()), oldView);
    assert.deepEqual(f.renderer.getScissor(new T.Vector4()), oldScissor);
    assert.equal(f.renderer.getScissorTest(), false);
    assert.deepEqual(f.world.post.target.scissor, oldTargetScissor);
    assert.equal(f.world.post.target.scissorTest, false);
    assert.deepEqual(f.geometry.attributes.position.array, original);
    assert.deepEqual(f.scene.children, [...originalScene, pool]);
    assert.equal(E.save(f.world.state), state);
    assert.equal(f.renderer.shadowMap.needsUpdate, true, 'next real draw replaces staged shadows');
  }
});

test('full-scene priming keeps real geometry and complete offscreen pixels, restoring bounds on failure', () => {
  for (const outcome of ['ready', 'invalidated', 'failed']) {
    const f = fixture(),
      originalScissor = f.world.post.target.scissor.clone(),
      originalState = E.save(f.world.state),
      originalView = f.renderer.getViewport(new T.Vector4()),
      originalCanvasScissor = f.renderer.getScissor(new T.Vector4());
    f.world.post.target.scissorTest = true;
    f.world.post.render = () => {
      assert.equal(f.object.frustumCulled, true);
      assert.deepEqual(f.geometry.drawRange, { start: 6, count: 18 });
      assert.equal(f.object.count, 0);
      assert.equal(f.object.visible, false);
      assert.equal(f.world.post.target.scissorTest, false, 'full color/depth target is rasterized');
      assert.equal(f.world.post.bloom.scissorTest, false, 'full bloom target is rasterized');
      assert.deepEqual(f.renderer.getScissor(new T.Vector4()).toArray(), [0, 0, 0, 0]);
      assert.equal(f.renderer.getScissorTest(), true, 'only the default canvas is clipped');
      f.renderer.shadowMap.needsUpdate = outcome === 'invalidated';
      if (outcome === 'failed') throw new Error('full draw failed');
    };
    if (outcome === 'failed')
      assert.throws(() => drawWarmupFrame(f.world, { fullScene: true }), /full draw failed/);
    else drawWarmupFrame(f.world, { fullScene: true });
    assert.equal(f.renderer.shadowMap.needsUpdate, outcome !== 'ready');
    assert.equal(f.renderer.getRenderTarget(), f.previous);
    assert.deepEqual(f.renderer.getViewport(new T.Vector4()), originalView);
    assert.deepEqual(f.renderer.getScissor(new T.Vector4()), originalCanvasScissor);
    assert.equal(f.renderer.getScissorTest(), false);
    assert.deepEqual(f.world.post.target.scissor, originalScissor);
    assert.equal(f.world.post.target.scissorTest, true);
    assert.deepEqual(f.geometry.drawRange, { start: 6, count: 18 });
    assert.equal(E.save(f.world.state), originalState);
  }
});

function installFence(f, poll) {
  const calls = [],
    sync = {},
    gl = {
      SYNC_GPU_COMMANDS_COMPLETE: 37143,
      ALREADY_SIGNALED: 37146,
      TIMEOUT_EXPIRED: 37147,
      CONDITION_SATISFIED: 37148,
      WAIT_FAILED: 37149,
      isContextLost: () => false,
      fenceSync(condition, flags) {
        calls.push(['fence', condition, flags]);
        return sync;
      },
      flush() {
        calls.push(['flush']);
      },
      clientWaitSync(value, flags, timeout) {
        assert.equal(value, sync);
        assert.equal(flags, 0);
        assert.equal(timeout, 0, 'the main thread must never block for the GPU');
        calls.push(['poll']);
        return poll(gl);
      },
      deleteSync(value) {
        assert.equal(value, sync);
        calls.push(['delete']);
      },
      finish() {
        throw new Error('blocking GPU completion must not be used');
      },
    };
  f.renderer.getContext = () => gl;
  return { gl, calls };
}

test('startup detaches representatives before its full frame and awaits nonblocking GPU completion', async () => {
  const f = fixture(),
    scheduled = [],
    sequence = [],
    originalState = E.save(f.world.state);
  let gpuReady = false,
    paints = 0,
    settled = false;
  const fence = installFence(f, (gl) => (gpuReady ? gl.CONDITION_SATISFIED : gl.TIMEOUT_EXPIRED)),
    schedule = () => (++paints <= 2 ? Promise.resolve() : new Promise((r) => scheduled.push(r)));
  f.world.post.render = () => {
    const staged = f.scene.children.some((x) => x.name === 'startup-gpu-families');
    sequence.push(staged ? 'mini' : 'full');
    assert.equal(f.geometry.drawRange.count, staged ? 3 : 18);
    assert.equal(f.object.frustumCulled, !staged);
    assert.equal(f.world.post.target.scissorTest, staged);
    assert.equal(f.world.post.bloom.scissorTest, staged);
    assert.deepEqual(f.renderer.getScissor(new T.Vector4()).toArray(), [0, 0, 0, 0]);
    f.renderer.shadowMap.needsUpdate = false;
  };
  const ready = warmStartupScene(f.world, { jobs: [], navigation: noNavigation, schedule }).then(
    (r) => {
      settled = true;
      return r;
    },
  );
  await turn();
  assert.deepEqual(sequence, ['mini', 'full']);
  assert.deepEqual(fence.calls, [
    ['fence', fence.gl.SYNC_GPU_COMMANDS_COMPLETE, 0],
    ['flush'],
    ['poll'],
  ]);
  assert.equal(settled, false);
  assert.equal(f.renderer.shadowMap.needsUpdate, false, 'valid full-frame shadows are retained');
  assert.equal(f.renderer.getRenderTarget(), f.previous);
  assert.equal(f.scene.children.length, 1);
  assert.equal(E.save(f.world.state), originalState);
  gpuReady = true;
  scheduled.shift()();
  assert.equal((await ready).status, 'ready');
  assert.deepEqual(fence.calls.slice(-2), [['poll'], ['delete']]);
  assert.equal(f.renderer.shadowMap.needsUpdate, false);
});

test('GPU fence timeout, context loss and failed polling clean up exactly once and release loading', async () => {
  for (const outcome of ['timeout', 'context-lost', 'failed']) {
    const f = fixture(),
      scheduled = [];
    let paints = 0;
    const fence = installFence(f, (gl) =>
        outcome === 'failed' ? gl.WAIT_FAILED : gl.TIMEOUT_EXPIRED,
      ),
      schedule = () => (++paints <= 2 ? Promise.resolve() : new Promise((r) => scheduled.push(r))),
      ready = warmStartupScene(f.world, {
        jobs: [],
        navigation: noNavigation,
        schedule,
        timeoutMs: outcome === 'timeout' ? 10 : 1000,
      });
    await turn();
    assert.ok(fence.calls.some((x) => x[0] === 'fence'));
    if (outcome === 'context-lost') f.canvas.dispatchEvent(new Event('webglcontextlost'));
    const result = await ready;
    assert.equal(result.status, outcome);
    assert.equal(fence.calls.filter((x) => x[0] === 'delete').length, 1);
    assert.equal(f.scene.children.length, 1);
    assert.equal(f.renderer.getRenderTarget(), f.previous);
    assert.deepEqual(f.geometry.drawRange, { start: 6, count: 18 });
    assert.equal(f.object.frustumCulled, true);
    assert.equal(f.world.post.target.scissorTest, false);
    assert.deepEqual(f.renderer.getScissor(new T.Vector4()).toArray(), [3, 4, 500, 400]);
    const polls = fence.calls.filter((x) => x[0] === 'poll').length;
    for (const resume of scheduled) resume();
    await turn();
    assert.equal(
      fence.calls.filter((x) => x[0] === 'poll').length,
      polls,
      'cancelled waits never poll a deleted fence',
    );
  }
});

test('loading yields twice before any compile and awaits all shared-material variants plus the actual draw', async () => {
  const f = fixture(),
    scheduled = [],
    schedule = () => new Promise((resolve) => scheduled.push(resolve)),
    state = E.save(f.world.state);
  let programReady = false;
  f.renderer.info.programs.push({ isReady: () => programReady });
  const ready = warmStartupScene(f.world, { jobs: [], navigation: noNavigation, schedule });
  assert.equal(f.calls.length, 0);
  scheduled.shift()();
  await turn();
  assert.equal(f.calls.length, 0);
  scheduled.shift()();
  await turn();
  assert.equal(f.calls.filter((x) => x.phase === 'compile').length, 3);
  assert.equal(f.calls.filter((x) => x.phase === 'draw').length, 0);
  assert.equal(f.world.shaderWarmupProgress.phase, 'programs');
  assert.ok(f.scene.children.some((x) => x.name === 'startup-gpu-families'));
  programReady = true;
  scheduled.shift()();
  const result = await ready;
  assert.equal(result.status, 'ready');
  assert.equal(f.calls.filter((x) => x.phase === 'draw').length, 2);
  assert.ok(result.representatives >= 1, 'count-zero vertex-colored body has a drawable instance');
  assert.equal(f.scene.children.length, 1);
  assert.equal(f.renderer.getRenderTarget(), f.previous);
  assert.equal(E.save(f.world.state), state);
});

test('a completed driver submission cannot bypass the shared deadline before its timer is dispatched', async () => {
  const f = fixture();
  let clock = 0,
    draws = 0;
  f.world.post.render = () => {
    f.renderer.shadowMap.needsUpdate = false;
    if (++draws === 2) clock = 31;
  };
  const result = await warmStartupScene(f.world, {
    timeoutMs: 30,
    jobs: [],
    navigation: noNavigation,
    clock: () => clock,
    schedule: () => Promise.resolve(),
  });
  assert.equal(result.status, 'timeout');
  assert.equal(result.elapsedMs, 31);
  assert.equal(f.scene.children.length, 1);
  assert.equal(f.renderer.getRenderTarget(), f.previous);
});

test('loading timeout, context loss and compiler rejection release the intro without leaked staging', async () => {
  for (const failure of ['timeout', 'context-lost', 'failed']) {
    const f = fixture();
    f.renderer.compileAsync = () =>
      failure === 'failed' ? Promise.reject(new Error('compiler failed')) : new Promise(() => {});
    const ready = warmStartupScene(f.world, {
      timeoutMs: failure === 'timeout' ? 10 : 1000,
      jobs: [],
      navigation: noNavigation,
      schedule: turn,
    });
    await turn();
    await turn();
    if (failure === 'context-lost') f.canvas.dispatchEvent(new Event('webglcontextlost'));
    const result = await ready;
    assert.equal(result.status, failure);
    assert.equal(f.scene.children.length, 1);
    assert.equal(f.renderer.getRenderTarget(), f.previous);
    assert.equal(f.calls.filter((x) => x.phase === 'draw').length, 0);
  }
  const hidden = fixture();
  assert.equal(
    (await warmStartupScene(hidden.world, { timeoutMs: 5, schedule: () => new Promise(() => {}) }))
      .status,
    'timeout',
    'a hidden tab without animation callbacks cannot keep the loading UI stuck',
  );
  assert.equal(hidden.calls.length, 0);
});

test('actual warm draw can introduce shadow programs and readiness waits for them too', async () => {
  const f = fixture(),
    scheduled = [],
    schedule = () => new Promise((resolve) => scheduled.push(resolve));
  let depthReady = false;
  f.world.post.render = () => {
    f.calls.push({ phase: 'draw' });
    f.renderer.info.programs.push({ isReady: () => depthReady });
  };
  let settled = false;
  const ready = warmStartupScene(f.world, { jobs: [], navigation: noNavigation, schedule }).then(
    (r) => {
      settled = true;
      return r;
    },
  );
  scheduled.shift()();
  await turn();
  scheduled.shift()();
  await turn();
  assert.equal(f.calls.filter((x) => x.phase === 'draw').length, 1);
  assert.equal(settled, false, 'compileAsync completion alone is not startup completion');
  assert.equal(f.world.shaderWarmupProgress.phase, 'gpu');
  depthReady = true;
  scheduled.shift()();
  assert.equal((await ready).status, 'ready');
});

test('navigation preparation restarts on a same-object campaign reset and is cancelled at timeout', async () => {
  const f = fixture(),
    calls = [];
  let rounds = 0;
  function* navigation(state) {
    const identity = state.buildings;
    calls.push(identity);
    try {
      yield { phase: 'terrain', completed: 0, total: 3 };
      yield { phase: 'paths', completed: 1, total: 3 };
      yield { phase: 'paths', completed: 3, total: 3 };
    } finally {
      calls.push('closed');
    }
  }
  const schedule = async () => {
    rounds++;
    if (rounds === 3) f.world.state.buildings = f.world.state.buildings.slice();
    await turn();
  };
  const result = await warmStartupScene(f.world, { jobs: [], budgetMs: 0, navigation, schedule });
  assert.equal(result.status, 'ready');
  assert.equal(calls.filter(Array.isArray).length, 2);
  assert.equal(calls.filter((x) => x === 'closed').length, 2);
  assert.equal(f.world.shaderWarmupProgress.navigationPhase, 'paths');
  assert.equal(f.world.state.time, 0);
  let cancelled = false;
  let paintTurns = 0;
  function* endless() {
    try {
      while (true) yield { phase: 'paths', completed: 0, total: 1 };
    } finally {
      cancelled = true;
    }
  }
  const timeout = await warmStartupScene(f.world, {
    jobs: [],
    timeoutMs: 10,
    budgetMs: 0,
    navigation: endless,
    // Enter the iterator in microtasks before timers can run, even if another
    // concurrently tested module holds up the first animation turn.
    schedule: () => (++paintTurns <= 2 ? Promise.resolve() : turn()),
  });
  assert.equal(timeout.status, 'timeout');
  assert.equal(cancelled, true);
});

test('network join cancels local path preparation while GPU warmup continues, and leaving can restart it', async () => {
  for (const leaveDuringCompilation of [false, true]) {
    const f = fixture();
    let network = false,
      turns = 0,
      preparations = 0,
      closed = 0,
      release;
    f.world.callbacks = { isNetwork: () => network };
    const compiling = new Promise((resolve) => (release = resolve));
    f.renderer.compileAsync = () => compiling;
    function* navigation() {
      preparations++;
      try {
        for (let i = 0; i < 5; i++) yield { phase: 'paths', completed: i, total: 5 };
      } finally {
        closed++;
      }
    }
    const schedule = async () => {
      if (++turns === 3) network = true;
      await turn();
    };
    const ready = warmStartupScene(f.world, { jobs: [], budgetMs: 0, navigation, schedule });
    for (let i = 0; i < 8; i++) await turn();
    assert.equal(preparations, 1);
    assert.equal(closed, 1, 'the partially prepared campaign iterator is cancelled');
    assert.equal(f.world.shaderWarmupProgress.phase, 'programs');
    if (leaveDuringCompilation) network = false;
    release();
    assert.equal((await ready).status, 'ready');
    assert.equal(preparations, leaveDuringCompilation ? 2 : 1);
    assert.equal(closed, preparations);
    assert.equal(f.calls.filter((x) => x.phase === 'draw').length, 2);
  }
  const f = fixture();
  f.world.callbacks = { isNetwork: () => true };
  assert.equal(
    (
      await warmStartupScene(f.world, {
        jobs: [],
        schedule: turn,
        navigation() {
          throw new Error('client must not prepare server paths');
        },
      })
    ).status,
    'ready',
  );
});

test('model preparation primes actual template caches with bounded shared assets and no game or tree changes', () => {
  const f = modelFixture(),
    families = new WarmupFamilies(f.world),
    realScene = f.world.scene,
    clearTrees = f.world.clearTrees,
    state = E.save(f.world.state),
    jobs = warmupModelJobs();
  assert.ok(jobs.length < 60, 'representative families, not every faction/tier permutation');
  families.collectExisting();
  for (const job of jobs) families.prepare(job);
  const result = families.diagnostics();
  assert.equal(result.prototypes, jobs.length);
  assert.ok(result.geometryBytes < 12 * 1024 * 1024, `${result.geometryBytes} bytes`);
  assert.ok(result.representatives < 1000, `${result.representatives} representatives`);
  assert.equal(f.world.scene, realScene);
  assert.equal(f.world.clearTrees, clearTrees);
  assert.equal(f.treeCuts(), 0);
  assert.equal(realScene.children.length, 0);
  assert.equal(E.save(f.world.state), state);
  families.attach();
  assert.deepEqual(families.group.position.toArray(), [-900, 8, 0]);
  assert.equal(families.group.parent, realScene);
  const owned = new Set(f.world.sharedGeometries),
    disposed = [];
  for (const geometry of owned) geometry.addEventListener('dispose', () => disposed.push(geometry));
  families.dispose();
  assert.equal(realScene.children.length, 0);
  assert.equal(disposed.length, 0, 'cache and scene geometry retain their original owner');
  const count = f.world.sharedGeometries.size;
  f.world.model({ id: 100, key: 'housing', side: 0, level: 0, x: 0, z: 0, hp: 100, progress: 1 });
  assert.equal(f.world.sharedGeometries.size, count, 'first real house reuses the warmed template');
});

test('throwing prototype construction restores the real builder destination and tree method', () => {
  const f = modelFixture(),
    families = new WarmupFamilies(f.world),
    scene = f.world.scene,
    clearTrees = f.world.clearTrees;
  f.world.model = () => {
    throw new Error('model failed');
  };
  assert.throws(
    () => families.prepare({ kind: 'building', key: 'housing', side: 0, level: 0 }),
    /model failed/,
  );
  assert.equal(f.world.scene, scene);
  assert.equal(f.world.clearTrees, clearTrees);
  assert.equal(families.staging.children.length, 0);
  families.dispose();
});

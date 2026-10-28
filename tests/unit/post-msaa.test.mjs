import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { renderPixelRatio } from '../../src/rendering/performance/render-budget.js';
import { EveningPost, adaptivePostSamples } from '../../src/rendering/effects/post-processing.js';
import { RenderBudget } from '../../src/rendering/performance/render-budget.js';

test('MSAA follows stable resolution degradation and waits for full-scale recovery', () => {
  const budget = new RenderBudget();
  let samples = 4;
  for (let i = 0; i < 50; i++) budget.observe(0.04);
  assert.equal(adaptivePostSamples(budget.scale, 8, samples), 4);
  for (let i = 0; i < 1000; i++) budget.observe(0.04);
  samples = adaptivePostSamples(budget.scale, 8, samples);
  assert.equal(samples, 2);
  assert.equal(adaptivePostSamples(0.95, 8, samples), 2);
  assert.equal(adaptivePostSamples(1, 8, samples), 4);
  assert.equal(adaptivePostSamples(0.95, 8, 4), 4);
  for (const [max, expected] of [
    [8, 4],
    [4, 4],
    [3, 2],
    [2, 2],
    [1, 1],
    [0, 0],
  ])
    assert.equal(adaptivePostSamples(1, max), expected);
});
test('sample changes release attachments once, preserving texture uniforms and resize bounds', () => {
  const post = new EveningPost({ getPixelRatio: () => 1, capabilities: { maxSamples: 4 } });
  let disposals = 0;
  post.target.addEventListener('dispose', () => disposals++);
  post.resize(1280, 720);
  assert.equal(disposals, 1);
  const frame = post.uniforms.frame.value,
    depth = post.uniforms.depthFrame.value;
  post.resize(1280, 720, 0.9);
  assert.equal(post.target.samples, 2);
  assert.equal(disposals, 2, 'same-size sample change must release old buffers');
  for (let i = 0; i < 100; i++) post.resize(1280, 720, 0.9);
  post.resize(1280, 720, 0.95);
  assert.equal(disposals, 3, 'partial recovery changes scene dimensions once, keeping two samples');
  assert.equal(post.target.samples, 2);
  post.resize(1920, 1080, 1);
  assert.equal(disposals, 4, 'size plus sample change needs one release, not two');
  assert.equal(post.target.samples, 4);
  assert.equal(post.bloom.width, 960);
  assert.equal(post.bloom.height, 540);
  assert.equal(post.uniforms.frame.value, frame);
  assert.equal(post.uniforms.depthFrame.value, depth);
  assert.deepEqual(post.uniforms.pixel.value.toArray(), [1 / 1920, 1 / 1080]);
});

test('unchanged tiny target dimensions still release multisample attachments exactly once per sample change', () => {
  const post = new EveningPost({ getPixelRatio: () => 1, capabilities: { maxSamples: 4 } });
  let disposals = 0;
  post.target.addEventListener('dispose', () => disposals++);
  post.resize(1, 1);
  assert.equal(disposals, 0);
  post.resize(1, 1, 0.9);
  assert.equal(post.target.samples, 2);
  assert.equal(disposals, 1);
  post.resize(1, 1, 0.95);
  post.resize(1, 1, 0.95);
  assert.equal(disposals, 1);
  post.resize(1, 1, 1);
  assert.equal(post.target.samples, 4);
  assert.equal(disposals, 2);
});

test('adaptive offscreen sizes preserve the old physical scene budget at capped high DPI and 4K', () => {
  for (const [width, height, dpr] of [
    [1280, 720, 2],
    [1920, 1080, 2],
    [3840, 2160, 2],
  ]) {
    const base = renderPixelRatio(width, height, dpr),
      output = [Math.floor(width * base), Math.floor(height * base)],
      renderer = {
        getPixelRatio: () => base,
        capabilities: { maxSamples: 4 },
        getDrawingBufferSize: (out) => out.set(...output),
      },
      post = new EveningPost(renderer);
    let previous = 4;
    for (const scale of [1, 0.9, 0.8, 0.75, 0.95, 1]) {
      post.resize(width, height, scale);
      const ratio = renderPixelRatio(width, height, dpr, scale),
        x = Math.floor(width * ratio),
        y = Math.floor(height * ratio);
      assert.equal(post.target.width, x);
      assert.equal(post.target.height, y);
      assert.equal(post.bloom.width, Math.ceil(x / 2));
      assert.equal(post.bloom.height, Math.ceil(y / 2));
      assert.equal(post.target.samples, adaptivePostSamples(scale, 4, previous));
      assert.equal(post.scenePixelRatio, ratio);
      assert.deepEqual(post.uniforms.grainPixelScale.value.toArray(), [
        x / output[0],
        y / output[1],
      ]);
      previous = post.target.samples;
    }
  }
});

test('scene and bloom use adaptive target viewports while the compositor fills the stable native canvas', () => {
  let active = null;
  const renders = [],
    renderer = {
      getPixelRatio: () => 1.25,
      getDrawingBufferSize: (out) => out.set(1600, 900),
      info: { render: { calls: 1, triangles: 2 } },
      setRenderTarget: (target) => {
        active = target;
      },
      render: (scene) =>
        renders.push({
          scene,
          target: active,
          viewport: active ? active.viewport.toArray() : [0, 0, 1600, 900],
        }),
    },
    post = new EveningPost(renderer),
    scene = new T.Scene(),
    camera = new T.PerspectiveCamera(45, 1280 / 720, 1, 1000);
  post.resize(1280, 720, 0.8);
  post.render(scene, camera, 0);
  assert.deepEqual(
    renders.map((r) => r.viewport),
    [
      [0, 0, 1280, 720],
      [0, 0, 640, 360],
      [0, 0, 1600, 900],
    ],
  );
  assert.equal(renders[0].scene, scene);
  assert.equal(renders[2].scene, post.scene);
  assert.equal(renders[2].target, null);
  const uv = post.scene.children[0].geometry.attributes.uv.array;
  assert.equal(Math.min(...uv), 0);
  assert.equal(Math.max(...uv), 1, 'fullscreen UVs sample the complete adaptive scene');
});

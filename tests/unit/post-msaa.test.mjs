import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(disposals, 2, 'steady budget and partial recovery allocate nothing');
  post.resize(1920, 1080, 1);
  assert.equal(disposals, 3, 'size plus sample change needs one release, not two');
  assert.equal(post.target.samples, 4);
  assert.equal(post.bloom.width, 960);
  assert.equal(post.bloom.height, 540);
  assert.equal(post.uniforms.frame.value, frame);
  assert.equal(post.uniforms.depthFrame.value, depth);
  assert.deepEqual(post.uniforms.pixel.value.toArray(), [1 / 1920, 1 / 1080]);
});

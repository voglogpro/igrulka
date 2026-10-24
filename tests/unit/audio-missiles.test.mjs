import test from 'node:test';
import assert from 'node:assert/strict';
import { rocketIgnition, missileDive } from '../../src/audio/missiles.js';

test('distinct missile stages are finite, bounded and end without a discontinuity', () => {
  const rate = 22050;
  const small = rocketIgnition(rate),
    large = rocketIgnition(rate, true),
    terminal = missileDive(rate);
  assert.ok(large.length > small.length * 1.5);
  for (const samples of [small, large, terminal]) {
    assert.ok(samples.every(Number.isFinite));
    assert.ok(samples.every((sample) => Math.abs(sample) <= 0.951));
    assert.equal(Math.abs(samples.at(-1)), 0);
    const power = samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length;
    assert.ok(power > 0.001 && power < 0.3);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { rainLoop } from '../../src/audio/ambience/rain.js';

test('rain is a soft band-limited circular patter without a broadband hiss or a cut at the loop seam', () => {
  const previous = Math.random;
  let seed = 86;
  Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  try {
    const rate = 24000,
      data = rainLoop(rate);
    let sum = 0,
      energy = 0,
      differences = 0,
      peak = 0;
    for (let i = 0; i < data.length; i++) {
      assert.ok(Number.isFinite(data[i]));
      sum += data[i];
      energy += data[i] ** 2;
      differences += (data[i] - data[(i + data.length - 1) % data.length]) ** 2;
      peak = Math.max(peak, Math.abs(data[i]));
    }
    assert.equal(data.length, rate * 5);
    assert.ok(Math.abs(sum / data.length) < 1e-7);
    assert.ok(peak <= 0.951 && peak > 0.9);
    assert.ok(differences / energy < 0.12, 'limited high-frequency derivative energy');
    const seam = Math.abs(data[0] - data.at(-1));
    assert.ok(seam < Math.sqrt(differences / data.length) * 5, `seam ${seam}`);
    assert.ok(energy / data.length > 0.001, 'drops remain audible');
  } finally {
    Math.random = previous;
  }
});

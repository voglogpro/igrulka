import test from 'node:test';
import assert from 'node:assert/strict';
import { explosion, gunshot, GUNS, mopedLoop, impulseResponse } from '../../src/audio/synth.js';
import { distanceMix, GameAudio } from '../../src/audio/game-audio.js';

function energy(samples, from, to) {
  let sum = 0;
  for (let i = from; i < Math.min(to, samples.length); i++) sum += samples[i] ** 2;
  return Math.sqrt(sum / Math.max(1, Math.min(to, samples.length) - from));
}

test('layered battlefield buffers retain headroom and a decaying pressure tail', () => {
  const rate = 12000;
  for (const data of [explosion(rate, 2.2), gunshot(rate, GUNS.artillery), mopedLoop(rate)]) {
    let peak = 0;
    for (const value of data) {
      assert.ok(Number.isFinite(value));
      peak = Math.max(peak, Math.abs(value));
    }
    assert.ok(peak > 0.9 && peak <= 0.951);
    assert.equal(Math.abs(data.at(-1)), 0);
  }
  const blast = explosion(rate, 2.2);
  assert.ok(energy(blast, rate, rate * 2) > 0.01, 'large blast has an audible rolling tail');
  assert.ok(energy(blast, rate * 3, rate * 4) < energy(blast, rate, rate * 2));
  const [left, right] = impulseResponse(rate);
  assert.equal(left.length, Math.ceil(rate * 3.1));
  assert.notDeepEqual(left, right, 'outdoor reflections decorrelate the stereo channels');
});

test('distance shaping preserves delayed dark distant shots and hard voice admission cap', () => {
  const near = distanceMix(20),
    far = distanceMix(800);
  assert.ok(far.dry < near.dry && far.cutoff < near.cutoff && far.delay > near.delay);
  assert.ok(far.echo > near.echo);
  const audio = new GameAudio();
  audio.voices = 44;
  audio.buffers = { blast: [{}] };
  audio.sample('blast', 0, 0, 1);
  assert.equal(audio.voices, 44, 'full pool returns before allocating Web Audio nodes');
});

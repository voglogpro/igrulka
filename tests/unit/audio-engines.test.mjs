import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recordedEngineLoop, uavEngineMix } from '../../src/audio/engines.js';

test('bundled real engine loops match the licensed PCM assets and have no artificial seam spike', async () => {
  for (const [kind, filename] of [
    ['rotor', 'fpv-rotor'],
    ['prop', 'prop-engine'],
  ]) {
    const wav = await readFile(new URL(`../../assets/audio/${filename}.wav`, import.meta.url));
    const dataAt = wav.indexOf(Buffer.from('data')) + 8;
    const samples = recordedEngineLoop(16000, kind);
    assert.equal(samples.length, 40960);
    let power = 0,
      peak = 0,
      delta = 0;
    for (let i = 0; i < samples.length; i++) {
      assert.equal(samples[i], wav.readInt16LE(dataAt + i * 2) / 32768);
      assert.ok(Number.isFinite(samples[i]));
      power += samples[i] ** 2;
      peak = Math.max(peak, Math.abs(samples[i]));
      if (i) delta = Math.max(delta, Math.abs(samples[i] - samples[i - 1]));
    }
    assert.ok(Math.sqrt(power / samples.length) > 0.08);
    assert.ok(peak <= 0.81);
    assert.ok(Math.abs(samples[0] - samples.at(-1)) <= delta);
    const resampled = recordedEngineLoop(44100, kind);
    assert.equal(resampled.length, 112896);
    assert.ok(resampled.every(Number.isFinite));
  }
});

test('FPV and piston references differ; distance and bounded Doppler preserve engine identity', () => {
  const listener = { x: 0, y: 0, z: 0 };
  const drone = { x: 100, y: 0, z: 0, vx: -90, key: 'drone' };
  const near = uavEngineMix(drone, 100, listener),
    far = uavEngineMix(drone, 900, listener);
  assert.ok(near.gain > far.gain * 4);
  assert.ok(near.cutoff > far.cutoff * 2);
  const approaching = near.rate,
    departing = uavEngineMix({ ...drone, vx: 90 }, 100, listener).rate;
  assert.ok(approaching > departing);
  const fpv = uavEngineMix({ ...drone, subtype: 'fpv' }, 100, listener);
  const heavy = uavEngineMix({ ...drone, key: 'heavy' }, 100, listener);
  assert.ok(fpv.rate > near.rate && near.rate > heavy.rate);
  assert.ok(uavEngineMix({ ...drone, vx: -100000 }, 100, listener).rate <= 1.04 * 1.18);
  assert.notDeepEqual(recordedEngineLoop(16000, 'rotor'), recordedEngineLoop(16000, 'prop'));
});

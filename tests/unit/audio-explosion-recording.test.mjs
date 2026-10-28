import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { recordedExplosionSample } from '../../src/audio/explosions.js';
import { pcm, sampleRate } from '../../src/audio/samples/explosion-field.js';
import { pcmCatalog } from '../../src/audio/pcm-catalog.js';

test('bundled explosion is the licensed checked-in field PCM, not a second edited source', () => {
  const wav = readFileSync(new URL('../../assets/audio/explosion-field.wav', import.meta.url));
  const sources = JSON.parse(
    readFileSync(new URL('../../assets/audio/explosion-sources.json', import.meta.url)),
  );
  assert.equal(createHash('sha256').update(wav).digest('hex'), sources.derivative.sha256);
  assert.equal(sampleRate, 16000);
  let data;
  for (let at = 12; at + 8 <= wav.length;) {
    const count = wav.readUInt32LE(at + 4);
    if (wav.toString('ascii', at, at + 4) === 'data') data = wav.subarray(at + 8, at + 8 + count);
    at += 8 + count + (count % 2);
  }
  assert.deepEqual(Buffer.from(pcm, 'base64'), data);
  assert.equal(sources.source.license, 'CC0-1.0');
});

test('all three actual blast profiles have bounded levels, natural decay and clean endpoints', () => {
  for (const rate of [16000, 22050, 44100, 48000]) {
    for (const [name, seconds] of Object.entries({
      blastSmall: 1.55,
      blast: 3.1,
      blastLarge: 4.4,
    })) {
      const samples = recordedExplosionSample(rate, name);
      assert.equal(samples.length, Math.round(seconds * rate));
      assert.equal(samples[0], 0);
      assert.equal(samples.at(-1), 0);
      let peak = 0,
        start = 0,
        tail = 0;
      for (let i = 0; i < samples.length; i++) {
        assert.ok(Number.isFinite(samples[i]));
        peak = Math.max(peak, Math.abs(samples[i]));
        if (i < rate * 0.4) start += samples[i] ** 2;
        if (i > samples.length - rate * 0.4) tail += samples[i] ** 2;
      }
      assert.ok(peak > 0.6 && peak <= 0.721);
      assert.ok(start > tail * 2, `${name} preserves decaying recorded blast`);
    }
  }
});

test('every explosion catalog job works without a random-noise generator', () => {
  const random = Math.random;
  try {
    Math.random = () => {
      throw Error('Unexpected synthetic blast');
    };
    const jobs = pcmCatalog(16000).filter((job) => /^blast/.test(job.name));
    assert.equal(jobs.length, 5);
    for (const job of jobs) assert.ok(job.make().length >= 16000);
  } finally {
    Math.random = random;
  }
});

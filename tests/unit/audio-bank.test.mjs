import test from 'node:test';
import assert from 'node:assert/strict';
import { audioBufferBank, audioBankDiagnostics } from '../../src/audio/sample-bank.js';
function context(sampleRate) {
  return {
    sampleRate,
    state: 'running',
    allocations: 0,
    createBuffer(channels, length, rate) {
      this.allocations++;
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        sampleRate: rate,
        getChannelData: (i) => data[i],
        copyToChannel: (source, i) => data[i].set(source),
      };
    },
  };
}
test('PCM presets are shared across contexts and one context never allocates per soldier or repeated unlock', async () => {
  const first = context(8000),
    bank = audioBufferBank(first);
  assert.equal(first.allocations, 0, 'requesting a cold bank must not synthesize synchronously');
  assert.equal(audioBufferBank(first), bank);
  await bank.loopsReady;
  await bank.ready;
  assert.equal(bank.buffers.impulse.getChannelData(0).length, 24800);
  const allocations = first.allocations,
    before = audioBankDiagnostics().find((v) => v.rate === 8000);
  assert.equal(before.rendered, before.total);
  for (let i = 0; i < 1000; i++)
    assert.equal(audioBufferBank(first).buffers.rifle[0], bank.buffers.rifle[0]);
  assert.equal(
    first.allocations,
    allocations,
    '1000 repeated clients/voices must reuse exact AudioBuffers',
  );
  const second = context(8000),
    other = audioBufferBank(second);
  await other.ready;
  assert.equal(second.allocations, allocations);
  assert.notEqual(
    other.buffers.rifle[0],
    bank.buffers.rifle[0],
    'AudioBuffers remain owned by their context',
  );
  assert.deepEqual(
    other.buffers.rifle[0].getChannelData(0),
    bank.buffers.rifle[0].getChannelData(0),
    'same PCM without re-synthesis or lost variants',
  );
  assert.deepEqual(
    audioBankDiagnostics().find((v) => v.rate === 8000),
    before,
  );
  assert.equal(bank.buffers.rifle.length, 3);
  assert.equal(bank.buffers.blast.length, 2);
  assert.equal(bank.buffers.footstep.length, 3);
});

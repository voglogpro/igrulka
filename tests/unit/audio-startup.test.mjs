import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../../src/audio/game-audio.js';

function fakeContext() {
  const context = {
    sampleRate: 1000,
    currentTime: 3,
    state: 'running',
    nodes: [],
    connections: [],
    starts: [],
    resumes: 0,
    suspends: 0,
    allocations: 0,
    destination: { kind: 'destination' },
    resume() {
      this.resumes++;
      this.state = 'running';
      return Promise.resolve();
    },
    suspend() {
      this.suspends++;
      this.state = 'suspended';
      return Promise.resolve();
    },
    close() {
      this.state = 'closed';
      return Promise.resolve();
    },
    decodeAudioData() {
      return Promise.resolve({ duration: 56.5 });
    },
    createBuffer(channels, length, sampleRate) {
      this.allocations++;
      const samples = Array.from({ length: channels }, () => new Float32Array(length));
      return { duration: length / sampleRate, copyToChannel: (data, i) => samples[i].set(data) };
    },
  };
  const param = () => ({
    value: 0,
    targets: [],
    setTargetAtTime(...args) {
      this.targets.push(args);
      this.value = args[0];
    },
    setValueAtTime(value) {
      this.value = value;
    },
    exponentialRampToValueAtTime(value) {
      this.value = value;
    },
  });
  const node = (kind, properties = {}) => {
    const result = {
      kind,
      ...properties,
      connect(target) {
        context.connections.push([this, target]);
      },
      disconnect() {
        this.disconnected = true;
      },
      start(...args) {
        context.starts.push([this, args]);
      },
      stop() {},
    };
    context.nodes.push(result);
    return result;
  };
  context.createGain = () => node('gain', { gain: param() });
  context.createDynamicsCompressor = () =>
    node('compressor', {
      threshold: param(),
      knee: param(),
      ratio: param(),
      attack: param(),
      release: param(),
    });
  context.createBiquadFilter = () => node('filter', { frequency: param(), Q: param() });
  context.createWaveShaper = () => node('ceiling');
  context.createConvolver = () => node('reverb');
  context.createDelay = () => node('delay', { delayTime: param() });
  context.createStereoPanner = () => node('pan', { pan: param() });
  context.createBufferSource = () => node('source', { playbackRate: param() });
  context.createOscillator = () => node('oscillator', { frequency: param() });
  return context;
}

async function nativeContext(contexts, action) {
  const previous = globalThis.window;
  let constructions = 0;
  globalThis.window = {
    AudioContext: function () {
      const context = contexts[constructions++];
      if (context instanceof Error) throw context;
      return context;
    },
  };
  try {
    await action(() => constructions);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

test('loading prepares the exact shared graph once, muted and suspended, without admitting any sound before activation', async () => {
  const audio = new GameAudio();
  const context = fakeContext();
  await nativeContext([context], async (constructions) => {
    await audio.prepare();
    const nodes = context.nodes.length;
    const allocations = context.allocations;
    await audio.prepare();
    assert.equal(constructions(), 1);
    assert.equal(context.nodes.length, nodes);
    assert.equal(context.allocations, allocations);
    assert.equal(context.resumes, 0);
    assert.equal(context.suspends, 1);
    assert.equal(context.state, 'suspended');
    assert.equal(audio.activated, false);
    assert.equal(audio.master.gain.value, 0);
    assert.equal(audio.engines.length, 12);
    assert.equal(
      context.starts.length,
      14,
      'existing 12 engines, siren and rain are prepared once',
    );
    assert.ok(audio.engines.every((engine) => engine.level.gain.value === 0));
    assert.equal(audio.siren.level.gain.value, 0);
    assert.equal(audio.rain.level.gain.value, 0);
    assert.equal(audio.compressor.threshold.value, -14);
    assert.equal(audio.compressor.knee.value, 12);
    assert.equal(audio.compressor.ratio.value, 5);
    assert.equal(audio.compressor.attack.value, 0.002);
    assert.equal(audio.compressor.release.value, 0.3);
    const ceiling = context.nodes.find((node) => node.kind === 'ceiling');
    const filters = context.nodes.filter((node) => node.kind === 'filter');
    assert.equal(ceiling.curve.length, 4097);
    assert.equal(ceiling.curve[2048], 0);
    assert.equal(filters[0].type, 'highpass');
    assert.equal(filters[0].frequency.value, 22);
    assert.equal(filters[1].frequency.value, 1300);
    assert.equal(context.nodes.find((node) => node.kind === 'delay').delayTime.value, 0.46);
    assert.equal(audio.reverbIn.gain.value, 0.9);
    assert.ok(context.connections.some(([from, to]) => from === audio.master && to === filters[0]));
    assert.ok(
      context.connections.some(([from, to]) => from === ceiling && to === context.destination),
    );
    audio.set(true, 0.62);
    audio.tone(100, 200, 0.1);
    audio.sample('rifle', 0, 0, 1);
    audio.play({ type: 'shot', shooter: 'mog' });
    audio.update(null, null, false); // Must return before inspecting battle/listener state.
    audio.focus(true);
    assert.equal(audio.master.gain.value, 0);
    assert.deepEqual(
      audio.master.gain.targets,
      [],
      'inactive settings must not leave a zero-gain automation that survives unlock',
    );
    assert.equal(context.nodes.length, nodes);
    assert.equal(audio.voices, 0);
    assert.deepEqual(audio.last, {});
    assert.equal(context.resumes, 0);
    audio.unlock();
    assert.equal(audio.activated, true);
    assert.equal(audio.master.gain.value, 0.62);
    assert.equal(context.resumes, 1);
    assert.equal(context.nodes.length, nodes, 'first gesture reuses the prepared graph');
    audio.sample('rifle', 0, 0, 1);
    assert.equal(audio.voices, 1);
    audio.unlock();
    assert.equal(context.resumes, 2);
    assert.equal(constructions(), 1);
    assert.equal(context.allocations, allocations);
  });
});

test('injected offline unlock activates the original gain without native resume or suspension and respects sound settings', async () => {
  const audio = new GameAudio();
  const context = fakeContext();
  audio.set(false, 0.48);
  audio.unlock(context);
  await audio.ready;
  assert.equal(audio.activated, true);
  assert.equal(audio.master.gain.value, 0);
  assert.equal(context.resumes, 0);
  assert.equal(context.suspends, 0);
  assert.equal(context.state, 'running');
  assert.equal(audio.engines.length, 12);
  audio.set(true, 0.28);
  assert.deepEqual(audio.master.gain.targets.at(-1), [0.28, 3, 0.05]);
  audio.sample('rifle', 0, 0, 1);
  assert.equal(audio.voices, 1);
});

test('failed loading preparation can be retried lazily by the next gesture without trapping game start', async () => {
  const audio = new GameAudio();
  const failed = fakeContext();
  failed.createConvolver = () => {
    throw Error('device graph unavailable');
  };
  const healthy = fakeContext();
  await nativeContext([failed, healthy], async (constructions) => {
    assert.throws(() => audio.prepare(), /device graph unavailable/);
    assert.equal(audio.context, null);
    assert.equal(audio.activated, false);
    assert.equal(failed.state, 'closed');
    audio.unlock();
    await audio.preparation;
    assert.equal(constructions(), 2);
    assert.equal(audio.context, healthy);
    assert.equal(audio.activated, true);
    assert.equal(healthy.resumes, 1);
    assert.equal(audio.master.gain.value, 0.35);
  });
  const denied = new GameAudio();
  await nativeContext([Error('no device')], async () => {
    assert.doesNotThrow(() => denied.unlock());
    assert.equal(denied.context, null);
    assert.equal(denied.activated, false);
  });
});

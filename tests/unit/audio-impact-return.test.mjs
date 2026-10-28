import test from 'node:test';
import assert from 'node:assert/strict';
import { ImpactReturn, IMPACT_RETURNS, impactReturnGain } from '../../src/audio/impact-return.js';
import { GameAudio, distanceMix, ordnanceMix } from '../../src/audio/game-audio.js';

function fixture() {
  const nodes = [],
    sources = [],
    edges = [];
  const node = (kind) => {
    const n = {
      kind,
      gain: { value: 0 },
      frequency: { value: 0 },
      Q: {},
      delayTime: {},
      pan: {},
      playbackRate: {},
      connect(to) {
        edges.push([n, to]);
      },
      disconnect() {
        n.disconnected = true;
      },
      start(...args) {
        n.started = args;
      },
      stop() {
        n.stopped = true;
      },
    };
    nodes.push(n);
    if (kind === 'source') sources.push(n);
    return n;
  };
  const context = {
    currentTime: 3,
    nodes,
    sources,
    createGain: () => node('gain'),
    createBiquadFilter: () => node('filter'),
    createDelay: () => node('delay'),
    createStereoPanner: () => node('pan'),
    createBufferSource: () => node('source'),
  };
  const audio = new GameAudio();
  audio.context = context;
  audio.activated = true;
  audio.dry = node('dry');
  audio.reverbIn = node('reverb');
  audio.echoIn = node('echo');
  audio.impactReturn = new ImpactReturn(context, audio.dry);
  audio.buffers = {
    blast: [{ id: 'original-blast' }],
    blastLarge: [{ id: 'original-large' }],
    rifle: [{ id: 'rifle' }],
    ballisticLaunch: [{ id: 'recorded-launch' }],
  };
  return { audio, context, nodes, sources, edges };
}

test('hybrid retains original loud direct PCM identity, dry/filter/arrival and legacy wet sends', () => {
  for (const name of ['blast', 'blastLarge', 'ballisticLaunch', 'rifle'])
    for (const distance of [0, 250, 2500, 5000]) {
      const { audio, context, nodes, sources } = fixture(),
        before = nodes.length;
      audio.sample(name, distance, 0.4, 1.6, { force: true });
      const created = nodes.slice(before),
        mix = name === 'ballisticLaunch' ? ordnanceMix(distance, 1.6) : distanceMix(distance, 1.6);
      assert.equal(sources.length, 1, 'return adds no source');
      assert.equal(sources[0].buffer, audio.buffers[name][0], 'original bank is never replaced');
      assert.equal(sources[0].started[0], context.currentTime + mix.delay);
      assert.equal(created[1].frequency.value, mix.cutoff);
      assert.equal(created[2].gain.value, mix.dry);
      assert.equal(created[3].gain.value, mix.wet);
      assert.equal(created[4].gain.value, mix.echo);
      assert.equal(
        created.filter((node) => node.kind === 'delay').length,
        0,
        'delay lines are prebuilt',
      );
      assert.equal(created.length, name === 'rifle' ? 6 : 7);
      if (name !== 'rifle') assert.equal(created.at(-1).gain.value, impactReturnGain(mix));
    }
});

test('parallel return processes only major events with bounded feed-forward echoes and audible-band bass', () => {
  const { audio, nodes, edges } = fixture(),
    bus = audio.impactReturn;
  assert.ok(
    !IMPACT_RETURNS.has('rifle') &&
      !IMPACT_RETURNS.has('blastSmall') &&
      !IMPACT_RETURNS.has('rotor'),
  );
  assert.deepEqual(
    nodes.filter((node) => node.kind === 'delay').map((node) => node.delayTime.value),
    [0.38, 0.83],
  );
  const shelf = nodes.find((node) => node.type === 'lowshelf');
  assert.equal(shelf.frequency.value, 110);
  assert.equal(shelf.gain.value, 3);
  assert.equal(bus.output.gain.value, 1);
  assert.ok(
    !edges.some(([from, to]) => from.kind === 'gain' && to.kind === 'delay'),
    'no feedback accumulation',
  );
  assert.ok(!nodes.some((node) => ['source', 'oscillator', 'convolver'].includes(node.kind)));
});

test('hybrid keeps forty-four source cap, priority eviction and idempotent native cleanup', () => {
  const { audio, context, sources } = fixture();
  for (let i = 0; i < 44; i++) audio.sample('blast', 0, 0, 1);
  assert.equal(audio.voices, 44);
  assert.equal(sources.length, 44);
  const count = context.nodes.length;
  audio.sample('blast', 0, 0, 1);
  assert.equal(context.nodes.length, count);
  audio.sample('ballisticLaunch', 250, 0, 1);
  assert.equal(audio.voices, 44);
  assert.equal(sources.length, 45);
  assert.equal(sources[0].stopped, true);
  sources[0].onended();
  sources[0].onended();
  assert.equal(audio.voices, 44);
  for (const voice of [...audio.activeSamples]) voice.source.onended();
  assert.equal(audio.voices, 0);
});

test('mute drops delayed source and echo tails; repeated mute and end callbacks are harmless', () => {
  const { audio, context, sources } = fixture(),
    old = [...audio.impactReturn.nodes];
  audio.sample('blastLarge', 2500, 0, 1, { force: true });
  audio.set(false);
  assert.equal(sources[0].stopped, true);
  assert.equal(audio.voices, 0);
  assert.ok(old.every((node) => node.disconnected));
  const count = context.nodes.length;
  audio.set(false);
  sources[0].onended();
  sources[0].onended();
  assert.equal(context.nodes.length, count);
  assert.equal(audio.voices, 0);
  audio.paused = true;
  audio.set(true);
  audio.sample('blast', 0, 0, 1);
  assert.equal(sources.length, 1, 'paused transport admits no delayed sound');
});

test('distant returns use existing reflection energy without increasing the close transient send', () => {
  const close = distanceMix(25, 1.6),
    far = distanceMix(2500, 1.6),
    horizon = distanceMix(5000, 1.6);
  assert.ok(impactReturnGain(close) <= close.dry * 0.5);
  assert.ok(
    impactReturnGain(far) > far.dry * 2.5,
    'far bass/echo has a material input instead of half-dry attenuation',
  );
  assert.ok(impactReturnGain(horizon) > horizon.dry * 2.5);
  assert.ok(
    impactReturnGain(horizon) < impactReturnGain(far),
    'distance still attenuates the added return',
  );
  for (const distance of [0, 25, 250, 2500, 5000, 1e9])
    for (const mix of [distanceMix(distance, 1.6), ordnanceMix(distance, 1.6)])
      assert.ok(
        Number.isFinite(impactReturnGain(mix)) &&
          impactReturnGain(mix) >= 0 &&
          impactReturnGain(mix) < 1,
      );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recordedOrdnanceSample, recordedJetMix } from '../../src/audio/ordnance.js';
import { pcmCatalog } from '../../src/audio/pcm-catalog.js';
import { GameAudio, distanceMix, ordnanceMix } from '../../src/audio/game-audio.js';
import * as E from '../../src/game/index.js';

const files = {
  rocketLaunch: 'rocket-launch',
  cruiseLaunch: 'cruise-launch',
  ballisticLaunch: 'ballistic-launch',
  artillery: 'artillery-shot',
  jet: 'missile-flight',
  missileDive: 'missile-approach',
};
test('runtime weapon PCM is the actual checked-in recorded WAV, with finite resampling and no synthesized layer', async () => {
  for (const [name, file] of Object.entries(files)) {
    const wav = await readFile(new URL(`../../assets/audio/${file}.wav`, import.meta.url)),
      native = recordedOrdnanceSample(16000, name);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(40), native.length * 2);
    let power = 0,
      peak = 0;
    for (let i = 0; i < native.length; i++) {
      assert.equal(native[i], wav.readInt16LE(44 + i * 2) / 32768, `${name} sample ${i}`);
      power += native[i] * native[i];
      peak = Math.max(peak, Math.abs(native[i]));
    }
    assert.ok(power / native.length > 0.0001, `${name} must not be silent`);
    assert.ok(peak > 0.7 && peak <= 0.821);
    for (const rate of [8000, 22050, 48000]) {
      const output = recordedOrdnanceSample(rate, name);
      assert.equal(output.length, Math.round((native.length * rate) / 16000));
      assert.ok(output.every(Number.isFinite));
      if (name !== 'jet') assert.equal(output.at(-1), 0, 'one-shot edges end without a click');
    }
  }
  const random = Math.random;
  Math.random = () => assert.fail('recorded weapon job must not synthesize random noise');
  try {
    const jobs = pcmCatalog(16000);
    for (const name of Object.keys(files)) {
      const job = jobs.find((candidate) => candidate.name === name);
      assert.ok(job, name);
      assert.deepEqual(job.make(), recordedOrdnanceSample(16000, name));
    }
    for (const [alias, recording] of Object.entries({
      whistle: 'missileDive',
      atgm: 'rocketLaunch',
    })) {
      const jobsForAlias = jobs.filter((job) => job.name === alias);
      assert.equal(jobsForAlias.length, 1, `${alias} has no second synthesized variant`);
      assert.deepEqual(jobsForAlias[0].make(), recordedOrdnanceSample(16000, recording));
    }
  } finally {
    Math.random = random;
  }
});

test('real simulation launch, MLRS fire and artillery approach events route exclusively to the recorded weapon bank', () => {
  const samples = [],
    audio = new GameAudio();
  audio.context = { currentTime: 0 };
  audio.unlock(audio.context);
  audio.sample = (name) => samples.push(name);
  const resetAudio = () => {
    samples.length = 0;
    audio.last = {};
    audio.whistled.clear();
  };
  for (const key of ['cruise', 'ballistic']) {
    const state = E.createGame(81201, { mode: 'multiplayer' });
    state.rules.rear = false;
    const site = E.build(state, 0, 'silo', -850, 100);
    assert.equal(typeof site, 'object', String(site));
    site.progress = 1;
    site.hp = site.maxHp;
    assert.equal(E.acceptLaunchDelivery(site, key, 1), 1);
    assert.equal(E.launch(state, 0, key, { x: 850, z: 100 }, 1, site.id), 1);
    E.step(state, 0.05);
    const launched = state.events.find((event) => event.type === 'launch' && event.key === key);
    assert.ok(launched, `${key} emits its actual launch event`);
    resetAudio();
    audio.play(launched, 500, 0);
    assert.deepEqual(samples, [key === 'cruise' ? 'cruiseLaunch' : 'ballisticLaunch']);
  }
  for (const key of ['howitzer', 'mlrs']) {
    const state = E.createGame(81202, { mode: 'multiplayer' });
    state.rules.rear = false;
    const gun = E.makeGround(state, 0, key, -960, 250),
      target = E.makeGround(state, 1, 'leopard', -660, 250);
    target.holdFire = true;
    state.groundUnits.push(gun, target);
    E.step(state, 0.05);
    const fired = state.events.find((event) => event.type === 'shot' && event.shooter === key),
      projectile = state.projectiles.find((round) => round.shooterKey === key);
    assert.ok(fired && projectile, `${key} really fires a projectile`);
    resetAudio();
    audio.play(fired, 500, 0);
    assert.deepEqual(samples, [key === 'mlrs' ? 'rocketLaunch' : 'artillery']);
    while (projectile.flight - projectile.life > 1.5) E.step(state, 0.05);
    samples.length = 0;
    audio.incoming(state);
    assert.ok(samples.includes(key === 'mlrs' ? 'missileDive' : 'whistle'));
    for (const name of samples) {
      const job = pcmCatalog(8000).find((candidate) => candidate.name === name);
      assert.ok(job);
      assert.deepEqual(job.make(), recordedOrdnanceSample(8000, 'missileDive'));
    }
  }
});

test('recorded ordnance reaches a strategy camera while preserving range, stereo timing and the existing rifle mix', () => {
  const rifle = distanceMix(500),
    near = ordnanceMix(50),
    high = ordnanceMix(500),
    far = ordnanceMix(2500);
  assert.ok(high.dry > rifle.dry * 2.5);
  assert.ok(near.dry > high.dry && high.dry > far.dry);
  assert.ok(far.dry > 0.05 && far.dry < 0.12);
  assert.ok(near.cutoff > far.cutoff);
  assert.equal(high.delay, rifle.delay);
  assert.deepEqual(distanceMix(500), rifle, 'weapon-specific mixing must not mutate rifle levels');
  const listener = { x: 0, y: 0, z: 0 },
    incoming = recordedJetMix({ x: 500, y: 0, z: 0, vx: -80 }, 500, listener),
    departing = recordedJetMix({ x: 500, y: 0, z: 0, vx: 80 }, 500, listener);
  assert.ok(incoming.rate > departing.rate);
  assert.ok(incoming.gain > 0 && incoming.gain < 0.27);
});

function sampleContext() {
  const sources = [];
  const node = () => ({ connect() {}, disconnect() {} });
  return {
    currentTime: 3,
    sources,
    createBufferSource() {
      const source = {
        ...node(),
        playbackRate: {},
        start(...args) {
          this.started = args;
        },
        stop(time) {
          this.stopped = time;
        },
      };
      sources.push(source);
      return source;
    },
    createBiquadFilter: () => ({ ...node(), frequency: {}, Q: {} }),
    createGain: () => ({ ...node(), gain: {} }),
    createStereoPanner: () => ({ ...node(), pan: {} }),
  };
}

test('a recorded missile remains audible in a full rifle pool with at most 44 voices and idempotent cleanup of a cancelled delayed sound', () => {
  const audio = new GameAudio(),
    context = sampleContext();
  audio.context = context;
  audio.unlock(context);
  audio.buffers = { rifle: [{}], ballisticLaunch: [{}] };
  for (let i = 0; i < 44; i++) audio.sample('rifle', 0, 0, 1, { delay: 1 });
  const first = context.sources[0];
  assert.equal(audio.voices, 44);
  assert.equal(first.started[0], 4);
  audio.sample('ballisticLaunch', 500, 0, 1);
  assert.equal(first.stopped, 3, 'cancel the old sound even when it has not started yet');
  assert.equal(audio.voices, 44);
  assert.equal(audio.activeSamples.size, 44);
  assert.ok([...audio.activeSamples].some((voice) => voice.name === 'ballisticLaunch'));
  first.onended();
  first.onended();
  assert.equal(audio.voices, 44, 'queued native callbacks cannot decrement the pool twice');
  const count = context.sources.length;
  audio.sample('rifle', 0, 0, 1);
  assert.equal(context.sources.length, count, 'ordinary full-pool shots allocate no audio nodes');
  for (const voice of [...audio.activeSamples]) voice.source.onended();
  assert.equal(audio.voices, 0);
  assert.equal(audio.activeSamples.size, 0);
});

test('an inaudible far launch cannot evict an audible rifle and a full priority pool stays bounded', () => {
  const audio = new GameAudio(),
    context = sampleContext();
  audio.context = context;
  audio.unlock(context);
  audio.buffers = { rifle: [{}], rocketLaunch: [{}] };
  for (let i = 0; i < 44; i++) audio.sample('rifle', 0, 0, 1);
  audio.sample('rocketLaunch', 1e9, 0, 1);
  assert.equal(context.sources[0].stopped, undefined);
  for (let i = 0; i < 80; i++) audio.sample('rocketLaunch', 0, 0, 1);
  assert.equal(audio.voices, 44);
  assert.equal(audio.activeSamples.size, 44);
  assert.ok([...audio.activeSamples].every((voice) => voice.priority));
});

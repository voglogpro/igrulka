import test from 'node:test';
import assert from 'node:assert/strict';
import { heavyMix, distantLoopMix, BurstBudget } from '../../src/audio/battle-mix.js';
import { distanceMix, GameAudio } from '../../src/audio/game-audio.js';

test('major distant volleys preserve low-frequency reach without lifting rifle background', () => {
  for (const d of [0, 250, 1000, 4000, 5000]) {
    const mix = heavyMix(d);
    assert.ok(Object.values(mix).every(Number.isFinite));
    assert.ok(mix.dry <= 0.78 && mix.cutoff >= 480 && mix.delay <= 1.8);
  }
  assert.ok(heavyMix(5000).dry > 0.08);
  assert.ok(heavyMix(4000).dry > distanceMix(4000).dry * 5);
  assert.ok(heavyMix(4000).cutoff < heavyMix(1000).cutoff);
  assert.ok(heavyMix(4000).echo > 0);
});

test('fixed airborne loop pool fades continuously to silence at the outer boundary', () => {
  assert.ok(distantLoopMix(4000, 0.001).gain > 0.001);
  assert.ok(distantLoopMix(5199, 0.001).gain < 0.00001);
  assert.equal(distantLoopMix(5200, 0.001).gain, 0);
  assert.equal(distantLoopMix(6000, 0.001).gain, 0);
  assert.ok(distantLoopMix(4000, 0.001, 1200).cutoff <= 1200);
});

test('burst admission reserves room for four major events and bounds delayed voices', () => {
  const budget = new BurstBudget();
  assert.equal(Array.from({ length: 20 }, () => budget.take(1)).filter(Boolean).length, 8);
  assert.equal(Array.from({ length: 20 }, () => budget.take(1, true)).filter(Boolean).length, 4);
  assert.equal(budget.take(1.11, true), true);
  budget.reset();
  assert.equal(budget.take(1.11, true), true);
});

test('launch throttles are per family and drone uses an existing recorded source', () => {
  const audio = new GameAudio(),
    calls = [];
  audio.context = { currentTime: 1 };
  audio.activated = true;
  audio.sample = (...args) => calls.push(args);
  for (const key of ['drone', 'cruise', 'ballistic', 'cruise']) audio.play({ type: 'launch', key });
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['rocketLaunch', 'cruiseLaunch', 'ballisticLaunch'],
  );
});

test('mute cancels scheduled voices idempotently and clears transport budget', () => {
  const audio = new GameAudio();
  let stopped = 0,
    finished = 0;
  audio.context = { currentTime: 1 };
  const voice = {
    source: {
      stop() {
        stopped++;
      },
    },
    finish() {
      finished++;
      audio.activeSamples.delete(voice);
      audio.voices--;
    },
  };
  audio.activeSamples.add(voice);
  audio.voices = 1;
  audio.burst.take(1, true);
  audio.set(false);
  audio.set(false);
  assert.equal(stopped, 1);
  assert.equal(finished, 1);
  assert.equal(audio.voices, 0);
  assert.equal(audio.burst.total, 0);
});

test('outdoor reflection graph has exactly two feed-forward taps and replaces tails on transport clear', () => {
  const nodes = [],
    edges = [];
  const node = (kind) => {
    const n = {
      kind,
      delayTime: {},
      frequency: {},
      gain: {},
      connect(to) {
        edges.push([n, to]);
      },
      disconnect() {
        n.disconnected = true;
      },
    };
    nodes.push(n);
    return n;
  };
  const audio = new GameAudio();
  audio.context = {
    currentTime: 0,
    createDelay: () => node('delay'),
    createBiquadFilter: () => node('filter'),
    createGain: () => node('gain'),
  };
  audio.echoIn = node('input');
  audio.heavyEchoIn = node('heavyInput');
  audio.dry = node('output');
  audio.master = node('master');
  audio.reverbIn = node('reverb');
  audio.resetEcho();
  const old = [...audio.echoNodes];
  assert.deepEqual(
    old.filter((n) => n.kind === 'delay').map((n) => n.delayTime.value),
    [0.46, 0.38, 0.83],
  );
  assert.equal(old.length, 9);
  assert.ok(
    !edges.some(([from, to]) => old.slice(3).includes(from) && to.kind === 'delay'),
    'heavy taps have no feedback accumulation',
  );
  audio.clearBattleAudio();
  assert.ok(old.every((n) => n.disconnected));
  assert.equal(audio.echoNodes.length, 9);
  assert.ok(audio.echoNodes.every((n) => !old.includes(n)));
});

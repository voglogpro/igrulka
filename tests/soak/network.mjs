import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync, deflateRawSync } from 'node:zlib';
import * as E from '../../src/game/index.js';
import { NETWORK_GROUND_PER_CITY as GROUND_LIMIT } from '../support/network-load.mjs';
import {
  playerView,
  compactPlayerView,
  snapshotPlayerView,
} from '../../src/network/perspective.js';
import { createSnapshotEncoder, createSnapshotDecoder } from '../../src/network/snapshots.js';
import { loadFixture } from '../support/network-load.mjs';

const options = { seconds: 10, air: [10, 20, 100], prefix: 'network8102' };
for (const argument of process.argv.slice(2)) {
  if (/^--seconds=\d+$/.test(argument)) options.seconds = Number(argument.slice(10));
  else if (/^--air=\d+(,\d+)*$/.test(argument))
    options.air = argument.slice(6).split(',').map(Number);
  else if (/^--report-prefix=[a-zA-Z0-9_-]{1,64}$/.test(argument))
    options.prefix = argument.slice(16);
  else throw Error('Unsupported network benchmark argument');
}
assert.ok(options.seconds >= 1 && options.seconds <= 30);
assert.ok(options.air.every((n) => n > 0 && n <= 480));
assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(options.prefix));
const baselineURL = new URL('../../artifacts/qa/perspective-baseline.mjs', import.meta.url);
const legacy = existsSync(baselineURL) ? (await import(baselineURL.href)).playerView : null;
const report = {
  node: process.version,
  groundLimit: GROUND_LIMIT,
  humans: [0, 2],
  stepHz: 20,
  snapshotHz: 10,
  simulationSeconds: options.seconds,
  fixture:
    '4 cities, 120 live ground/city, legal 64-point paths + 12 pending routes, stationary factory production, finite initial AA ammo; mid-flight drones with ten waypoint routes',
  baselineComparison: !!legacy,
  results: [],
};
const sample = (values, fn) => {
  const t = performance.now();
  const result = fn();
  values.push(performance.now() - t);
  return result;
};
function summary(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    medianMs: +sorted[Math.floor(sorted.length * 0.5)].toFixed(3),
    p95Ms: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(3),
  };
}
function paired(a, b, n = 12) {
  const av = [],
    bv = [];
  for (let i = 0; i < 4; i++) {
    a();
    b();
  }
  for (let i = 0; i < n; i++) {
    if (i % 2) {
      sample(av, a);
      sample(bv, b);
    } else {
      sample(bv, b);
      sample(av, a);
    }
  }
  return { before: summary(av), after: summary(bv) };
}
function metric() {
  return { raw: 0, gzip1: 0, deflate1: 0, frames: 0 };
}
function add(target, json, gzip, deflate) {
  target.raw += Buffer.byteLength(json);
  target.gzip1 += gzip.length;
  target.deflate1 += deflate.length;
  target.frames++;
}

for (const air of options.air) {
  const s = loadFixture(air),
    before = E.save(s);
  assert.equal(s.groundUnits.length, 4 * GROUND_LIMIT);
  assert.equal(
    s.buildings.reduce((sum, b) => sum + (b.armyQueue?.length || 0), 0),
    0,
  );
  for (let side = 0; side < 4; side++)
    if (legacy) assert.deepEqual(playerView(s, side), legacy(s, side));
  assert.equal(E.save(s), before);
  const initial = playerView(s, 0),
    initialCompact = compactPlayerView(s, 0);
  const initialJSON = JSON.stringify(initial),
    compactJSON = JSON.stringify(initialCompact);
  const result = {
    air,
    ground: s.groundUnits.length,
    initial: {
      authorityBytes: Buffer.byteLength(before),
      fullBytes: Buffer.byteLength(initialJSON),
      fullGzip1: gzipSync(initialJSON, { level: 1 }).length,
      compactBytes: Buffer.byteLength(compactJSON),
      compactGzip1: gzipSync(compactJSON, { level: 1 }).length,
    },
    twoHumanProjection: legacy
      ? paired(
          () => [0, 2].map((side) => legacy(s, side)),
          () => [0, 2].map((side) => playerView(s, side)),
        )
      : null,
    full: metric(),
    delta: metric(),
    initialWire: [],
    timings: {},
    checks: {
      fullContractAllFourViews: !!legacy,
      decodedSnapshots: 0,
      exactBudgetsAndHp: true,
      groundCap: true,
    },
    peaks: { projectiles: 0, events: 0, air: air },
  };
  const encoders = [createSnapshotEncoder(), createSnapshotEncoder()],
    decoders = [createSnapshotDecoder(), createSnapshotDecoder()];
  const meters = Object.fromEntries(
    [
      'step',
      'fullViewPair',
      'compactViewPair',
      'snapshotViewPair',
      'codecPair',
      'decodePair',
      'jsonFullPair',
      'jsonDeltaPair',
      'gzipFullPair',
      'gzipDeltaPair',
      'deflateFullPair',
      'deflateDeltaPair',
    ].map((key) => [key, []]),
  );
  const ticks = options.seconds * 20;
  for (let tick = 0; tick <= ticks; tick++) {
    if (tick) sample(meters.step, () => E.step(s, 0.05));
    result.peaks.projectiles = Math.max(result.peaks.projectiles, s.projectiles.length);
    result.peaks.events = Math.max(result.peaks.events, s.events.length);
    if (tick % 2) continue;
    const pair = Object.fromEntries(
      Object.keys(meters)
        .filter((key) => key !== 'step')
        .map((key) => [key, []]),
    );
    for (const [index, side] of [0, 2].entries()) {
      const full = sample(pair.fullViewPair, () => playerView(s, side));
      const compact = sample(pair.compactViewPair, () => compactPlayerView(s, side));
      const borrowed = sample(pair.snapshotViewPair, () => snapshotPlayerView(s, side));
      const fullJSON = sample(pair.jsonFullPair, () => JSON.stringify({ state: full }));
      const encoded = sample(pair.codecPair, () => encoders[index].encode(borrowed));
      const deltaJSON = sample(pair.jsonDeltaPair, () => JSON.stringify(encoded));
      const wire = JSON.parse(deltaJSON),
        decoded = sample(pair.decodePair, () => decoders[index].decode(wire));
      assert.equal(decoded.sides[0].credits, s.sides[side].credits);
      assert.equal(decoded.sides[0].materials, s.sides[side].materials);
      for (const u of decoded.groundUnits)
        assert.equal(u.hp, s.groundUnits.find((v) => v.id === u.id).hp);
      if (tick % 20 === 0 || tick === ticks)
        assert.deepEqual(decoded, createSnapshotEncoder().encode(compact).state);
      result.checks.decodedSnapshots++;
      const fg = sample(pair.gzipFullPair, () => gzipSync(fullJSON, { level: 1 })),
        dg = sample(pair.gzipDeltaPair, () => gzipSync(deltaJSON, { level: 1 }));
      const fd = sample(pair.deflateFullPair, () => deflateRawSync(fullJSON, { level: 1 })),
        dd = sample(pair.deflateDeltaPair, () => deflateRawSync(deltaJSON, { level: 1 }));
      if (tick === 0)
        result.initialWire.push({
          side,
          full: { raw: Buffer.byteLength(fullJSON), gzip1: fg.length, deflate1: fd.length },
          delta: { raw: Buffer.byteLength(deltaJSON), gzip1: dg.length, deflate1: dd.length },
        });
      else {
        add(result.full, fullJSON, fg, fd);
        add(result.delta, deltaJSON, dg, dd);
      }
    }
    for (const [key, values] of Object.entries(pair))
      meters[key].push(values.reduce((a, b) => a + b, 0));
    assert.ok(!s.result, 'benchmark must remain an active match');
    for (let side = 0; side < 4; side++)
      assert.ok(s.groundUnits.filter((u) => u.side === side && u.hp > 0).length <= GROUND_LIMIT);
  }
  for (const [key, values] of Object.entries(meters)) result.timings[key] = summary(values);
  result.shots = s.stats.shots;
  result.hits = s.stats.hits;
  result.airRemaining = s.units.length;
  result.full.deflateKiBPerSecond = +(result.full.deflate1 / options.seconds / 1024).toFixed(2);
  result.delta.deflateKiBPerSecond = +(result.delta.deflate1 / options.seconds / 1024).toFixed(2);
  result.deltaDeflateReduction = +(1 - result.delta.deflate1 / result.full.deflate1).toFixed(4);
  assert.ok(result.shots > 0, 'the AA fixture must actually fire');
  assert.ok(result.peaks.projectiles > 0, 'projectile churn must be measured');
  report.results.push(result);
  console.log(JSON.stringify(result));
}
mkdirSync(new URL('../../artifacts/qa/', import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../../artifacts/qa/${options.prefix}.json`, import.meta.url),
  JSON.stringify(report, null, 2),
);

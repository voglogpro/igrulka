import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(import.meta.url),
  root = path.resolve(path.dirname(here), '../..');
const seconds = Number(process.argv.find((v) => v.startsWith('--seconds='))?.split('=')[1] || 10);
assert.ok(Number.isInteger(seconds) && seconds >= 2 && seconds <= 60);
const percentile = (values, p) =>
  values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];

if (process.argv.includes('--measure')) {
  const target = process.argv[process.argv.indexOf('--measure') + 1];
  const E = await import(pathToFileURL(path.join(target, 'src/game/index.js')).href);
  const { loadFixture } = await import(
    pathToFileURL(path.join(target, 'tests/support/network-load.mjs')).href
  );
  const warm = loadFixture(100);
  for (let i = 0; i < 30; i++) E.step(warm, 0.05);
  const s = loadFixture(100),
    timings = [];
  let rss = process.memoryUsage().rss,
    projectilePeak = 0;
  const start = performance.now();
  for (let tick = 0; tick < seconds * 20; tick++) {
    const at = performance.now();
    E.step(s, 0.05);
    timings.push(performance.now() - at);
    projectilePeak = Math.max(projectilePeak, s.projectiles.length);
    if (tick % 10 === 0) rss = Math.max(rss, process.memoryUsage().rss);
  }
  console.log(
    JSON.stringify({
      seconds,
      steps: timings.length,
      wallSeconds: (performance.now() - start) / 1000,
      stepMedianMs: percentile(timings, 0.5),
      stepP95Ms: percentile(timings, 0.95),
      rssPeakMiB: rss / 1048576,
      initial: { ground: 480, air: 100, cities: 4 },
      remaining: { ground: s.groundUnits.length, air: s.units.length },
      projectilePeak,
      shots: s.stats.shots,
      hits: s.stats.hits,
      interceptions: s.stats.interceptions,
      budgets: s.sides.map((f) => ({ credits: f.credits, materials: f.materials, oil: f.oil })),
    }),
  );
} else {
  const baseline = process.argv.find((v) => v.startsWith('--baseline-root='))?.slice(16),
    results = {};
  // Run engines in separate processes: duplicate imported graphs and their caches
  // must not inflate memory or warm one candidate more than the other.
  for (const [label, target] of [
    ...(baseline ? [['baseline', path.resolve(baseline)]] : []),
    ['candidate', root],
  ]) {
    const out = execFileSync(
      process.execPath,
      ['--max-old-space-size=768', here, '--measure', target, `--seconds=${seconds}`],
      { encoding: 'utf8', timeout: 180000, windowsHide: true },
    );
    results[label] = JSON.parse(out);
    console.log(JSON.stringify({ label, ...results[label] }));
  }
  mkdirSync(path.join(root, 'artifacts/qa'), { recursive: true });
  writeFileSync(
    path.join(root, 'artifacts/qa/performance811.json'),
    JSON.stringify(results, null, 2),
  );
}

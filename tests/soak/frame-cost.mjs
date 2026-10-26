import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(here), '../..');
const option = (name, fallback) =>
  process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const count = Number(option('count', 90));
const seconds = Number(option('seconds', 30));
const buildingCount = Number(option('buildings', 0));
const scenario = option('scenario', 'battle');
const endurance = process.argv.includes('--endurance');
assert.ok(Number.isInteger(count) && count > 0 && count <= 2000);
assert.ok(Number.isInteger(seconds) && seconds >= 2 && seconds <= 120);
assert.ok(Number.isInteger(buildingCount) && buildingCount >= 0 && buildingCount <= 2000);
assert.ok(['battle', 'defend'].includes(scenario));
const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
function summarize(timings) {
  const sorted = timings.map((v) => v.ms).sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.at(-1),
    over50Ms: sorted.filter((v) => v > 50).length,
    over100Ms: sorted.filter((v) => v > 100).length,
  };
}

if (option('measure', null)) {
  const target = path.resolve(option('measure', root));
  const E = await import(pathToFileURL(path.join(target, 'src/game/index.js')).href);
  const s = E.createGame(811);
  s.rules.oil = false;
  s.rules.rear = false;
  for (const side of s.sides) {
    side.credits = 1000000;
    side.materials = 10000;
  }
  for (const ai of [s.ai, ...Object.values(s.aiBySide || {})])
    ai.nextBuild = ai.nextAttack = ai.nextArmy = 1e9;
  // Optional isolated stress city. Buildings are the same on both banks and
  // stay outside the corridor firefight; they still incur normal city work.
  for (let i = 0; i < buildingCount; i++) {
    const side = i % 2,
      j = Math.floor(i / 2),
      d = E.BUILDINGS.housing;
    s.buildings.push({
      id: s.nextId++,
      side,
      key: 'housing',
      x: (side ? 1 : -1) * (750 + (j % 10) * 100),
      z: -1500 + Math.floor(j / 10) * 120,
      hp: d.hp,
      maxHp: d.hp,
      progress: 1,
      queue: [],
      armyQueue: [],
      cooldown: 0,
      rotation: 0,
    });
  }
  const roster = ['infantry', 'infantry', 'machinegunner', 'infantry', 'atgm', 'leopard', 'shilka'];
  for (let side = 0; side < (scenario === 'battle' ? 2 : 1); side++)
    for (let i = 0; i < count; i++) {
      const battle = scenario === 'battle',
        sign = side ? 1 : -1,
        u = E.makeGround(
          s,
          side,
          roster[i % roster.length],
          sign * ((battle ? 60 : 1050) + Math.floor(i / 20) * (battle ? 12 : 10)),
          (battle ? -1350 : -300) + ((i % 20) - 10) * 10,
        );
      // Explicitly labelled endurance mode keeps both armies alive through
      // long stress runs. Normal mode uses the actual game HP and ammunition.
      if (endurance) u.hp = u.maxHp *= 20;
      if (battle) {
        u.guard = { x: u.x, z: u.z };
        u.order = { mode: 'guard', x: u.x, z: u.z };
        u.guardNextThink = 0;
        u.setup = 1;
      }
      s.groundUnits.push(u);
    }
  const setupStart = performance.now();
  if (scenario === 'defend')
    E.applyStance(
      s,
      0,
      s.groundUnits.map((u) => u.id),
      { mode: 'defend', post: 'auto' },
    );
  const setupMs = performance.now() - setupStart;
  const timings = [],
    started = performance.now();
  for (let i = 0; i < seconds * 20; i++) {
    const at = performance.now();
    const cpuStart = process.cpuUsage();
    E.step(s, 0.05);
    const cpu = process.cpuUsage(cpuStart);
    timings.push({
      tick: i,
      time: s.time,
      ms: performance.now() - at,
      cpuMs: (cpu.user + cpu.system) / 1000,
    });
  }
  console.log(
    JSON.stringify({
      target,
      countPerSide: count,
      scenario,
      seconds,
      addedBuildings: buildingCount,
      enduranceHpMultiplier: endurance ? 20 : 1,
      setupMs,
      wallMs: performance.now() - started,
      coldFirstStepMs: timings[0].ms,
      all: summarize(timings),
      // Exclude the first second; periodic think/repath pulses remain measured.
      warm: summarize(timings.slice(20)),
      // Wall time also includes OS scheduling pauses on a shared laptop.
      // Process CPU samples help distinguish those from a simulation spike;
      // parallel V8 compilation/GC can make a CPU sample exceed wall time.
      warmCpu: summarize(timings.slice(20).map((t) => ({ ms: t.cpuMs }))),
      worst: timings
        .slice()
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 12),
      remaining: s.groundUnits.length,
      stateHash: createHash('sha256').update(JSON.stringify(s)).digest('hex'),
    }),
  );
} else {
  const baseline = option('baseline-root', null);
  const result = {};
  for (const [label, target] of [
    ...(baseline ? [['baseline', path.resolve(baseline)]] : []),
    ['candidate', root],
  ]) {
    const out = execFileSync(
      process.execPath,
      [
        '--max-old-space-size=768',
        here,
        `--measure=${target}`,
        `--count=${count}`,
        `--seconds=${seconds}`,
        `--buildings=${buildingCount}`,
        `--scenario=${scenario}`,
        ...(endurance ? ['--endurance'] : []),
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 240000 },
    );
    result[label] = JSON.parse(out);
    console.log(JSON.stringify({ label, ...result[label] }));
  }
  if (result.baseline) assert.equal(result.candidate.stateHash, result.baseline.stateHash);
  mkdirSync(path.join(root, 'artifacts/qa'), { recursive: true });
  writeFileSync(
    path.join(root, `artifacts/qa/frame-cost-${scenario}-${count}-${buildingCount}.json`),
    JSON.stringify(result, null, 2),
  );
}

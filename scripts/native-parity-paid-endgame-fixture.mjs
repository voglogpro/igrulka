import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../src/game/index.js';
import { executeCommand } from '../src/network/commands.js';
import { warshipOf } from '../src/game/city/naval.js';

// CPU lineage only: native acceptance must execute the separate browser helper.
// Importing this module prints its plan; simulation requires explicit --run.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.join(root, 'artifacts/native');

const plan = {
  scope: 'Paid source-command endgame/ruins integration with idle second human',
  input: 'paid-advanced-complete.json',
  outputs: [
    'paid-endgame-prefinish.json',
    'paid-endgame-complete.json',
    'paid-endgame-report.json',
  ],
  sourceOnly: true,
  networkClaim: false,
  grants: false,
  run: 'node scripts/native-parity-paid-endgame-fixture.mjs --run',
  ruinMethod:
    'Pay for an isolated own MOG building, then manufacture/deliver/launch a real cruise missile at its coordinates. Source point targeting/friendly fire and applyBlast create the ruin; no manual HP changes.',
};
export async function preparePaidEndgame() {
  await mkdir(directory, { recursive: true });
  const raw = await readFile(path.join(directory, 'paid-advanced-complete.json'), 'utf8');
  const parent = JSON.parse(
    await readFile(path.join(directory, 'paid-advanced-report.json'), 'utf8'),
  );
  const inputHash = createHash('sha256').update(raw).digest('hex');
  assert.equal(parent.ok, true);
  assert.equal(
    inputHash,
    parent.checkpoints.find((c) => c.file.endsWith('paid-advanced-complete.json')).sha256,
  );
  const state = E.load(raw),
    started = performance.now(),
    ledger = [],
    stages = [],
    hits = [],
    events = [],
    checkpoints = [];
  assert.deepEqual(E.aiSides(state), []);
  assert.equal(state.result, null);
  const hq = state.buildings.find((b) => b.side === 0 && b.key === 'hq'),
    enemy = state.buildings.find((b) => b.side === 1 && b.key === 'hq'),
    base = state.buildings.find((b) => b.id === parent.ids.navalbase),
    factory = state.buildings.find((b) => b.id === parent.ids.factory);
  let ownRuin = null,
    lastEvent = 0,
    steps = 0,
    stage = 'start';
  const resources = () =>
    Object.fromEntries(
      ['credits', 'materials', 'oil', 'components'].map((k) => [k, state.sides[0][k] || 0]),
    );
  const command = (type, payload) => {
    const before = resources(),
      result = executeCommand(state, 0, type, payload);
    assert.notEqual(typeof result, 'string', `${stage}/${type}: ${result}`);
    assert.notEqual(result, false);
    const after = resources();
    ledger.push({
      time: state.time,
      type,
      payload,
      result: typeof result === 'object' ? { id: result.id } : result,
      before,
      after,
      spent: Object.fromEntries(Object.keys(before).map((k) => [k, before[k] - after[k]])),
    });
    return result;
  };
  const tick = () => {
    const before = { enemy: enemy.hp, own: ownRuin?.hp };
    E.step(state, 0.05);
    steps++;
    if (enemy.hp !== before.enemy)
      hits.push({ time: state.time, targetId: enemy.id, before: before.enemy, after: enemy.hp });
    if (ownRuin && ownRuin.hp !== before.own)
      hits.push({ time: state.time, targetId: ownRuin.id, before: before.own, after: ownRuin.hp });
    for (const e of state.events)
      if (e.id > lastEvent) {
        lastEvent = e.id;
        if (['produced', 'launch', 'salvo', 'impact', 'destroy', 'result'].includes(e.type))
          events.push({ ...e });
      }
    assert.ok(state.time < 5000, 'Bounded source endgame scenario');
    assert.ok(hq.hp > 0, 'Own real HQ must survive');
  };
  const until = async (predicate, name, seconds = 360) => {
    stage = name;
    const end = state.time + seconds;
    while (!predicate()) {
      if (state.time >= end || state.result)
        throw Error(
          'Source wait failed: ' +
            name +
            ' ' +
            JSON.stringify({
              time: state.time,
              result: state.result,
              enemyHp: enemy.hp,
              ownRuinHp: ownRuin?.hp,
              resources: resources(),
              baseStock: base.launchStore,
              ships: state.warships,
            }),
        );
      tick();
      if (steps % 1000 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    stages.push({ stage: name, time: state.time, resources: resources(), enemyHp: enemy.hp });
    console.log(JSON.stringify({ kind: 'cpu-stage', stage: name, time: state.time, steps }));
  };
  const funds = async (cost, metal = 0, components = 0, oil = 0) =>
    until(
      () =>
        state.sides[0].credits >= cost &&
        state.sides[0].materials >= metal &&
        state.sides[0].components >= components &&
        state.sides[0].oil >= oil,
      'ordinary-earned-funds',
      600,
    );
  const checkpoint = async (name) => {
    const text = E.save(state),
      restored = E.load(text);
    assert.equal(restored.result, state.result);
    assert.equal(restored.buildings.find((b) => b.id === enemy.id).hp, enemy.hp);
    assert.equal(restored.buildings.find((b) => b.id === ownRuin.id).hp, ownRuin.hp);
    assert.equal(restored.sides[0].credits, state.sides[0].credits);
    await writeFile(path.join(directory, name), text, 'utf8');
    const item = {
      file: 'artifacts/native/' + name,
      sha256: createHash('sha256').update(text).digest('hex'),
      time: state.time,
      result: state.result,
      enemyHp: enemy.hp,
      ruinId: ownRuin.id,
      ruinHp: ownRuin.hp,
      resources: resources(),
      magazine: E.availableLaunchStock(base, 'cruise'),
    };
    checkpoints.push(item);
    return item;
  };
  const points = [];
  for (let z = 300; z <= 540; z += 40)
    for (let x = hq.x - 220; x <= hq.x - 100; x += 40) points.push({ x, z });
  const point = points.find(
    (p) =>
      !E.canPlace(state, 'gun', p.x, p.z, 0) &&
      state.buildings.every((b) => Math.hypot(b.x - p.x, b.z - p.z) > 90) &&
      state.roads.every((r) => E.segmentDistance(p.x, p.z, r.ax, r.az, r.bx, r.bz) > 70),
  );
  assert.ok(point, 'An isolated valid paid MOG plot exists away from city/roads');
  const quote = E.purchaseQuote(state, 0, 'building', 'gun');
  await funds(quote.cost, quote.metal, quote.components || 0);
  ownRuin = command('build', { key: 'gun', x: point.x, z: point.z, rotation: 0 });
  await until(() => ownRuin.progress === 1, 'paid-isolated-mog-construction', 90);
  assert.ok(Math.abs(ownRuin.hp - ownRuin.maxHp) < 1e-6);
  command('launch-supply', { id: base.id, key: 'cruise', count: 1 });
  const weapon = E.WEAPONS.cruise;
  const readyMissile = async () => {
    await funds(weapon.cost, weapon.metal, weapon.components, E.oilCost('cruise'));
    const before = resources();
    assert.equal(command('produce', { key: 'cruise' }), true);
    const after = resources();
    assert.equal(before.credits - after.credits, weapon.cost);
    assert.equal(before.materials - after.materials, weapon.metal);
    assert.equal(before.oil - after.oil, E.oilCost('cruise'));
    assert.equal(before.components - after.components, weapon.components);
    await until(
      () => E.availableLaunchStock(base, 'cruise') === 1,
      'paid-cruise-manufacture-and-physical-delivery',
    );
    const ship = warshipOf(state, base);
    assert.ok(ship && E.isWater(ship.x, ship.z));
    await until(() => ship.state === 'station', 'paid-loaded-ship-station', 180);
    return ship;
  };
  const launch = async (aim, target) => {
    const ship = warshipOf(state, base),
      before = new Set(state.units.map((u) => u.id));
    assert.equal(E.availableLaunchStock(base, 'cruise'), 1);
    assert.equal(command('launch', { key: 'cruise', count: 1, siteId: base.id, aim }), 1);
    const missile = state.units.find((u) => !before.has(u.id));
    assert.ok(missile && Math.hypot(missile.startX - ship.x, missile.startZ - ship.z) < 1e-6);
    assert.equal(E.availableLaunchStock(base, 'cruise'), 0);
    const oldHp = target.hp;
    await until(() => target.hp < oldHp, 'actual-paid-cruise-impact', 120);
    return missile;
  };
  await readyMissile();
  await launch({ x: ownRuin.x, z: ownRuin.z }, ownRuin);
  assert.equal(ownRuin.hp, 0, 'A real paid friendly-fire strike created owned ruins');
  assert.notEqual(ownRuin.demolished, true);
  const effectiveDamage =
    E.weaponStats(state.sides[0], 'cruise').damage * E.weaponPerformance(state, 0);
  let precedingAttacks = 0;
  while (enemy.hp > effectiveDamage + 1e-6) {
    await readyMissile();
    await launch({ x: enemy.x, z: enemy.z }, enemy);
    precedingAttacks++;
    assert.ok(precedingAttacks < 8);
  }
  await readyMissile();
  assert.ok(enemy.hp > 0 && enemy.hp <= effectiveDamage + 1e-6 && state.result === null);
  const prefinish = await checkpoint('paid-endgame-prefinish.json');
  await launch({ x: enemy.x, z: enemy.z }, enemy);
  // E.step determines the winner in the same actual impact step.
  assert.equal(enemy.hp, 0);
  assert.equal(state.result, 'victory');
  assert.equal(state.winnerTeam, 0);
  const finished = await checkpoint('paid-endgame-complete.json');
  const report = {
    ok: true,
    ...plan,
    parent: {
      input: 'artifacts/native/paid-advanced-complete.json',
      sha256: inputHash,
      sourceOnly: parent.sourceOnly,
      sourceCommands: parent.ledger.length,
    },
    ids: {
      ownHQ: hq.id,
      enemyHQ: enemy.id,
      ruin: ownRuin.id,
      factory: factory.id,
      navalbase: base.id,
    },
    target: { x: enemy.x, z: enemy.z },
    effectiveDamage,
    precedingAttacks,
    checkpoints,
    ledger,
    stages,
    hits,
    events,
    simulationSteps: steps,
    simulationTime: state.time,
    wallSeconds: (performance.now() - started) / 1000,
    prefinish,
    finished,
    limitations: [
      'Original offline multiplayer-mode city with idle second human; not a public-network or balance test.',
      'One explicitly labelled paid friendly-fire mission creates the own ruin for the inspector test.',
      'No direct HP/result/resource/position/speed/queue grants; all simulation changes are source commands and E.step.',
      'CPU logic/save proof only; native result/inspector acceptance must run separately.',
    ],
  };
  await writeFile(
    path.join(directory, 'paid-endgame-report.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        ids: report.ids,
        prefinish,
        finished,
        precedingAttacks,
        effectiveDamage,
        steps,
        wallSeconds: report.wallSeconds,
      },
      null,
      2,
    ),
  );
}
if (process.argv.includes('--run')) await preparePaidEndgame();
else console.log(JSON.stringify(plan, null, 2));

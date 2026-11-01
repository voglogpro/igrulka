import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../src/game/index.js';
import { executeCommand } from '../src/network/commands.js';
import { physicalPlacement } from '../src/game/city/construction.js';
import { warshipOf } from '../src/game/city/naval.js';

// This file is safe to inspect/import: the potentially long original simulation
// runs ONLY when explicitly invoked with --run, after concurrent GPU QA ends.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.join(root, 'artifacts/native');
const plan = {
  scenario: 'Paid advanced integration fixture with an idle second human city',
  gameMode: 'multiplayer',
  networkClaim: false,
  syntheticVisualFixture: false,
  sourceOnly:
    'Original createGame, executeCommand, E.step and save/load; no entity/resource/HP/speed grants',
  checkpoints: [
    'paid-advanced-ready.json',
    'paid-advanced-boarded.json',
    'paid-advanced-complete.json',
  ],
  stages: [
    'paid connected economy and original construction times',
    'paid barracks/APC recruitment and wait rally',
    'actual board -> move -> unload -> reboard -> deliver',
    'coastal paid port/naval base and merchant trips',
    'paid cruise queue -> factory warehouse -> physical cargo -> ship magazine',
    'actual ship launch origin/stock use -> empty ship return',
  ],
  run: 'node scripts/native-parity-paid-advanced-fixture.mjs --run',
  warning:
    'Prepared helper is not a passed CPU/native test until its real execution report exists. No simulation is performed without --run.',
};

export async function preparePaidAdvanced() {
  const state = E.createGame(8162801, { mode: 'multiplayer', difficulty: 'normal' });
  const started = performance.now();
  const ledger = [],
    stages = [],
    observed = { merchantStates: [], warshipStates: [], events: [], weaponCargo: [] };
  const merchantStates = new Set(),
    warshipStates = new Set(),
    cargo = new Map();
  const ids = {},
    hq = state.buildings.find((b) => b.side === 0 && b.key === 'hq');
  let steps = 0,
    lastEvent = 0,
    currentStage = 'initial';
  const resources = () =>
    Object.fromEntries(
      ['credits', 'materials', 'oil', 'components'].map((key) => [key, state.sides[0][key] || 0]),
    );
  assert.deepEqual(
    E.aiSides(state),
    [],
    'Use original idle-human mode; never edit AI timers/rules',
  );
  assert.deepEqual(resources(), { credits: 3200, materials: 200, oil: 150, components: 0 });
  const command = (type, payload) => {
    const before = resources();
    const result = executeCommand(state, 0, type, payload);
    assert.notEqual(typeof result, 'string', `${currentStage}/${type}: ${result}`);
    assert.notEqual(result, false, `${currentStage}/${type} refused`);
    const after = resources();
    ledger.push({
      time: state.time,
      type,
      payload,
      result: typeof result === 'object' ? { id: result.id } : result,
      before,
      after,
      spent: Object.fromEntries(Object.keys(before).map((key) => [key, before[key] - after[key]])),
    });
    return result;
  };
  const observe = () => {
    for (const ship of state.ships) if (ship.side === 0) merchantStates.add(ship.state);
    for (const ship of state.warships) if (ship.side === 0) warshipStates.add(ship.state);
    for (const entry of state.events)
      if (entry.id > lastEvent) {
        lastEvent = entry.id;
        if (['produced', 'trade', 'cargo', 'launch', 'salvo', 'shipLaunched'].includes(entry.type))
          observed.events.push({ ...entry });
      }
    for (const vehicle of state.ammoVehicles) {
      if (vehicle.side !== 0 || vehicle.cargo?.kind !== 'weapon' || vehicle.cargo.key !== 'cruise')
        continue;
      let trip = cargo.get(vehicle.id);
      if (!trip)
        cargo.set(
          vehicle.id,
          (trip = {
            id: vehicle.id,
            depotId: vehicle.depotId,
            targetId: vehicle.targetId,
            key: 'cruise',
            first: { x: vehicle.x, z: vehicle.z },
            last: { x: vehicle.x, z: vehicle.z },
            statuses: new Set(),
            maximumCargo: 0,
          }),
        );
      trip.last = { x: vehicle.x, z: vehicle.z };
      trip.statuses.add(vehicle.status);
      trip.maximumCargo = Math.max(trip.maximumCargo, vehicle.cargo.amount);
    }
  };
  const tick = () => {
    E.step(state, 0.05);
    steps++;
    observe();
    assert.equal(state.result, null, 'The integration city must remain in a live match');
    assert.ok(state.time < 6000, 'Bounded integration scenario, not an infinite resource wait');
    assert.ok(Object.values(resources()).every((value) => Number.isFinite(value) && value >= 0));
  };
  const until = async (predicate, label, maximumSeconds = 900) => {
    currentStage = label;
    const deadline = state.time + maximumSeconds;
    while (!predicate()) {
      if (state.time >= deadline)
        throw Error(
          'Original simulation timed out: ' +
            label +
            '; ' +
            JSON.stringify({
              time: state.time,
              resources: resources(),
              economy: E.economy(state, 0),
            }),
        );
      tick();
      if (steps % 1000 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    stages.push({ name: label, time: state.time, resources: resources() });
  };
  const waitFunds = async (cost, metal = 0, components = 0, oil = 0) =>
    until(
      () =>
        state.sides[0].credits >= cost &&
        state.sides[0].materials >= metal &&
        state.sides[0].components >= components &&
        state.sides[0].oil >= oil,
      'ordinary earned resources for next paid command',
    );
  const road = async (a, b) => {
    const preview = E.roadPreview(state, 0, a.x, a.z, b.x, b.z, { ignoreCredits: true });
    assert.equal(preview.error, undefined, 'Road geometry: ' + preview.error);
    await waitFunds(preview.cost);
    return command('road', { a, b });
  };
  const make = async (key, point) => {
    assert.equal(
      E.canPlace(state, key, point.x, point.z, 0),
      null,
      'Original building placement ' + key,
    );
    const quote = E.purchaseQuote(state, 0, 'building', key),
      placement = E.placementPlan(state, 0, key, point.x, point.z);
    await waitFunds(quote.cost + (placement.driveCost || 0), quote.metal, quote.components || 0);
    const b = command('build', { key, x: point.x, z: point.z, rotation: 0 });
    await until(() => b.progress === 1, 'real construction completion: ' + key, 120);
    assert.ok(Math.abs(b.hp - b.maxHp) < 1e-6, 'HP completion comes from original construction');
    return b;
  };
  const streetEnd = { x: hq.x + 600, z: hq.z - 45 };
  await road({ x: hq.x + 90, z: hq.z - 45 }, streetEnd);
  const buildStreet = async (key, dx, dz) => {
    const candidates = [{ x: hq.x + dx, z: hq.z + dz }];
    for (let offset = -65; offset <= 550; offset += 60)
      for (const zOffset of [-10, -80]) candidates.push({ x: hq.x + offset, z: hq.z + zOffset });
    const point = candidates.find(
      (candidate) => !E.canPlace(state, key, candidate.x, candidate.z, 0),
    );
    assert.ok(point, 'A free original street-side plot exists for ' + key);
    const b = await make(key, point);
    assert.equal(
      E.supplyFactor(state, b),
      1,
      'Paid facilities must be connected, not gallery buildings',
    );
    return b;
  };
  ids.power = (await buildStreet('power', -65, -10)).id;
  ids.housing = (await buildStreet('housing', -65, -80)).id;
  ids.industry = (await buildStreet('industry', -5, -80)).id;
  ids.barracks = (await buildStreet('barracks', 65, -10)).id;
  const well = E.OIL_FIELDS.filter((field) => field.x < 0).find(
    (field) => !E.canPlace(state, 'oilwell', field.x, field.z, 0),
  );
  assert.ok(well, 'A real oil field beside the paid street is available');
  ids.oilwell = (await make('oilwell', well)).id;
  ids.vehiclebase = (await buildStreet('vehiclebase', 185, -10)).id;
  ids.factory = (await buildStreet('factory', 245, -80)).id;
  ids.power2 = (await buildStreet('power', 425, -10)).id;
  ids.housing2 = (await buildStreet('housing', 485, -80)).id;
  ids.industry2 = (await buildStreet('industry', 545, -10)).id;
  ids.electronics = (await buildStreet('electronics', 305, -10)).id;

  const buildShore = async (key, preferredZ) => {
    const candidates = [
      preferredZ,
      -preferredZ,
      preferredZ - 80,
      preferredZ + 80,
      -300,
      300,
      -450,
      450,
    ];
    let chosen;
    for (const z of candidates) {
      for (let x = -1040; x <= -680; x += 2) {
        if (physicalPlacement(state, key, x, z, 0)) continue;
        const approach = { x: x - 40, z };
        const joint = { x: streetEnd.x, z };
        const segments = [
          { a: streetEnd, b: joint },
          { a: joint, b: approach },
        ].filter(
          (segment) => Math.hypot(segment.b.x - segment.a.x, segment.b.z - segment.a.z) >= 8,
        );
        if (
          segments.some(
            (segment) =>
              E.roadPreview(state, 0, segment.a.x, segment.a.z, segment.b.x, segment.b.z, {
                ignoreCredits: true,
              }).error,
          )
        )
          continue;
        chosen = { x, z, segments };
        break;
      }
      if (chosen) break;
    }
    assert.ok(chosen, 'Physical legal coast and paid road approach: ' + key);
    for (const segment of chosen.segments) await road(segment.a, segment.b);
    return make(key, chosen);
  };
  ids.port = (await buildShore('port', -120)).id;
  ids.navalbase = (await buildShore('navalbase', 120)).id;
  const barracks = state.buildings.find((b) => b.id === ids.barracks),
    vehiclebase = state.buildings.find((b) => b.id === ids.vehiclebase);
  command('rally-mode', { id: barracks.id, mode: 'wait' });
  command('rally-mode', { id: vehiclebase.id, mode: 'wait' });
  await waitFunds(
    E.GROUND_UNITS.apc.cost + E.GROUND_UNITS.infantry.cost * 2,
    E.GROUND_UNITS.apc.metal + E.GROUND_UNITS.infantry.metal * 2,
    0,
    E.oilCost('apc'),
  );
  command('recruit', { key: 'infantry', count: 2, siteId: barracks.id });
  command('recruit', { key: 'apc', count: 1, siteId: vehiclebase.id });
  await until(
    () =>
      state.groundUnits.filter((u) => u.side === 0 && u.key === 'infantry').length === 2 &&
      state.groundUnits.some((u) => u.side === 0 && u.key === 'apc'),
    'paid infantry and APC finish normal queues',
    180,
  );
  const passengers = state.groundUnits.filter((u) => u.side === 0 && u.key === 'infantry'),
    apc = state.groundUnits.find((u) => u.side === 0 && u.key === 'apc');
  ids.passengers = passengers.map((u) => u.id);
  ids.apc = apc.id;
  assert.ok(passengers.every((u) => !u.carrierId && !u.boardingId && !u.autoDefense));
  await until(
    () =>
      state.sides[0].credits >= 1200 &&
      state.sides[0].materials >= 110 &&
      state.sides[0].components >= 20 &&
      state.sides[0].oil >= 60,
    'normal income reserves for subsequent native controls',
    1200,
  );
  const factory = state.buildings.find((b) => b.id === ids.factory),
    navalbase = state.buildings.find((b) => b.id === ids.navalbase);
  await until(
    () => state.ships.some((ship) => ship.portId === ids.port) && warshipOf(state, navalbase),
    'original source fleet appears',
    10,
  );
  const checkpoints = [];
  const checkpoint = async (name) => {
    const raw = E.save(state),
      restored = E.load(raw);
    assert.equal(restored.time, state.time);
    assert.equal(restored.rng, state.rng);
    assert.equal(restored.sides[0].credits, state.sides[0].credits);
    assert.deepEqual(
      restored.groundUnits.map((u) => ({ id: u.id, hp: u.hp, carrierId: u.carrierId || null })),
      state.groundUnits.map((u) => ({ id: u.id, hp: u.hp, carrierId: u.carrierId || null })),
    );
    const file = path.join(directory, name);
    await writeFile(file, raw, 'utf8');
    const item = {
      file: path.relative(root, file).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(raw).digest('hex'),
      time: state.time,
      resources: resources(),
      groundUnits: state.groundUnits.length,
      buildings: state.buildings.length,
    };
    checkpoints.push(item);
    return item;
  };
  await mkdir(directory, { recursive: true });
  await checkpoint('paid-advanced-ready.json');

  assert.equal(command('board', { ids: ids.passengers, id: apc.id }), 2);
  await until(
    () => passengers.every((u) => u.carrierId === apc.id),
    'infantry physically reaches and boards own APC',
    120,
  );
  await checkpoint('paid-advanced-boarded.json');
  const transferPoints = [];
  for (let z = 120; z <= 300; z += 30)
    for (let x = hq.x - 90; x <= hq.x + 210; x += 30)
      if (E.walkable(state, x, z, E.GROUND_UNITS.apc.size * 0.42)) transferPoints.push({ x, z });
  const destination = transferPoints.find(
    (point) => E.groundPath(state, apc, point, E.GROUND_UNITS.apc.size * 0.42).length,
  );
  assert.ok(destination, 'Original dry reachable transport destination exists');
  command('order', { ids: [apc.id], aim: { ...destination, mode: 'move' } });
  await until(
    () => Math.hypot(apc.x - destination.x, apc.z - destination.z) < 6 && !apc.path.length,
    'APC carries real passengers to the original destination',
    120,
  );
  assert.equal(command('stance', { ids: [apc.id], command: 'unload' }), 2);
  assert.ok(
    passengers.every(
      (u) =>
        !u.carrierId &&
        !u.boardingId &&
        E.walkable(state, u.x, u.z, E.GROUND_UNITS[u.key].size * 0.42),
    ),
  );
  assert.equal(command('board', { ids: ids.passengers, id: apc.id }), 2);
  await until(
    () => passengers.every((u) => u.carrierId === apc.id),
    'normal reboarding before delivery order',
    90,
  );
  const returnPoint = { x: hq.x + 90, z: 120 };
  assert.equal(command('deliver', { id: apc.id, point: returnPoint }), 2);
  await until(
    () => passengers.every((u) => !u.carrierId) && !apc.delivery,
    'original automatic transport delivery/unload completes',
    150,
  );

  command('launch-supply', { id: navalbase.id, key: 'cruise', count: 1 });
  const weapon = E.WEAPONS.cruise;
  await waitFunds(weapon.cost, weapon.metal, weapon.components, E.oilCost('cruise'));
  const produceBefore = resources();
  assert.equal(command('produce', { key: 'cruise' }), true);
  const produceAfter = resources();
  assert.equal(produceBefore.credits - produceAfter.credits, weapon.cost);
  assert.equal(produceBefore.materials - produceAfter.materials, weapon.metal);
  assert.equal(produceBefore.oil - produceAfter.oil, E.oilCost('cruise'));
  assert.equal(produceBefore.components - produceAfter.components, weapon.components);
  assert.ok(
    factory.queue.some((q) => q.key === 'cruise' && q.progress === 0),
    'A genuinely paid factory queue exists',
  );
  await until(
    () => E.availableLaunchStock(navalbase, 'cruise') === 1,
    'paid manufacturing then actual physical cargo reaches ship magazine',
    300,
  );
  const ship = warshipOf(state, navalbase);
  assert.ok(ship && E.isWater(ship.x, ship.z));
  await until(
    () => ship.state === 'station',
    'loaded source missile ship sails to its firing station',
    150,
  );
  const missileIds = new Set(state.units.map((u) => u.id));
  const magazineBefore = E.availableLaunchStock(navalbase, 'cruise');
  assert.equal(
    command('launch', {
      key: 'cruise',
      count: 1,
      siteId: navalbase.id,
      aim: { x: E.HQ_X - 280, z: 500 },
    }),
    1,
  );
  const missile = state.units.find((u) => !missileIds.has(u.id));
  assert.ok(missile && missile.sourceId === navalbase.id);
  assert.ok(
    Math.hypot(missile.startX - ship.x, missile.startZ - ship.z) < 1e-6,
    'Launch originates at the ship, not base',
  );
  assert.equal(E.availableLaunchStock(navalbase, 'cruise'), magazineBefore - 1);
  await until(() => ship.state === 'docked', 'empty source ship returns to berth', 150);
  await until(
    () =>
      merchantStates.has('outbound') &&
      merchantStates.has('trading') &&
      merchantStates.has('returning') &&
      observed.events.some((entry) => entry.type === 'cargo' && entry.side === 0),
    'merchant reaches island and returns goods through real port',
    180,
  );
  assert.ok(
    [...cargo.values()].some(
      (trip) =>
        trip.targetId === navalbase.id &&
        Math.hypot(trip.last.x - trip.first.x, trip.last.z - trip.first.z) > 5,
    ),
    'At least one real missile cargo vehicle moved to the base',
  );
  assert.equal(
    state.buildings.filter((b) => b.side === 1).length,
    1,
    'Dormant opponent remained a human city, no bot mutation',
  );
  assert.equal(state.groundUnits.filter((u) => u.side === 1).length, 0);
  await checkpoint('paid-advanced-complete.json');
  observed.merchantStates = [...merchantStates];
  observed.warshipStates = [...warshipStates];
  observed.weaponCargo = [...cargo.values()].map((trip) => ({
    ...trip,
    statuses: [...trip.statuses],
  }));
  const report = {
    ok: true,
    ...plan,
    seed: state.seed,
    originalSchema: state.version,
    initial: { credits: 3200, materials: 200, oil: 150, components: 0 },
    ids,
    checkpoints,
    simulationSteps: steps,
    simulationTime: state.time,
    wallSeconds: (performance.now() - started) / 1000,
    stages,
    ledger,
    observed,
    finalResources: resources(),
    limits: [
      'Offline original multiplayer-mode simulation with idle second human city; not an actual network test',
      'Earned income and normal source economy, not a balanced competitive campaign',
      'CPU logic and original save/load only; native DOM/render/audio remain separate acceptance',
    ],
  };
  await writeFile(
    path.join(directory, 'paid-advanced-report.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  );
  return report;
}

if (process.argv.includes('--run')) {
  const report = await preparePaidAdvanced();
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        ids: report.ids,
        checkpoints: report.checkpoints,
        simulationTime: report.simulationTime,
        simulationSteps: report.simulationSteps,
        wallSeconds: report.wallSeconds,
      },
      null,
      2,
    ),
  );
} else console.log(JSON.stringify(plan, null, 2));

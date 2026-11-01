// CPU-only actual ORIGINAL NetworkSession peer. Never starts a server or GPU.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';
import { NetworkSession } from '../../src/network/client.js';
import * as E from '../../src/game/index.js';
Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: WebSocket });
const storage = new Map();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (test, label, timeout = 60000) => {
  const end = performance.now() + timeout;
  while (!test()) {
    if (performance.now() > end) throw Error('Timed out: ' + label);
    await delay(35);
  }
};
const reports = [];
const reportPath = path.resolve('artifacts/native/parity-network-peer-results.json');
async function run(address, code, mode) {
  const errors = [];
  let closed = false;
  const peer = new NetworkSession({
    onError: (error) => errors.push(error),
    onClosed: () => {
      closed = true;
    },
  });
  const emit = (value) => console.log(JSON.stringify({ loopbackOnly: true, ...value }));
  try {
    await peer.connect(address, { type: 'join', code, name: 'Original Node peer ' + mode });
    assert.equal(peer.room.mode, mode);
    assert.equal(peer.side, mode === 'coop' ? 2 : 1);
    peer.send({ type: 'ready', value: true });
    emit({ stage: 'peer-ready', code, mode, side: peer.side });
    await until(
      () => peer.room?.phase === 'playing' && peer.latest?.state,
      'native original UI starts actual room',
    );
    const cityCount = mode === 'coop' ? 4 : 2,
      hostSideInPeerView = mode === 'coop' ? 2 : 1;
    assert.equal(peer.latest.state.sides.length, cityCount);
    assert.equal(peer.latest.state.buildings.filter((b) => b.key === 'hq').length, cityCount);
    const hq = peer.latest.state.buildings.find((b) => b.side === 0 && b.key === 'hq');
    const budget = peer.latest.state.sides[0].credits;
    const housing = await peer.command('build', {
      key: 'housing',
      x: hq.x + 55,
      z: hq.z - 80,
      rotation: 0,
    });
    assert.ok(housing?.id, 'Original paid housing command failed: ' + JSON.stringify(housing));
    const candidates = [
      [
        { x: hq.x + 90, z: hq.z - 45 },
        { x: hq.x + 230, z: hq.z - 45 },
      ],
      [
        { x: hq.x - 90, z: hq.z - 45 },
        { x: hq.x - 230, z: hq.z - 45 },
      ],
      [
        { x: hq.x + 90, z: hq.z + 45 },
        { x: hq.x + 230, z: hq.z + 45 },
      ],
    ];
    const road = candidates.find(
      ([a, b]) => !E.roadPreview(peer.latest.state, 0, a.x, a.z, b.x, b.z).error,
    );
    assert.ok(road, 'No legal original road plan');
    const builtRoad = await peer.command('road', { a: road[0], b: road[1] });
    assert.ok(
      builtRoad?.id && builtRoad.segments.length,
      'Original road failed: ' + JSON.stringify(builtRoad),
    );
    await until(
      () =>
        peer.latest.state.buildings.some((b) => b.id === housing.id) &&
        builtRoad.segments.every((r) => peer.latest.state.roads.some((other) => other.id === r.id)),
      'own paid work reflected by actual authoritative snapshot',
    );
    assert.ok(peer.latest.state.sides[0].credits < budget);
    await until(
      () =>
        peer.latest.state.buildings.some((b) => b.side === hostSideInPeerView && b.key === 'power'),
      'native paid power reaches original Node peer',
    );
    const hostHq = peer.latest.state.buildings.find(
      (b) => b.side === hostSideInPeerView && b.key === 'hq',
    );
    const isPaidHostRoad = (r) =>
      r.side === hostSideInPeerView &&
      Math.abs(Math.abs(r.az - hostHq.z) - 45) < 0.00001 &&
      Math.abs(r.bz - r.az) < 0.00001 &&
      Math.min(Math.abs(r.ax - hostHq.x), Math.abs(r.bx - hostHq.x)) >= 89.99 &&
      Math.max(Math.abs(r.ax - hostHq.x), Math.abs(r.bx - hostHq.x)) <= 230.01;
    await until(
      () => peer.latest.state.roads.some(isPaidHostRoad),
      'native paid road reaches original Node peer',
    );
    const nativeBuilding = peer.latest.state.buildings.find(
      (b) => b.side === hostSideInPeerView && b.key === 'power',
    );
    const nativeRoadIds = peer.latest.state.roads.filter(isPaidHostRoad).map((r) => r.id);
    const denied = await peer.command('demolish', { id: nativeBuilding.id });
    assert.equal(typeof denied, 'string');
    assert.match(denied, /принадлежит/);
    assert.deepEqual(errors, []);
    const result = {
      mode,
      code,
      cities: cityCount,
      peerSide: peer.side,
      hostSideInPeerView,
      peerBuildingId: housing.id,
      nativeBuildingId: nativeBuilding.id,
      peerRoadIds: builtRoad.segments.map((r) => r.id),
      nativeRoadIds,
      realTreasuryCharged: true,
      actualOriginalSnapshots: true,
      ownershipEnforced: true,
      simulationTime: peer.latest.state.time,
      errors,
    };
    reports.push(result);
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          passed: true,
          scope: 'Original Node NetworkSession paired with actual native DOM client; loopback only',
          modes: reports,
        },
        null,
        2,
      ) + '\n',
    );
    emit({ stage: 'peer-verified', passed: true, ...result });
    await until(() => closed || peer.intentional, 'native original UI leaves verified room', 90000);
    emit({ stage: 'peer-observed-native-leave', mode, code });
  } finally {
    peer.disconnect();
  }
}
try {
  if (process.argv[2] === '--follow') {
    const logPath = path.resolve(process.argv[3]);
    const processed = new Set();
    const deadline = performance.now() + 300000;
    let complete = false;
    while (!complete) {
      if (performance.now() > deadline) throw Error('Native output follow timed out');
      const log = await readFile(logPath, 'utf8').catch(() => '');
      const events = log
        .split(/\r?\n/)
        .filter((line) => line.startsWith('SKYFRONT_PARITY_WEB_QA '))
        .flatMap((line) => {
          try {
            return [JSON.parse(line.slice('SKYFRONT_PARITY_WEB_QA '.length))];
          } catch {
            return [];
          }
        });
      for (const event of events) {
        if (event.stage === 'await-network-peer' && !processed.has(event.code)) {
          processed.add(event.code);
          await run(event.endpoint, event.code, event.mode);
        }
        if (event.stage === 'complete') {
          assert.equal(event.passed, true, event.error);
          assert.equal(event.modes?.length, 2);
          complete = true;
        }
      }
      await delay(150);
    }
    assert.equal(reports.length, 2);
  } else {
    const [, , address, code, mode = 'pvp'] = process.argv;
    if (!address || !code)
      throw Error(
        'Usage: node native/network/native-peer.mjs <endpoint> <code> [pvp|coop] OR --follow <native-stdout-log>',
      );
    await run(address, code, mode);
  }
  console.log(
    JSON.stringify({ stage: 'complete', passed: true, loopbackOnly: true, modes: reports }),
  );
} catch (error) {
  const result = {
    stage: 'complete',
    passed: false,
    loopbackOnly: true,
    error: String(error?.stack || error),
    modes: reports,
  };
  await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n');
  console.error(JSON.stringify(result));
  process.exitCode = 1;
}

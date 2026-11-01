import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { NetworkSession } from '../../src/network/client.js';
import { PROTOCOL_VERSION } from '../../src/network/commands.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const packageRoot = path.resolve(process.argv[2] || path.join(root, 'native/build/network'));
const until = async (test, message, timeout = 5000) => {
  const deadline = performance.now() + timeout;
  while (!test()) {
    if (performance.now() > deadline) throw Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: WebSocket });
const storage = new Map();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
});
const child = spawn(path.join(packageRoot, 'node.exe'), [path.join(packageRoot, 'server.mjs')], {
  cwd: packageRoot,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const stdout = [],
  errors = [],
  clients = [],
  reports = [];
const lines = createInterface({ input: child.stdout });
lines.on('line', (line) => {
  try {
    stdout.push(JSON.parse(line));
  } catch {
    processError = Error('Bundled server emitted non-JSON stdout');
  }
});
child.stderr.on('data', (data) => errors.push(String(data)));
child.stdin.on('error', () => {});
let processError, shutdownOutcome;
child.on('error', (error) => {
  processError = error;
});
try {
  await until(() => processError || stdout.length, 'Bundled server did not become ready');
  if (processError) throw processError;
  const ready = stdout[0];
  assert.equal(ready.kind, 'server-ready');
  assert.equal(ready.protocol, PROTOCOL_VERSION);
  assert.equal(new URL(ready.url).hostname, '127.0.0.1');
  const peerPage = await fetch(ready.url + '/');
  assert.equal(peerPage.status, 200);
  assert.equal(
    await peerPage.text(),
    await readFile(path.join(packageRoot, 'client/Skyfront.html'), 'utf8'),
  );
  const info = await fetch(ready.url + '/api/server-info', {
    headers: { Origin: 'http://skyfront.localhost' },
  });
  assert.equal(info.headers.get('access-control-allow-origin'), 'http://skyfront.localhost');
  assert.equal((await info.json()).status, 'local');
  assert.equal((await fetch(ready.url + '/.git/config')).status, 404);
  assert.equal((await fetch(ready.url + '/%2e%2e%2fnetwork-build.json')).status, 404);
  for (const mode of ['pvp', 'coop']) {
    const failures = [];
    const make = () => {
      const client = new NetworkSession({ onError: (error) => failures.push(error) });
      clients.push(client);
      return client;
    };
    const a = make(),
      b = make();
    await a.connect(ready.url, { type: 'create', mode, name: 'Native host' });
    await b.connect(ready.url, { type: 'join', code: a.room.code, name: 'Original peer' });
    assert.equal(a.side, 0);
    assert.equal(b.side, mode === 'coop' ? 2 : 1);
    a.send({ type: 'ready', value: true });
    b.send({ type: 'ready', value: true });
    await until(
      () => a.room.players.every((player) => player?.ready),
      'Ready status did not synchronize',
    );
    a.send({ type: 'start' });
    await until(() => a.latest && b.latest, 'Initial delta snapshot missing');
    assert.equal(a.latest.state.sides.length, mode === 'coop' ? 4 : 2);
    assert.equal(b.latest.state.sides.length, mode === 'coop' ? 4 : 2);
    assert.equal(
      a.latest.state.buildings.filter((building) => building.key === 'hq').length,
      mode === 'coop' ? 4 : 2,
    );
    assert.equal(
      b.latest.state.buildings.filter((building) => building.key === 'hq').length,
      mode === 'coop' ? 4 : 2,
    );
    const headquarters = [a, b].map((client) =>
      client.latest.state.buildings.find(
        (building) => building.key === 'hq' && building.side === 0,
      ),
    );
    const treasury = [a, b].map((client) => client.latest.state.sides[0].credits);
    const hostBuild = await a.command('build', {
      key: 'power',
      x: headquarters[0].x - 55,
      z: headquarters[0].z - 80,
      rotation: 0,
    });
    assert.ok(hostBuild?.id, String(hostBuild));
    const peerBuild = await b.command('build', {
      key: 'housing',
      x: headquarters[1].x + 55,
      z: headquarters[1].z - 80,
      rotation: 0,
    });
    assert.ok(peerBuild?.id, String(peerBuild));
    await until(
      () =>
        [a, b].every((client) =>
          [hostBuild.id, peerBuild.id].every((id) =>
            client.latest.state.buildings.some((building) => building.id === id),
          ),
        ),
      'Paid buildings did not reach both original clients',
    );
    assert.ok(a.latest.state.sides[0].credits < treasury[0]);
    assert.ok(b.latest.state.sides[0].credits < treasury[1]);
    assert.equal(
      a.latest.state.buildings.find((building) => building.id === peerBuild.id).side,
      mode === 'coop' ? 2 : 1,
    );
    assert.equal(
      b.latest.state.buildings.find((building) => building.id === hostBuild.id).side,
      mode === 'coop' ? 2 : 1,
    );
    const denied = await a.command('demolish', { id: peerBuild.id });
    assert.equal(typeof denied, 'string');
    assert.match(denied, /принадлежит/);
    await until(
      () => a.latest.state.time > 0.15 && b.latest.state.time > 0.15,
      'Authoritative simulation did not advance',
    );
    reports.push({
      mode,
      cities: a.latest.state.sides.length,
      hostSide: a.side,
      peerSide: b.side,
      paidBuildingsSynced: true,
      ownershipEnforced: true,
      deltaSnapshots: !!a.latest && !!b.latest,
      simulationAdvanced: true,
      errors: failures,
    });
    assert.deepEqual(failures, []);
    a.leave();
    b.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.deepEqual(errors, []);
  assert.equal(
    stdout.length,
    1,
    'Server stdout must remain machine-readable and contain only readiness',
  );
  const result = {
    ok: true,
    scope: 'Actual bundled server + two original NetworkSession clients per mode; no GPU',
    protocol: PROTOCOL_VERSION,
    staticOriginalPage: true,
    modes: reports,
  };
  await mkdir(path.join(root, 'artifacts/native'), { recursive: true });
  await writeFile(
    path.join(root, 'artifacts/native/network-bundle-smoke.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const client of clients) client.disconnect();
  const exited =
    child.exitCode == null
      ? once(child, 'exit')
      : Promise.resolve([child.exitCode, child.signalCode]);
  if (child.exitCode == null) child.stdin.end('{"cmd":"shutdown"}\n');
  let shutdownTimer;
  shutdownOutcome = await Promise.race([
    exited,
    new Promise((resolve) => {
      shutdownTimer = setTimeout(() => resolve(null), 3000);
    }),
  ]);
  clearTimeout(shutdownTimer);
  if (!shutdownOutcome) child.kill();
  lines.close();
}
// Preserve any failed gameplay assertion instead of overriding it from finally.
assert.ok(shutdownOutcome, 'Own bundled server did not shut down gracefully');
assert.equal(shutdownOutcome[0], 0, errors.join(''));

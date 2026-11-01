// QA coordinator: --prepare-only / --cpu-preflight never start a GPU.
// Only --run-native launches ONE owned native child; no other processes are touched.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { NetworkSession } from '../src/network/client.js';
import { createReconnectHost, delay, until, wallet } from './native-parity-reconnect-host.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const flags = new Set(),
  values = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (['--prepare-only', '--cpu-preflight', '--run-native'].includes(a)) flags.add(a);
  else {
    assert.ok(a.startsWith('--') && process.argv[i + 1], 'Expected --option value');
    values.set(a, process.argv[++i]);
  }
}
assert.ok(flags.size === 1, 'Choose exactly one of --prepare-only, --cpu-preflight, --run-native');
const output = path.resolve(
  repo,
  values.get('--output') ||
    'artifacts/native/reconnect-' + new Date().toISOString().replace(/[:.]/g, '-'),
);
const executable = path.resolve(
  repo,
  values.get('--exe') || 'native/build/parity-windows/Skyfront.exe',
);
const template = await readFile(
  new URL('native-parity-reconnect-guest.js', import.meta.url),
  'utf8',
);
new Function(template);
await mkdir(output, { recursive: false });
const report = {
  passed: false,
  scope: flags.has('--run-native')
    ? 'One actual native guest + original Node NetworkSession host; loopback reconnect only'
    : 'CPU preflight only; no native/GPU acceptance',
  publicInternetAcceptance: false,
  performanceBenchmark: false,
  manualTicks: false,
  grants: false,
  output,
};
const events = [],
  log = (value) => {
    events.push(value);
    console.log(JSON.stringify({ atUtc: new Date().toISOString(), ...value }));
  };
let harness,
  child,
  completion,
  childOutcome,
  guestResult,
  stderr = '',
  guestPeer;
async function cpuPreflight() {
  const config = harness.config,
    sockets = [],
    joins = [],
    samples = [];
  let token,
    lastSeq = 0;
  const Base = globalThis.WebSocket;
  class ActualProbe extends Base {
    constructor(...args) {
      super(...args);
      const generation = sockets.length + 1;
      sockets.push(this);
      this.addEventListener('message', (event) => {
        let m;
        try {
          m = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (m.type === 'joined') {
          joins.push({
            seat: m.seat,
            code: m.room.code,
            lastSequence: m.lastSequence || 0,
            tokenMatched: token === undefined || token === m.token,
          });
          token ??= m.token;
        }
      });
      this.addEventListener('open', () =>
        this.addEventListener('message', (event) => {
          let m;
          try {
            m = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (m.sync || m.state) {
            if (guestPeer?.latest)
              samples.push({
                generation,
                tick: m.tick,
                syncSeq: m.sync?.seq || 0,
                time: guestPeer.latest.state.time,
                resources: wallet(guestPeer.latest.state.sides[0]),
                inventory: { ...guestPeer.latest.state.sides[0].inventory },
                ammoStock: { ...guestPeer.latest.state.sides[0].ammoStock },
              });
          }
        }),
      );
    }
    send(raw, ...args) {
      const m = JSON.parse(String(raw));
      if (m.type === 'command') lastSeq = Math.max(lastSeq, m.sequence);
      return super.send(raw, ...args);
    }
  }
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: ActualProbe });
  const peerErrors = [];
  guestPeer = new NetworkSession({ onError: (e) => peerErrors.push(e) });
  await guestPeer.connect(config.endpoint, {
    type: 'join',
    code: config.code,
    name: 'Original Node CPU preflight only',
  });
  guestPeer.send({ type: 'ready', value: true });
  await until(
    () =>
      guestPeer.room?.phase === 'playing' &&
      guestPeer.latest?.state &&
      harness.status().hostBuildingId,
    'CPU original room playing',
  );
  const hq = guestPeer.latest.state.buildings.find((b) => b.side === 0 && b.key === 'hq');
  const housing = await guestPeer.command('build', {
    key: 'housing',
    x: hq.x + 55,
    z: hq.z - 80,
    rotation: 0,
  });
  assert.ok(housing?.id);
  const mog = await guestPeer.command('build', {
    key: 'gun',
    x: hq.x - 130,
    z: hq.z + 130,
    rotation: 0,
  });
  assert.ok(mog?.id);
  await until(
    () => guestPeer.latest.state.buildings.find((b) => b.id === mog.id)?.progress === 1,
    'CPU original MOG construction',
  );
  await harness.action(
    'snapshot',
    samples.findLast((s) => s.generation === 1),
  );
  const armed = await harness.action('arm', { guestBuildingId: housing.id, mogId: mog.id });
  assert.equal(lastSeq, armed.sequence);
  sockets[0].close(4000, 'QA transient drop');
  await until(() => guestPeer.room?.phase === 'disconnected', 'CPU actual WS disconnect');
  const seq = guestPeer.sequence,
    denied = await guestPeer.command('demolish', { id: housing.id });
  assert.equal(typeof denied, 'string');
  assert.equal(guestPeer.sequence, seq);
  await until(() => harness.status().freeze || harness.failure, 'CPU authority freeze');
  if (harness.failure) throw Error(harness.failure);
  await until(
    () =>
      joins.length === 2 &&
      guestPeer.room.phase === 'playing' &&
      samples.some((s) => s.generation === 2),
    'CPU original auto-resume',
  );
  assert.equal(joins[1].tokenMatched, true);
  assert.equal(joins[1].seat, joins[0].seat);
  assert.equal(joins[1].lastSequence, lastSeq);
  assert.equal(sockets.length, 2);
  await harness.action(
    'snapshot',
    samples.findLast((s) => s.generation === 2),
  );
  const power = await guestPeer.command('build', {
    key: 'power',
    x: hq.x - 55,
    z: hq.z - 80,
    rotation: 0,
  });
  assert.ok(power?.id);
  const deniedOther = await guestPeer.command('demolish', { id: armed.hostBuildingId });
  assert.equal(typeof deniedOther, 'string');
  assert.match(deniedOther, /принадлежит/);
  await until(
    () => harness.room.state.time > harness.status().freeze.after.time + 0.2,
    'CPU natural authority progress',
  );
  const result = await harness.action('verify', { postBuildingId: power.id });
  assert.equal(result.passed, true);
  assert.deepEqual(peerErrors, []);
  guestPeer.leave();
  await until(() => harness.status().closed, 'CPU original leave');
  await harness.action('finish');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: Base });
  return {
    passed: true,
    scope: 'Original Node guest preflight ONLY; no native/GPU proof',
    joins,
    socketCount: sockets.length,
    authority: result,
  };
}
try {
  if (flags.has('--prepare-only')) {
    const source =
      'window.__SKYFRONT_RECONNECT_CONFIG__=' +
      JSON.stringify({
        endpoint: 'http://127.0.0.1:12345',
        control: 'http://127.0.0.1:12346',
        code: 'ABCDEF',
        mode: 'pvp',
      }) +
      ';\n' +
      template;
    new Function(source);
    await writeFile(path.join(output, 'guest-example-qa.js'), source, 'utf8');
    report.prepared = true;
    report.processesLaunched = 0;
    log({ stage: 'prepared-only', output, processesLaunched: 0 });
  } else {
    harness = await createReconnectHost(log);
    if (flags.has('--cpu-preflight')) {
      guestResult = await cpuPreflight();
      report.passed = true;
      report.cpuOnly = true;
    } else {
      await access(executable);
      const script = path.join(output, 'guest-qa.js'),
        source =
          'window.__SKYFRONT_RECONNECT_CONFIG__=' +
          JSON.stringify(harness.config) +
          ';\n' +
          template;
      new Function(source);
      await writeFile(script, source, 'utf8');
      const outPath = path.join(output, 'native-guest.out.log'),
        errPath = path.join(output, 'native-guest.err.log'),
        out = createWriteStream(outPath),
        err = createWriteStream(errPath);
      child = spawn(
        executable,
        [
          '--position',
          '-25000,-25000',
          '--resolution',
          '960x540',
          '--',
          '--qa-parity',
          '--qa-script=' + script,
        ],
        { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let tail = '',
        settle;
      completion = new Promise((resolve) => {
        settle = resolve;
      });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        out.write(chunk);
        tail += chunk;
        let newline;
        while ((newline = tail.indexOf('\n')) >= 0) {
          const line = tail.slice(0, newline).replace(/\r$/, '');
          tail = tail.slice(newline + 1);
          if (line.startsWith('SKYFRONT_PARITY_WEB_QA ')) {
            let event;
            try {
              event = JSON.parse(line.slice('SKYFRONT_PARITY_WEB_QA '.length));
            } catch {
              continue;
            }
            log({
              stage: 'native-event',
              eventStage: event.stage,
              passed: event.passed,
              currentStage: event.currentStage,
            });
            if (event.stage === 'complete') guestResult = event;
          }
          if (line.startsWith('SKYFRONT_PARITY_NATIVE_FAILURE ')) {
            report.nativeFailure = line;
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        err.write(chunk);
        stderr += chunk;
      });
      child.on('error', (error) => {
        report.launchError = String(error);
      });
      child.on('close', (exitCode, signal) => {
        out.end();
        err.end();
        childOutcome = { exitCode, signal };
        settle(childOutcome);
        log({ stage: 'native-exit', pid: child.pid, ...childOutcome });
      });
      report.child = {
        pid: child.pid,
        executable,
        outPath,
        errPath,
        ownership: 'Only this spawned child Process is controlled',
      };
      log({ stage: 'native-started', ...report.child });
      await until(
        () => guestResult || childOutcome || harness.failure,
        'native reconnect completion',
        180000,
      );
      assert.equal(harness.failure, undefined, harness.failure);
      assert.equal(guestResult?.passed, true, JSON.stringify(guestResult || childOutcome));
      await until(() => childOutcome, 'native child clean exit', 30000);
      assert.equal(childOutcome.exitCode, 0);
      assert.equal(stderr.trim(), '', 'Native stderr must be empty');
      assert.ok(!report.nativeFailure, report.nativeFailure);
      assert.equal(harness.status().completed, true);
      assert.equal(harness.report.passed, true);
      report.passed = true;
    }
    report.guest = guestResult;
    report.authority = harness.report;
    report.childOutcome = childOutcome;
    report.stderr = stderr;
    log({
      stage: 'complete',
      passed: report.passed,
      output,
      guestChecks: guestResult?.checks?.length,
      authorityChecks: harness.report.checks.length,
      cpuOnly: !!report.cpuOnly,
    });
  }
} catch (error) {
  report.error = String(error?.stack || error);
  log({ stage: 'complete', passed: false, error: report.error, output });
  process.exitCode = 1;
} finally {
  guestPeer?.disconnect();
  if (child && !childOutcome) {
    report.forcedOwnedChildCleanup = true;
    child.kill();
    await Promise.race([completion, delay(6000)]);
  }
  if (harness) {
    report.authority = harness.report;
    await harness.close();
  }
  report.events = events;
  report.childOutcome = childOutcome;
  report.stderr = stderr;
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
}

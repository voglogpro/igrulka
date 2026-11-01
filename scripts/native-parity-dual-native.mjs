// Prepare/run TWO actual native Godot clients, sequential Guests per Host room.
// No game-server or client implementation here: each packaged application starts
// its own original local service; Guests join the Host service via original DOM.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const repo = fileURLToPath(new URL('..', import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (['--prepare-only', '--no-capture'].includes(key)) args.set(key, true);
  else {
    assert.ok(key.startsWith('--') && process.argv[i + 1], 'Expected --option value');
    args.set(key, process.argv[++i]);
  }
}
const output = path.resolve(
  repo,
  args.get('--output') ||
    'artifacts/native/dual-native-' + new Date().toISOString().replace(/[:.]/g, '-'),
);
const executable = path.resolve(
  repo,
  args.get('--exe') || 'native/build/parity-windows/Skyfront.exe',
);
const resolution = args.get('--resolution') || '960x540';
const captureRequested = !args.has('--no-capture');
const selectedModes = args.has('--mode') ? [args.get('--mode')] : ['pvp', 'coop'];
assert.ok(
  selectedModes.every((mode) => ['pvp', 'coop'].includes(mode)),
  '--mode must be pvp or coop',
);
assert.match(resolution, /^\d{3,4}x\d{3,4}$/);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const owned = [],
  results = [];
let outputCreated = false;
let host;
const report = {
  passed: false,
  scope: 'Two actual native Godot clients; original DOM/NetworkSession, functional loopback only',
  performanceBenchmark: false,
  publicInternetAcceptance: false,
  executable,
  resolution,
  output,
  captureRequested,
  selectedModes,
  ownership:
    'Coordinator controls only the child Process objects it creates; never enumerates/kills other processes',
  modes: results,
};
function log(value) {
  console.log(JSON.stringify({ atUtc: new Date().toISOString(), ...value }));
}
async function until(test, label, timeout = 180000) {
  const end = performance.now() + timeout;
  while (!test()) {
    if (performance.now() > end) throw Error('Timed out: ' + label);
    await delay(100);
  }
}
function validateScript(source, label) {
  try {
    new Function(source);
  } catch (error) {
    throw Error(label + ' syntax: ' + error.message, { cause: error });
  }
}
function launch(role, script) {
  const stdoutPath = path.join(output, role + '.out.log'),
    stderrPath = path.join(output, role + '.err.log');
  const stdout = createWriteStream(stdoutPath, { encoding: 'utf8' }),
    stderr = createWriteStream(stderrPath, { encoding: 'utf8' });
  const nativeArgs = [
    '--position',
    '-25000,-25000',
    '--resolution',
    resolution,
    '--',
    '--qa-parity',
    '--qa-script=' + script,
  ];
  if (captureRequested) nativeArgs.push('--capture=' + path.join(output, role + '.png'));
  const child = spawn(executable, nativeArgs, {
    cwd: repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = {
    role,
    child,
    pid: child.pid,
    stdoutPath,
    stderrPath,
    events: [],
    timeline: [],
    startup: [],
    transport: [],
    nativeFailures: [],
    stderr: '',
    lines: [],
    tail: '',
    outcome: null,
    startedAt: new Date().toISOString(),
  };
  owned.push(record);
  let finish;
  record.completion = new Promise((resolve) => {
    finish = resolve;
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout.write(chunk);
    record.tail += chunk;
    let index;
    while ((index = record.tail.indexOf('\n')) >= 0) {
      const line = record.tail.slice(0, index).replace(/\r$/, '');
      record.tail = record.tail.slice(index + 1);
      record.lines.push(line);
      const prefix = 'SKYFRONT_PARITY_WEB_QA ';
      if (line.startsWith(prefix)) {
        try {
          const value = JSON.parse(line.slice(prefix.length));
          const atUtc = new Date().toISOString();
          record.events.push(value);
          record.timeline.push({
            atUtc,
            stage: value.stage,
            mode: value.mode,
            code: value.code,
            passed: value.passed,
          });
          log({
            stage: 'native-event',
            role,
            pid: record.pid,
            eventStage: value.stage,
            passed: value.passed,
            mode: value.mode,
            code: value.code,
          });
        } catch {}
      }
      const failurePrefix = 'SKYFRONT_PARITY_NATIVE_FAILURE ';
      if (line.startsWith(failurePrefix)) {
        try {
          const value = JSON.parse(line.slice(failurePrefix.length));
          const atUtc = new Date().toISOString();
          record.nativeFailures.push({ atUtc, ...value });
          log({ stage: 'native-failure', role, pid: record.pid, failure: value });
        } catch {}
      }
      const startupPrefix = 'SKYFRONT_PARITY_STARTUP ';
      if (line.startsWith(startupPrefix)) {
        try {
          const value = JSON.parse(line.slice(startupPrefix.length));
          const atUtc = new Date().toISOString();
          record.startup.push({ atUtc, ...value });
          record.timeline.push({ atUtc, stage: 'startup', phase: value.phase });
          log({
            stage: 'native-startup',
            role,
            pid: record.pid,
            phase: value.phase,
            metadata: value,
          });
        } catch {}
      }
      const transportPrefix = 'SKYFRONT_PARITY_TRANSPORT ';
      if (line.startsWith(transportPrefix)) {
        try {
          const value = JSON.parse(line.slice(transportPrefix.length));
          const atUtc = new Date().toISOString();
          record.transport.push({ atUtc, ...value });
          log({ stage: 'native-transport', role, pid: record.pid, metadata: value });
        } catch {}
      }
      if (line.includes('Локальная сетевая служба недоступна:')) {
        const atUtc = new Date().toISOString();
        record.startup.push({ atUtc, phase: 'local-server-unavailable', message: line });
        record.timeline.push({ atUtc, stage: 'startup', phase: 'local-server-unavailable' });
        log({
          stage: 'native-startup',
          role,
          pid: record.pid,
          phase: 'local-server-unavailable',
          message: line,
        });
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr.write(chunk);
    record.stderr += chunk;
  });
  child.on('error', (error) => {
    record.launchError = String(error);
  });
  child.on('close', (exitCode, signal) => {
    stdout.end();
    stderr.end();
    record.outcome = { exitCode, signal, launchError: record.launchError };
    finish(record.outcome);
    log({ stage: 'native-exit', role, pid: record.pid, ...record.outcome });
  });
  log({
    stage: 'native-started',
    role,
    pid: record.pid,
    script,
    stdoutPath,
    stderrPath,
    captureRequested,
  });
  return record;
}
function outcome(record) {
  return {
    role: record.role,
    pid: record.pid,
    ...record.outcome,
    stdoutPath: record.stdoutPath,
    stderrPath: record.stderrPath,
    startedAt: record.startedAt,
    captureRequested,
    timeline: record.timeline,
    startup: record.startup,
    transport: record.transport,
    nativeFailures: record.nativeFailures,
    stderr: record.stderr,
    checks: record.events.findLast((e) => e.stage === 'complete')?.checks?.length,
    complete: record.events.findLast((e) => e.stage === 'complete'),
  };
}
async function stopOwnedOnFailure() {
  for (const record of owned)
    if (!record.outcome) {
      record.forcedByCoordinator = true;
      record.child.kill();
    }
  await Promise.race([Promise.all(owned.map((record) => record.completion)), delay(6000)]);
}
try {
  await mkdir(output, { recursive: false });
  outputCreated = true;
  let hostSource = await readFile(path.join(repo, 'scripts/native-parity-network-qa.js'), 'utf8');
  const postAnchor = 'const post = (value) => window.chrome.webview.postMessage(value);';
  assert.ok(hostSource.includes(postAnchor), 'Original Host QA post anchor changed');
  hostSource = hostSource.replace(
    postAnchor,
    `const post = (value) => {
    if (value.stage === 'await-network-peer') value = { ...value, instruction: 'Coordinator launches a real second native Godot Guest from endpoint/code/mode; no Node player.' };
    if (value.stage === 'complete') value = { ...value, executedModes: ${JSON.stringify(selectedModes)}, scope: 'Actual native original UI paired with a second native Godot client; selected modes: ${selectedModes.join(',')}; functional loopback only' };
    window.chrome.webview.postMessage({ ...value, peerRuntime: 'native-godot' });
  };`,
  );
  const modeAnchor = "for (const mode of ['pvp', 'coop']) {";
  assert.ok(hostSource.includes(modeAnchor), 'Original Host QA mode loop changed');
  hostSource = hostSource.replace(
    modeAnchor,
    'for (const mode of ' + JSON.stringify(selectedModes) + ') {',
  );
  assert.ok(hostSource.includes('await delay(2500);'), 'Original Host hold anchor changed');
  hostSource = hostSource.replace('await delay(2500);', 'await delay(15000);');
  hostSource = hostSource.replace(
    /('real original Node peer joins and readies',\s*)90000/,
    (_match, prefix) => prefix + '150000',
  );
  hostSource = hostSource
    .replaceAll(
      'A Node peer runs the ORIGINAL NetworkSession; no second GPU and no fake client.',
      'Two actual native clients run the ORIGINAL NetworkSession; controlled dual-GPU functional test.',
    )
    .replaceAll(
      'Node peer uses original NetworkSession without a second GPU.',
      'Guest is a second actual native Godot client using the original NetworkSession.',
    )
    .replaceAll('Node NetworkSession peer', 'Native Godot Guest')
    .replaceAll('Node peer', 'Native Guest');
  validateScript(hostSource, 'Host');
  const guestTemplate = await readFile(
    path.join(repo, 'scripts/native-parity-dual-native-guest.js'),
    'utf8',
  );
  validateScript(guestTemplate, 'Guest template');
  const hostScript = path.join(output, 'host-qa.js');
  await writeFile(hostScript, hostSource, 'utf8');
  if (args.has('--prepare-only')) {
    const sample =
      'window.__SKYFRONT_DUAL_NATIVE_GUEST__ = ' +
      JSON.stringify({
        mode: selectedModes[0],
        code: 'ABCDEF',
        endpoint: 'ws://127.0.0.1:12345/match',
      }) +
      ';\n' +
      guestTemplate;
    validateScript(sample, 'Generated Guest');
    await writeFile(path.join(output, 'guest-example-qa.js'), sample, 'utf8');
    log({
      stage: 'prepared-only',
      output,
      hostScript,
      guestTemplate: path.join(repo, 'scripts/native-parity-dual-native-guest.js'),
      processesLaunched: 0,
    });
  } else {
    await access(executable);
    host = launch('host', hostScript);
    const processed = new Set();
    for (const mode of selectedModes) {
      await until(
        () =>
          host.events.some(
            (e) => e.stage === 'await-network-peer' && e.mode === mode && !processed.has(e.code),
          ) || host.outcome,
        'Host ' + mode + ' real room',
        180000,
      );
      const request = host.events.find(
        (e) => e.stage === 'await-network-peer' && e.mode === mode && !processed.has(e.code),
      );
      assert.ok(
        request,
        'Host exited before creating ' + mode + ' room: ' + JSON.stringify(outcome(host)),
      );
      processed.add(request.code);
      const guestSource =
        'window.__SKYFRONT_DUAL_NATIVE_GUEST__ = ' +
        JSON.stringify({ mode, code: request.code, endpoint: request.endpoint }) +
        ';\n' +
        guestTemplate;
      validateScript(guestSource, 'Guest ' + mode);
      const guestScript = path.join(output, 'guest-' + mode + '-qa.js');
      await writeFile(guestScript, guestSource, 'utf8');
      const guest = launch('guest-' + mode, guestScript);
      await until(
        () => guest.events.some((e) => e.stage === 'complete') || guest.outcome,
        'Guest ' + mode + ' complete',
        240000,
      );
      const guestResult = guest.events.findLast((e) => e.stage === 'complete');
      assert.equal(
        guestResult?.passed,
        true,
        'Guest ' + mode + ' failed: ' + JSON.stringify(guestResult || outcome(guest)),
      );
      await until(() => guest.outcome, 'Guest ' + mode + ' exits after original restore', 60000);
      assert.equal(guest.outcome.exitCode, 0, JSON.stringify(outcome(guest)));
      assert.equal(guest.stderr.trim(), '', 'Guest stderr must be empty: ' + guest.stderr);
      const hostResult = host.events.find(
        (e) => e.stage === 'network-mode-complete' && e.code === request.code,
      );
      assert.ok(hostResult?.passed, 'Host did not verify ' + mode);
      assert.equal(guestResult.guestBuildingId, hostResult.peerBuildingId);
      assert.equal(guestResult.hostBuildingId, hostResult.nativeBuildingId);
      assert.deepEqual(
        [...guestResult.guestRoadIds].sort((a, b) => a - b),
        [...hostResult.peerRoadIds].sort((a, b) => a - b),
      );
      assert.deepEqual(
        [...guestResult.hostRoadIds].sort((a, b) => a - b),
        [...hostResult.nativeRoadIds].sort((a, b) => a - b),
      );
      assert.equal(guestResult.restoreComparison.expectedVersusActual.count, 0);
      results.push({
        mode,
        code: request.code,
        cities: mode === 'coop' ? 4 : 2,
        hostVerified: hostResult,
        guest: outcome(guest),
        bothPaidBuildingsAndRoadsMatchIds: true,
        simultaneousNativeClients: 2,
        performanceBenchmark: false,
      });
      await writeFile(
        path.join(output, 'report.json'),
        JSON.stringify({ ...report, host: outcome(host) }, null, 2) + '\n',
      );
    }
    await until(
      () => host.events.some((e) => e.stage === 'complete') || host.outcome,
      'Host final complete',
      60000,
    );
    const hostResult = host.events.findLast((e) => e.stage === 'complete');
    assert.equal(hostResult?.passed, true, JSON.stringify(hostResult || outcome(host)));
    assert.equal(hostResult.modes.length, selectedModes.length);
    assert.equal(hostResult.checks.length, 1 + 11 * selectedModes.length);
    assert.ok(hostResult.modes.every((mode) => mode.soloRestore.expectedVersusActual.count === 0));
    await until(() => host.outcome, 'Host exits', 60000);
    assert.equal(host.outcome.exitCode, 0);
    assert.equal(host.stderr.trim(), '', 'Host stderr must be empty: ' + host.stderr);
    report.passed = true;
    report.host = outcome(host);
    report.ownedProcesses = owned.map(outcome);
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    log({
      stage: 'complete',
      passed: true,
      output,
      modes: results.map((mode) => ({
        mode: mode.mode,
        cities: mode.cities,
        guestChecks: mode.guest.checks,
      })),
      hostChecks: hostResult.checks.length,
      performanceBenchmark: false,
      publicInternetAcceptance: false,
    });
  }
} catch (error) {
  report.error = String(error?.stack || error);
  await stopOwnedOnFailure();
  report.ownedProcesses = owned.map(outcome);
  if (outputCreated)
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify({ stage: 'complete', passed: false, error: report.error, output }));
  process.exitCode = 1;
}

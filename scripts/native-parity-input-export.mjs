// ROOT invokes this against its explicitly started own native PID/stdout log.
// No GPU/game/server is launched here. One owned PowerShell input worker is
// compiled once, then performs only foreground-guarded actual Windows input.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url));
const options = new Map();
for (let i = 2; i < process.argv.length; i++) {
  assert.ok(process.argv[i].startsWith('--') && process.argv[i + 1], 'Expected --option value');
  options.set(process.argv[i], process.argv[++i]);
}
const gamePid = Number(options.get('--pid'));
assert.ok(
  Number.isSafeInteger(gamePid) && gamePid > 0,
  '--pid must be the ROOT-owned native game process',
);
assert.ok(
  options.has('--follow') && options.has('--downloads'),
  'Require --follow own-native-stdout-log and --downloads explicitly authorized directory',
);
const logPath = path.resolve(repo, options.get('--follow'));
const downloads = path.resolve(options.get('--downloads'));
const output = path.resolve(
  repo,
  options.get('--output') ||
    'artifacts/native/input-export-auto-' + new Date().toISOString().replace(/[:.]/g, '-'),
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = {
  passed: false,
  gameProcessId: gamePid,
  logPath,
  downloads,
  output,
  scope: 'Actual trusted Start/W/export plus exact NEW-file hash; Root-owned game process only',
  events: [],
  actions: [],
};
const print = (value) => console.log(JSON.stringify({ atUtc: new Date().toISOString(), ...value }));
let worker,
  workerExit,
  workerReady = false,
  workerBuffer = '',
  requestSequence = 0,
  createdOutput = false;
const workerWaiters = new Map();
async function until(test, label, timeout = 120000) {
  const end = performance.now() + timeout;
  while (!test()) {
    if (performance.now() > end) throw Error('Timed out: ' + label);
    await delay(50);
  }
}
function launchWorker() {
  worker = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(repo, 'scripts/native-parity-input-worker.ps1'),
      '-GameProcessId',
      String(gamePid),
    ],
    { cwd: repo, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  report.worker = { pid: worker.pid, stderr: '', events: [] };
  worker.stdout.setEncoding('utf8');
  worker.stderr.setEncoding('utf8');
  worker.stdout.on('data', (chunk) => {
    workerBuffer += chunk;
    let index;
    while ((index = workerBuffer.indexOf('\n')) >= 0) {
      const line = workerBuffer.slice(0, index).replace(/\r$/, '');
      workerBuffer = workerBuffer.slice(index + 1);
      if (!line) continue;
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        report.worker.stderr += 'Non-JSON worker output: ' + line + '\n';
        continue;
      }
      report.worker.events.push(value);
      print({ stage: 'input-worker', event: value });
      if (value.kind === 'input-worker-ready') workerReady = true;
      if (value.kind === 'input-worker-result' && workerWaiters.has(value.id)) {
        workerWaiters.get(value.id)(value);
        workerWaiters.delete(value.id);
      }
    }
  });
  worker.stderr.on('data', (chunk) => {
    report.worker.stderr += chunk;
  });
  worker.on('error', (error) => {
    report.worker.error = String(error);
    workerExit = { exitCode: null, error: String(error) };
  });
  worker.on('close', (exitCode, signal) => {
    workerExit = { exitCode, signal };
    report.worker.exit = workerExit;
  });
}
async function input(request) {
  assert.ok(workerReady && !workerExit, 'Input worker is not alive/ready');
  const id = ++requestSequence;
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  workerWaiters.set(id, finish);
  const value = {
    kind: 'owned-input',
    id,
    holdMilliseconds: 330,
    x: 0,
    y: 0,
    cssWidth: 0,
    cssHeight: 0,
    keyW: false,
    revealOnly: false,
    ...request,
  };
  const action = { request: value, requestedAtUtc: new Date().toISOString() };
  report.actions.push(action);
  print({ stage: 'input-request', ...action });
  worker.stdin.write(JSON.stringify(value) + '\n');
  let timer;
  const result = await Promise.race([
    pending,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Error('Owned input worker action timed out; do not repeat a blind click')),
        30000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  action.result = result;
  assert.equal(result.ok, true, result.error);
  return result;
}
let previousLog = '',
  nativeEvents = [];
async function pollNative() {
  const text = await readFile(logPath, 'utf8').catch(() => '');
  if (text === previousLog) return;
  previousLog = text;
  nativeEvents = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('SKYFRONT_PARITY_WEB_QA '))
    .flatMap((line) => {
      try {
        return [JSON.parse(line.slice('SKYFRONT_PARITY_WEB_QA '.length))];
      } catch {
        return [];
      }
    });
  const failure = text
    .split(/\r?\n/)
    .findLast((line) => line.startsWith('SKYFRONT_PARITY_NATIVE_FAILURE '));
  if (failure) throw Error('Native game emitted fatal QA failure: ' + failure);
}
async function waitNative(test, label, timeout = 120000) {
  const end = performance.now() + timeout;
  while (true) {
    await pollNative();
    const done = nativeEvents.findLast((e) => e.stage === 'complete');
    if (done?.passed === false) throw Error('Browser scenario failed: ' + done.error);
    const result = test(nativeEvents);
    if (result) return result;
    if (performance.now() > end) throw Error('Timed out: ' + label);
    await delay(100);
  }
}
function signature(event) {
  return JSON.stringify({ point: event.point, viewport: event.viewport, rect: event.rect });
}
async function stablePoint(stage, afterUtc) {
  let candidate,
    previousSequence = 0;
  return waitNative(
    (events) => {
      const event = events.findLast(
        (e) => e.stage === stage && Date.parse(e.postedAtUtc) > Date.parse(afterUtc),
      );
      if (!event || event.pointSequence <= previousSequence) return null;
      previousSequence = event.pointSequence;
      if (
        candidate &&
        candidate.inputId === event.inputId &&
        signature(candidate) === signature(event)
      )
        return event;
      candidate = event;
      return null;
    },
    stage + ' two fresh stable points after reveal',
    15000,
  );
}
async function runReadOnlyVerifier(expected) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(repo, 'scripts/native-parity-verify-export.ps1'),
    '-DownloadsDirectory',
    downloads,
    '-RequestedFilename',
    expected.requestedFilename,
    '-ExpectedSha256',
    expected.sha256,
    '-ExpectedBytes',
    String(expected.bytes),
    '-AfterUtc',
    expected.notBeforeUtc,
    '-WaitSeconds',
    '20',
  ];
  const child = spawn('powershell.exe', args, {
    cwd: repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const result = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode, signal) => resolve({ exitCode, signal, stdout, stderr }));
  });
  report.fileVerifier = { ...result };
  assert.equal(
    result.exitCode,
    0,
    'NEW exported file verification failed: ' + result.stdout + result.stderr,
  );
  const value = JSON.parse(stdout);
  assert.equal(value.passed, true);
  report.fileVerified = value;
}
async function captureOwnWindowOnFailure() {
  const helper = path.join(repo, 'scripts/capture-owned-native.ps1');
  const destination = path.join(output, 'owned-window-on-failure.png');
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helper,
      '-GameProcessId',
      String(gamePid),
      '-OutputPath',
      destination,
      '-Reveal',
    ],
    { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '',
    stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const result = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ error: String(error) }));
    child.on('close', (exitCode, signal) =>
      resolve({ exitCode, signal, stdout, stderr, path: destination }),
    );
  });
  report.failureCapture = result;
}
try {
  await mkdir(output, { recursive: false });
  createdOutput = true;
  launchWorker();
  await until(() => workerReady || workerExit, 'one-time owned input worker compilation', 120000);
  assert.ok(workerReady, 'Worker failed before input: ' + JSON.stringify(report.worker));
  const stages = ['await-native-start', 'await-native-keypoint', 'await-native-export'];
  let revealDone;
  for (const stage of stages) {
    const initial = await waitNative(
      (events) => events.findLast((e) => e.stage === stage),
      stage,
      180000,
    );
    report.events.push({ observedAtUtc: new Date().toISOString(), event: initial });
    if (!revealDone) revealDone = await input({ revealOnly: true });
    // Reveal can change DPI/layout. Require actual refreshed browser coordinates,
    // never reuse the pre-reveal point or guess a button position.
    const point = await stablePoint(stage, revealDone.finishedAtUtc);
    report.events.push({ usedAtUtc: new Date().toISOString(), freshPoint: point });
    const result = await input({
      x: point.point.x,
      y: point.point.y,
      cssWidth: point.viewport.width,
      cssHeight: point.viewport.height,
      keyW: stage === 'await-native-keypoint',
    });
    await waitNative(
      (events) =>
        events.some(
          (e) =>
            e.stage === 'complete' ||
            (e.stage.startsWith('await-native-') &&
              e.inputId !== point.inputId &&
              Date.parse(e.postedAtUtc) > Date.parse(point.postedAtUtc)),
        ),
      stage + ' actual input advances browser scenario',
      15000,
    );
    print({
      stage: 'input-stage-complete',
      inputStage: stage,
      finishedAtUtc: result.finishedAtUtc,
    });
  }
  const browser = await waitNative(
    (events) => events.findLast((e) => e.stage === 'complete'),
    'browser final native ACK/export result',
    30000,
  );
  assert.equal(browser.passed, true, browser.error);
  assert.ok(browser.expectedExport, 'Browser did not supply expected exact export metadata');
  report.browser = browser;
  await runReadOnlyVerifier(browser.expectedExport);
  report.passed = true;
} catch (error) {
  report.error = String(error?.stack || error);
  print({ stage: 'failure', error: report.error });
  if (createdOutput) await captureOwnWindowOnFailure();
  process.exitCode = 1;
} finally {
  if (worker && !workerExit) {
    worker.stdin.end('{"kind":"close"}\n');
    await Promise.race([
      until(() => workerExit, 'owned input worker closes', 10000),
      delay(10000),
    ]).catch(() => {});
  }
  // Do not kill ROOT's game process or interrupt an in-flight hardware-key finally.
  if (createdOutput)
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  print({
    stage: 'complete',
    passed: report.passed,
    output,
    fileVerified: !!report.fileVerified,
    gameWasNotStartedOrStoppedByCoordinator: true,
  });
}

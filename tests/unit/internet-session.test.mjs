import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createInternetSession } from '../../server/internet-session.mjs';
import { createRoomServer } from '../../server/rooms.mjs';
import { NetworkSession } from '../../src/network/client.js';

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

test('whole provider startup has a bounded deadline and uses the small CDN transport probe', async () => {
  let options,
    aborted = 0;
  const controller = new AbortController();
  const recovery = createInternetSession({
    localUrl: 'http://127.0.0.1:1234',
    signal: controller.signal,
    attemptTimeoutMs: 25,
    startTunnel: async ({ signal, check }) => {
      await check('https://test.localhost.run', { signal, successes: 3 });
      return new Promise((resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted++;
            reject(Error('aborted'));
          },
          { once: true },
        ),
      );
    },
    check: async (url, value) => {
      options = value;
    },
    wait: async () => controller.abort(),
  });
  await until(() => recovery.state.status === 'stopped');
  assert.equal(aborted, 1);
  assert.equal(options.probeBytes, 2048);
  assert.equal(options.successes, 1);
});
async function until(predicate) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'condition timed out');
    await pause();
  }
}

test('tunnel death after match start preserves HTTP port, room state and player tokens through recovery', async (t) => {
  globalThis.WebSocket = WebSocket;
  globalThis.sessionStorage = {
    setItem() {},
    getItem() {
      return null;
    },
    removeItem() {},
  };
  let recovery;
  const server = createRoomServer({
    autoTick: false,
    serverInfo: () => recovery?.state || { publicUrl: null },
  });
  await new Promise((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  const localUrl = `http://127.0.0.1:${server.http.address().port}`;
  t.after(() => server.close());
  const attempts = [],
    delays = [],
    stops = [];
  let retry;
  recovery = createInternetSession({
    localUrl,
    startTunnel: async (options) => {
      const index = attempts.length;
      attempts.push(options);
      options.onPublicUrl(`https://pending-${index}.localhost.run`);
      return {
        url: `https://ready-${index}.localhost.run`,
        stop() {
          stops.push(index);
        },
      };
    },
    wait: (ms, signal) =>
      new Promise((resolve) => {
        delays.push(ms);
        retry = resolve;
        signal.addEventListener('abort', resolve, { once: true });
      }),
  });
  t.after(() => recovery.stop());
  await until(() => recovery.state.status === 'ready');
  const a = new NetworkSession({}),
    b = new NetworkSession({});
  t.after(() => {
    a.disconnect();
    b.disconnect();
  });
  await a.connect(localUrl, { type: 'create', mode: 'coop' });
  await b.connect(localUrl, { type: 'join', code: a.room.code });
  a.send({ type: 'ready', value: true });
  b.send({ type: 'ready', value: true });
  await until(() => a.room.players.every((p) => p?.ready));
  a.send({ type: 'start' });
  await until(() => a.latest && b.latest);
  const room = server.rooms.get(a.room.code),
    state = room.state,
    token = a.token;
  attempts[0].onExit(1);
  await until(() => delays.length === 1);
  assert.deepEqual(recovery.state, { publicUrl: null, status: 'recovering', retryCount: 1 });
  assert.equal((await (await fetch(`${localUrl}/api/server-info`)).json()).publicUrl, null);
  assert.equal(server.rooms.get(a.room.code).state, state);
  assert.equal(room.players[0].token, token);
  assert.equal(await a.command('formation', { value: 'column' }), true);
  retry();
  await until(() => attempts.length === 2 && recovery.state.status === 'ready');
  assert.equal(attempts[1].localUrl, localUrl);
  assert.equal(recovery.state.publicUrl, 'https://ready-1.localhost.run');
  assert.equal(server.http.address().port, Number(new URL(localUrl).port));
  assert.equal(server.rooms.get(a.room.code), room);
  assert.deepEqual(delays, [1000]);
  await recovery.stop();
  assert.deepEqual(stops, [0, 1]);
  assert.equal((await fetch(`${localUrl}/api/server-info`)).status, 200);
});

test('startup failures back off to fifteen seconds and cancellation stops retrying', async () => {
  const delays = [];
  let attempts = 0;
  const controller = new AbortController();
  const recovery = createInternetSession({
    localUrl: 'http://127.0.0.1:1234',
    signal: controller.signal,
    startTunnel: async () => {
      attempts++;
      throw Error('provider unavailable');
    },
    wait: async (ms) => {
      delays.push(ms);
      if (delays.length === 7) controller.abort();
    },
  });
  await recovery.done;
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  assert.equal(attempts, 7);
  assert.equal(recovery.state.status, 'stopped');
});

test('abort during startup cleans its owned child without publishing an unverified URL', async () => {
  let stopped = 0;
  const states = [];
  const recovery = createInternetSession({
    localUrl: 'http://127.0.0.1:1234',
    onChange: (s) => states.push(s),
    startTunnel: ({ signal, onPublicUrl }) =>
      new Promise((resolve, reject) => {
        onPublicUrl('https://not-checked.localhost.run');
        signal.addEventListener(
          'abort',
          () => {
            stopped++;
            reject(Error('aborted'));
          },
          { once: true },
        );
      }),
  });
  await recovery.stop();
  assert.equal(stopped, 1);
  assert.ok(states.every((s) => s.publicUrl === null));
});

test('an exit racing the startup result is stopped and waits in cancellable backoff', async () => {
  let starts = 0,
    stops = 0;
  const recovery = createInternetSession({
    localUrl: 'http://127.0.0.1:1234',
    startTunnel: async ({ onExit }) => {
      starts++;
      onExit(1);
      return {
        url: 'https://dead.localhost.run',
        stop() {
          stops++;
        },
      };
    },
  });
  await until(() => recovery.state.retryCount === 1);
  assert.equal(recovery.state.publicUrl, null);
  await recovery.stop();
  assert.equal(starts, 1);
  assert.equal(stops, 1);
  assert.equal(recovery.state.status, 'stopped');
});

test('hostname rotation stays unpublished until health passes and rejects stale results', async () => {
  let callbacks,
    stops = 0;
  const checks = [];
  const recovery = createInternetSession({
    localUrl: 'http://127.0.0.1:1234',
    startTunnel: async (options) => {
      callbacks = options;
      return {
        url: 'https://first.localhost.run',
        stop() {
          stops++;
        },
      };
    },
    check: (url) => new Promise((resolve) => checks.push({ url, resolve })),
  });
  await until(() => recovery.state.status === 'ready');
  callbacks.onPublicUrl('https://second.localhost.run');
  callbacks.onPublicUrl('https://third.localhost.run');
  assert.equal(recovery.state.publicUrl, null);
  await until(() => checks.length === 2);
  checks[0].resolve();
  await pause();
  assert.equal(recovery.state.publicUrl, null);
  checks[1].resolve();
  await until(() => recovery.state.status === 'ready');
  assert.equal(recovery.state.publicUrl, 'https://third.localhost.run');
  await recovery.stop();
  assert.equal(stops, 1);
  callbacks.onExit(1);
  assert.equal(recovery.state.status, 'stopped');
});

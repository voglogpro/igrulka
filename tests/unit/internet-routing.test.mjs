import test from 'node:test';
import assert from 'node:assert/strict';
import { startInternetTunnel } from '../../server/internet.mjs';

test('public routing falls back after failed health and closes only the failed helper', async () => {
  const published = [],
    stopped = [],
    checked = [];
  let activeExit;
  const provider =
    (name) =>
    async ({ onExit }) => {
      if (name === 'working') activeExit = onExit;
      return { url: `https://${name}.example`, stop: () => stopped.push(name) };
    };
  let disconnected = 0;
  const tunnel = await startInternetTunnel({
    providers: [provider('failed'), provider('working')],
    onPublicUrl: (value) => published.push(value),
    onExit: () => disconnected++,
    check: async (url, { successes }) => {
      checked.push(url);
      assert.equal(successes, 3);
      if (url.includes('failed')) throw Error('No public route');
    },
  });
  assert.equal(tunnel.url, 'https://working.example');
  assert.deepEqual(published, ['https://failed.example', null, 'https://working.example']);
  assert.deepEqual(stopped, ['failed']);
  assert.equal(checked.length, 2);
  activeExit(1);
  assert.equal(disconnected, 1);
});

test('a provider lost during health is discarded; cancellation never launches a fallback', async () => {
  let stop = 0,
    exit;
  await assert.rejects(
    startInternetTunnel({
      providers: [
        async ({ onExit }) => {
          exit = onExit;
          return { url: 'https://failed.example', stop: () => stop++ };
        },
      ],
      check: async () => exit(1),
    }),
    /закрылось/,
  );
  assert.equal(stop, 1);
  const controller = new AbortController();
  let fallback = 0;
  await assert.rejects(
    startInternetTunnel({
      signal: controller.signal,
      providers: [
        async () => {
          controller.abort();
          throw Error('Cancelled');
        },
        async () => fallback++,
      ],
    }),
    { name: 'AbortError' },
  );
  assert.equal(fallback, 0);
});

test('startup rotation is published and verified before acceptance; runtime and close remain guarded', async () => {
  const published = [];
  const checked = [];
  let rotate, exit;
  const tunnel = await startInternetTunnel({
    providers: [
      async ({ onUrlChange, onExit }) => {
        rotate = onUrlChange;
        exit = onExit;
        return { url: 'https://first.example', stop() {} };
      },
    ],
    onPublicUrl: (value) => published.push(value),
    check: async (url) => {
      checked.push(url);
      if (checked.length === 1) {
        rotate('https://unverified.example');
        throw Error('Old domain disappeared');
      }
    },
  });
  assert.deepEqual(checked, ['https://first.example', 'https://unverified.example']);
  assert.equal(tunnel.url, 'https://unverified.example');
  rotate('https://next.example');
  assert.equal(tunnel.url, 'https://next.example');
  exit(1);
  rotate('https://closed.example');
  assert.deepEqual(published, [
    'https://first.example',
    'https://unverified.example',
    'https://next.example',
  ]);
});

test('continuous startup rotation is bounded and discarded callbacks cannot overwrite fallback', async () => {
  let rotate,
    failedExit,
    checks = 0,
    stops = 0,
    exits = 0;
  const published = [];
  const tunnel = await startInternetTunnel({
    providers: [
      async ({ onUrlChange, onExit }) => {
        rotate = onUrlChange;
        failedExit = onExit;
        return { url: 'https://unstable.example', stop: () => stops++ };
      },
      async () => ({ url: 'https://fallback.example', stop() {} }),
    ],
    check: async (url) => {
      if (url !== 'https://fallback.example') rotate(`https://rotation${++checks}.example`);
    },
    onPublicUrl: (value) => published.push(value),
    onExit: () => exits++,
  });
  assert.equal(checks, 3);
  assert.equal(stops, 1);
  assert.equal(tunnel.url, 'https://fallback.example');
  const count = published.length;
  rotate('https://stale.example');
  failedExit(1);
  assert.equal(published.length, count);
  assert.equal(exits, 0);
  assert.equal(published.at(-1), 'https://fallback.example');
});

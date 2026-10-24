import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import {
  startQuickTunnel,
  publicTunnelUrl,
  verifiedBinary,
  TUNNEL_ASSETS,
  waitForPublicServer,
} from '../../server/tunnel.mjs';
import { createRoomServer } from '../../server/rooms.mjs';

test('only pinned binaries and Cloudflare public origins are accepted', () => {
  const bytes = Buffer.from('verified executable fixture');
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(verifiedBinary(bytes, hash), true);
  assert.equal(verifiedBinary(Buffer.concat([bytes, Buffer.from('x')]), hash), false);
  assert.ok(Object.values(TUNNEL_ASSETS).every(([, sum]) => /^[0-9a-f]{64}$/.test(sum)));
  assert.equal(
    publicTunnelUrl('Ready: https://gentle-river-fox.trycloudflare.com |'),
    'https://gentle-river-fox.trycloudflare.com',
  );
  assert.equal(publicTunnelUrl('http://wrong.trycloudflare.com'), null);
  assert.equal(publicTunnelUrl('https://untrusted.example.com'), null);
});

function processFixture() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = 0;
  child.kill = () => {
    child.killed++;
    child.emit('exit', 0);
  };
  return child;
}

test('internet launcher parses split output, hides helper windows and stops its owned process once', async () => {
  const child = processFixture();
  let options, args;
  const pending = startQuickTunnel({
    localUrl: 'http://127.0.0.1:3456',
    binary: 'verified-fixture',
    spawnProcess: (_, supplied, settings) => {
      args = supplied;
      options = settings;
      setImmediate(() => {
        child.stderr.write('Ready https://blue-');
        child.stderr.write('fox.trycloudflare.com\n');
        child.stderr.write('INF Registered tun');
        child.stderr.write('nel connection\n');
      });
      return child;
    },
  });
  const tunnel = await pending;
  assert.equal(tunnel.url, 'https://blue-fox.trycloudflare.com');
  assert.ok(args.includes('http://127.0.0.1:3456'));
  assert.ok(args.includes('--no-autoupdate'));
  assert.equal(options.windowsHide, true);
  assert.notEqual(options.shell, true);
  tunnel.stop();
  tunnel.stop();
  assert.equal(child.killed, 1);
});

test('tunnel failure times out and closes the helper, and rejects non-local origins', async () => {
  const child = processFixture();
  await assert.rejects(
    startQuickTunnel({
      localUrl: 'http://127.0.0.1:3456',
      binary: 'fixture',
      spawnProcess: () => child,
      timeoutMs: 20,
    }),
    /адрес/,
  );
  assert.equal(child.killed, 1);
  await assert.rejects(
    startQuickTunnel({ localUrl: 'http://192.168.1.9:3456', binary: 'fixture' }),
    /локальный/,
  );
});

test('connection lost during launch cannot return a live-looking handle, and abort cancels startup', async () => {
  const dying = processFixture();
  let notified = 0;
  await assert.rejects(
    startQuickTunnel({
      localUrl: 'http://127.0.0.1:3456',
      binary: 'fixture',
      onExit: () => notified++,
      spawnProcess: () => {
        setImmediate(() => {
          dying.stderr.write(
            'https://blue-fox.trycloudflare.com\nINF Registered tunnel connection\n',
          );
          dying.emit('exit', 1);
        });
        return dying;
      },
    }),
    /завершился/,
  );
  assert.equal(notified, 1);
  const pending = processFixture(),
    controller = new AbortController();
  const startup = startQuickTunnel({
    localUrl: 'http://127.0.0.1:3456',
    binary: 'fixture',
    signal: controller.signal,
    spawnProcess: () => {
      setImmediate(() => controller.abort());
      return pending;
    },
  });
  await assert.rejects(startup, { name: 'AbortError' });
  assert.equal(pending.killed, 1);
});

test('server-info publishes only the current public URL, does not trust Host and cannot mutate configuration', async (t) => {
  let publicUrl = null;
  const server = createRoomServer({ autoTick: false, serverInfo: () => ({ publicUrl }) });
  await new Promise((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.http.address().port}`;
  assert.deepEqual(await (await fetch(base + '/api/server-info')).json(), { publicUrl: null });
  publicUrl = 'https://blue-fox.trycloudflare.com';
  const response = await fetch(base + '/api/server-info', {
    headers: { Host: 'attacker.example' },
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { publicUrl });
  const probe = await fetch(base + '/api/connection-check');
  assert.equal(probe.headers.get('x-skyfront-probe'), '32k-v1');
  assert.equal(probe.headers.get('content-length'), '32768');
  assert.equal((await probe.arrayBuffer()).byteLength, 32768);
  assert.equal((await fetch(base + '/api/connection-check', { method: 'POST' })).status, 405);
  assert.equal(
    (await fetch(base + '/api/server-info', { method: 'POST', body: '{}' })).status,
    405,
  );
  assert.equal((await fetch(base + '/.tools/cloudflared/quick-config.yml')).status, 404);
});

test('invitation waits for actual public availability; persistent failure and cancellation never succeed', async () => {
  let checks = 0;
  await waitForPublicServer('https://blue-fox.trycloudflare.com', {
    retryMs: 1,
    check: async () => ++checks === 3,
  });
  assert.equal(checks, 3);
  await assert.rejects(
    waitForPublicServer('https://blue-fox.trycloudflare.com', {
      timeoutMs: 2,
      retryMs: 1,
      check: async () => false,
    }),
    /недоступен/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    waitForPublicServer('https://blue-fox.trycloudflare.com', {
      signal: controller.signal,
      check: async () => true,
    }),
    { name: 'AbortError' },
  );
});

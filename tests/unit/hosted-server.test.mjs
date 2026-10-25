import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { hostedConfig, startHostedServer } from '../../server/hosted.mjs';
import { PROTOCOL_VERSION } from '../../src/network/commands.js';

const env = { PUBLIC_URL: 'https://game.example', PORT: '0', HOST: '127.0.0.1' };
function get(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { Host: 'attacker.example', 'X-Forwarded-Host': 'attacker.example' },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}
test('hosted configuration requires explicit safe public HTTPS origin and valid bounds', () => {
  assert.equal(hostedConfig({ PUBLIC_URL: 'https://game.example' }).host, '0.0.0.0');
  assert.equal(hostedConfig({ PUBLIC_URL: 'https://game.example' }).maxRooms, 2);
  for (const value of [
    undefined,
    '',
    'http://game.example',
    'https://secret:password@example.com',
    'https://game.example/path',
    'https://game.example?token=secret',
  ]) {
    assert.throws(() => hostedConfig({ PUBLIC_URL: value }), /PUBLIC_URL/);
  }
  assert.throws(() => hostedConfig({ ...env, PORT: 'NaN' }), /PORT/);
  assert.throws(() => hostedConfig({ ...env, MAX_ROOMS: '0' }), /MAX_ROOMS/);
  assert.throws(() => hostedConfig({ ...env, CLIENT_URL: 'https://user:secret@example.com' }));
});
test('hosted metadata ignores forwarded host and health reveals no room data', async (t) => {
  const server = await startHostedServer({
    ...env,
    CLIENT_URL: 'https://voglogpro.github.io/igrulka/',
  });
  t.after(() => server.close());
  const port = server.http.address().port;
  assert.deepEqual(JSON.parse((await get(port, '/api/server-info')).body), {
    publicUrl: 'https://game.example',
    clientUrl: 'https://voglogpro.github.io/igrulka/',
    status: 'ready',
    retryCount: 0,
  });
  assert.deepEqual(await get(port, '/healthz'), { status: 200, body: '{"ok":true}' });
  assert.deepEqual(await get(port, '/healthz', 'HEAD'), { status: 200, body: '' });
  assert.equal((await get(port, '/healthz', 'POST')).status, 405);
  const html = await get(port, '/');
  assert.equal(html.status, 200);
  assert.match(html.body, /skyfront-distribution/);
});
test('hosted HTTP upgrade negotiates compression and delta co-op room encoding', async (t) => {
  const server = await startHostedServer(env);
  t.after(() => server.close());
  const socket = new WebSocket(`ws://127.0.0.1:${server.http.address().port}/match`);
  await once(socket, 'open');
  assert.match(socket.extensions, /permessage-deflate/);
  const joined = once(socket, 'message');
  socket.send(
    JSON.stringify({
      type: 'create',
      protocol: PROTOCOL_VERSION,
      mode: 'coop',
      name: 'Hosted smoke',
      snapshotEncoding: 'delta-v1',
    }),
  );
  const message = JSON.parse((await joined)[0]);
  assert.equal(message.type, 'joined');
  assert.equal(message.room.mode, 'coop');
  assert.equal(server.rooms.get(message.room.code).state.sides.length, 4);
  const room = server.rooms.get(message.room.code);
  assert.ok(room.players[0].socket.snapshotEncoder, 'existing delta encoder negotiated');
  socket.terminate();
});

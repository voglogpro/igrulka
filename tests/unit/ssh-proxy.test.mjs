import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PassThrough, Writable } from 'node:stream';
import { once } from 'node:events';
import { bridgeSshProxy } from '../../server/ssh-proxy.mjs';

async function fixture(t, handler) {
  const sockets = new Set();
  const server = http.createServer();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('connect', handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('CONNECT fixes allowed target, forwards Basic auth privately, preserves head/backpressure and EOF', async (t) => {
  let authorization, destination;
  const proxy = await fixture(t, (request, socket) => {
    destination = request.url;
    authorization = request.headers['proxy-authorization'];
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\nSSH-head\n');
    socket.pipe(socket);
  });
  const input = new PassThrough({ highWaterMark: 1024 });
  const chunks = [];
  const output = new Writable({
    highWaterMark: 512,
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      setTimeout(callback, 1);
    },
  });
  const finished = once(output, 'finish');
  const body = Buffer.alloc(256 * 1024, 73);
  const url = new URL(proxy);
  url.username = 'name';
  url.password = 'p%40ss';
  const bridged = bridgeSshProxy({ input, output, proxyLookup: async () => url });
  input.end(body);
  await bridged;
  await finished;
  assert.equal(destination, 'localhost.run:22');
  assert.equal(authorization, `Basic ${Buffer.from('name:p@ss').toString('base64')}`);
  assert.deepEqual(Buffer.concat(chunks), Buffer.concat([Buffer.from('SSH-head\n'), body]));
  assert.equal(input.listenerCount('error'), 0);
});

test('CONNECT rejection and timeout fail with sanitized errors and close sockets', async (t) => {
  for (const mode of ['reject', 'timeout']) {
    const proxy = await fixture(t, (request, socket) => {
      if (mode === 'reject')
        socket.end('HTTP/1.1 407 Authentication Required\r\n\r\nprivate-proxy-detail');
    });
    await assert.rejects(
      bridgeSshProxy({
        input: new PassThrough(),
        output: new PassThrough(),
        proxyLookup: async () => new URL(proxy),
        timeoutMs: 30,
      }),
      { message: 'SSH proxy connection failed' },
    );
  }
});

test('unsupported destination and missing proxy never create a transport', async () => {
  let calls = 0;
  await assert.rejects(
    bridgeSshProxy({ target: 'other.example:22', proxyLookup: async () => calls++ }),
    /Unsupported/,
  );
  assert.equal(calls, 0);
  await assert.rejects(bridgeSshProxy({ proxyLookup: async () => null }), /unavailable/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoomServer } from '../../server/rooms.mjs';
import { NetworkSession, SESSION_KEY, serverAddress } from '../../src/network/client.js';

async function until(predicate, timeout = 3000) {
  const deadline = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() > deadline) throw Error('Timed out waiting for network client');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(t) {
  const originals = Object.fromEntries(
    ['WebSocket', 'sessionStorage'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const storage = new Map();
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: WebSocket });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  });
  const server = createRoomServer({ autoTick: false });
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.disconnect();
    await server.close();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await new Promise((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.http.address().port}`;
  function client(callbacks = {}) {
    const session = new NetworkSession(callbacks);
    clients.push(session);
    return session;
  }
  return { server, storage, address, client };
}

async function playingPair(t, callbacks = {}) {
  const context = await fixture(t);
  const a = context.client(callbacks),
    b = context.client();
  await a.connect(context.address, { type: 'create' });
  await b.connect(context.address, { type: 'join', code: a.room.code });
  a.send({ type: 'ready', value: true });
  b.send({ type: 'ready', value: true });
  await until(() => a.room.players.every((p) => p?.ready));
  a.send({ type: 'start' });
  await until(() => a.latest && b.latest);
  return { ...context, a, b, room: context.server.rooms.get(a.room.code) };
}

test('server addresses normalize to the match endpoint and reject embedded credentials', () => {
  assert.equal(serverAddress('https://example.com:443/path?q=1#room'), 'wss://example.com/match');
  assert.equal(serverAddress('http://127.0.0.1:8788'), 'ws://127.0.0.1:8788/match');
  assert.throws(() => serverAddress('file:///tmp/game.html'));
  assert.throws(() => serverAddress('http://user:password@example.com'));
});

test('client snapshots protect interpolation samples from display mutations', async (t) => {
  let display;
  const { a, room } = await playingPair(t, { onState: (state) => (display = state) });
  const originalCredits = a.latest.state.sides[0].credits;
  display.sides[0].credits = -123;
  assert.equal(a.latest.state.sides[0].credits, originalCredits);
  assert.equal(room.state.sides[0].credits, originalCredits);
  assert.equal(a.room.phase, 'playing');
});

test('intentional leave removes credentials and does not emit an unsolicited close callback', async (t) => {
  const { client, address, server, storage } = await fixture(t);
  const closed = [];
  const session = client({ onClosed: (reason) => closed.push(reason) });
  await session.connect(address, { type: 'create' });
  assert.ok(storage.has(SESSION_KEY));
  const socket = session.socket;
  const didClose = new Promise((resolve) => socket.once('close', resolve));
  session.leave();
  await didClose;
  assert.equal(server.rooms.size, 0);
  assert.equal(storage.has(SESSION_KEY), false);
  assert.deepEqual(closed, []);
});

test('a peer ending the room notifies the client once and clears its saved seat', async (t) => {
  const closed = [];
  const { a, b, storage } = await playingPair(t, { onClosed: (reason) => closed.push(reason) });
  b.leave();
  await until(() => closed.length);
  assert.equal(closed.length, 1);
  assert.equal(a.intentional, true);
  assert.equal(storage.has(SESSION_KEY), false);
  assert.equal(a.pending.size, 0);
});

test('actual reconnect preserves the command sequence and resumes the same side', async (t) => {
  const { a, b, room, server } = await playingPair(t);
  assert.equal(await b.command('formation', { value: 'column' }), true);
  const token = b.token;
  room.players[1].socket.terminate();
  await until(() => b.retries > 0);
  const frozen = [room.tick, room.state.time];
  server.tick();
  assert.deepEqual([room.tick, room.state.time], frozen);
  assert.equal(typeof (await a.command('formation', { value: 'spread' })), 'string');
  await until(() => b.room.phase === 'playing' && b.socket.readyState === WebSocket.OPEN);
  assert.equal(b.token, token);
  assert.equal(b.side, 1);
  assert.equal(b.sequence, 1);
  assert.equal(await b.command('formation', { value: 'spread' }), true);
  assert.equal(b.sequence, 2);
  assert.deepEqual(room.state.formations, ['line', 'spread']);
});

test('interpolation follows the short turn across the angle boundary and stops during disconnect', () => {
  const session = new NetworkSession({});
  session.room = { phase: 'playing' };
  session.previous = {
    state: { time: 10, groundUnits: [{ id: 1, x: 0, yaw: Math.PI - 0.1 }] },
  };
  session.latest = {
    received: 100,
    state: { time: 10.1, groundUnits: [{ id: 1, x: 10, yaw: -Math.PI + 0.1 }] },
  };
  const display = structuredClone(session.latest.state);
  session.renderInto(display, 150);
  assert.ok(Math.abs(display.groundUnits[0].x - 5) < 1e-10);
  assert.ok(Math.abs(display.groundUnits[0].yaw - Math.PI) < 1e-10);
  assert.ok(Math.abs(display.time - 10.05) < 1e-10);
  session.room.phase = 'disconnected';
  session.renderInto(display, 200);
  assert.ok(Math.abs(display.groundUnits[0].x - 5) < 1e-10);
});

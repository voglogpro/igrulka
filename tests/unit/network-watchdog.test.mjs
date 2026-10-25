import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkSession, SESSION_KEY } from '../../src/network/client.js';

function fixture(t, callbacks = {}) {
  const sockets = [],
    storage = new Map();
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    constructor() {
      super();
      this.readyState = 0;
      this.sent = [];
      this.closes = 0;
      sockets.push(this);
    }
    send(raw) {
      this.sent.push(JSON.parse(raw));
    }
    close() {
      this.closes++;
      this.readyState = 2; /* A blackhole never completes native close. */
    }
    open() {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    }
    receive(message) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
    }
    closed() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }
  const originals = Object.fromEntries(
    ['WebSocket', 'sessionStorage'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
  });
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const session = new NetworkSession(callbacks);
  t.after(() => {
    session.disconnect();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const advance = (ms) => {
    while (ms > 0) {
      const delta = Math.min(ms, 250);
      now += delta;
      t.mock.timers.tick(delta);
      ms -= delta;
    }
  };
  async function join() {
    const ready = session.connect('http://127.0.0.1:8788', { type: 'create' });
    const socket = sockets.at(-1);
    socket.open();
    socket.receive({
      type: 'joined',
      token: 'private-seat',
      side: 1,
      lastSequence: 7,
      room: { code: 'ABCDE', phase: 'playing' },
    });
    await ready;
    return socket;
  }
  return { session, sockets, storage, advance, join };
}

test('an OPEN blackhole disconnects locally at fifteen seconds and resumes without waiting for native close', async (t) => {
  const rooms = [],
    closed = [];
  let session;
  const f = fixture(t, {
    onRoom: (room) => {
      rooms.push(room.phase);
      if (room.phase === 'disconnected')
        assert.equal(session.socket, null, 'detach before publishing disconnect');
    },
    onClosed: (reason) => closed.push(reason),
  });
  session = f.session;
  const old = await f.join(),
    saved = f.storage.get(SESSION_KEY);
  f.advance(12_000);
  assert.equal(old.closes, 0);
  const pending = session.command('formation', { value: 'column' });
  f.advance(3000);
  assert.match(await pending, /прервано/);
  assert.equal(session.socket, null);
  assert.equal(session.room.phase, 'disconnected');
  assert.equal(old.closes, 1);
  assert.equal(session.pending.size, 0);
  assert.equal(session.sequence, 8);
  assert.equal(f.storage.get(SESSION_KEY), saved);
  f.advance(750);
  const replacement = f.sockets.at(-1);
  assert.notEqual(replacement, old);
  replacement.open();
  assert.deepEqual(replacement.sent[0].type, 'resume');
  assert.equal(replacement.sent[0].token, 'private-seat');
  replacement.receive({
    type: 'joined',
    token: 'private-seat',
    side: 1,
    lastSequence: 8,
    room: { code: 'ABCDE', phase: 'playing' },
  });
  const next = session.command('formation', { value: 'spread' });
  old.receive({ type: 'ack', sequence: 9, result: 'stale' });
  old.receive({ type: 'closed', message: 'stale close' });
  old.closed();
  old.closed();
  assert.equal(session.socket, replacement);
  assert.equal(session.pending.size, 1);
  assert.equal(session.room.phase, 'playing');
  replacement.receive({ type: 'ack', sequence: 9, result: true });
  assert.equal(await next, true);
  f.advance(3000);
  assert.ok(
    replacement.sent.some((m) => m.type === 'ping'),
    'stale close cannot stop the replacement heartbeat',
  );
  assert.deepEqual(
    rooms.filter((v) => v === 'disconnected'),
    ['disconnected'],
  );
  assert.deepEqual(closed, []);
});

test('pong, room and snapshot messages refresh liveness, including a paused room', async (t) => {
  const f = fixture(t),
    socket = await f.join();
  for (const message of [
    { type: 'pong', clientTime: 0 },
    { type: 'room', room: { code: 'ABCDE', phase: 'disconnected' } },
    { type: 'snapshot', state: { time: 0, groundUnits: [] } },
  ]) {
    f.advance(12_000);
    socket.receive(message);
    assert.equal(socket.closes, 0);
  }
  f.advance(12_000);
  assert.equal(socket.closes, 0);
  f.advance(3000);
  assert.equal(socket.closes, 1);
});

test('a blackhole followed by a refused resume clears the saved seat once without losing the UI token or retrying', async (t) => {
  const closed = [],
    f = fixture(t, { onClosed: (reason) => closed.push(reason) });
  await f.join();
  const token = f.session.token;
  f.advance(12_000);
  const pending = f.session.command('formation', { value: 'column' });
  f.advance(3000);
  assert.match(await pending, /прервано/);
  assert.ok(f.storage.has(SESSION_KEY), 'ordinary disconnection preserves the seat');
  f.advance(750);
  const resume = f.sockets.at(-1);
  resume.open();
  resume.receive({ type: 'error', message: 'Комната не найдена' });
  resume.receive({ type: 'error', message: 'Повторный старый ответ' });
  resume.closed();
  f.advance(60_000);
  assert.deepEqual(closed, ['Комната не найдена']);
  assert.equal(f.storage.has(SESSION_KEY), false);
  assert.equal(f.session.token, token, 'the terminal UI guard still recognizes its session');
  assert.equal(f.session.pending.size, 0);
  assert.equal(f.session.intentional, true);
  assert.equal(f.sockets.length, 2);
});

test('an opened socket without a join handshake and a never-opened socket both settle without native close', async (t) => {
  const f = fixture(t),
    closed = [];
  f.session.onClosed = (reason) => closed.push(reason);
  const join = f.session.connect('http://127.0.0.1:8788', { type: 'create' });
  f.sockets[0].open();
  f.advance(15_000);
  await assert.rejects(join, /подключиться/);
  assert.equal(f.session.socket, null);
  assert.equal(f.sockets[0].closes, 1);
  assert.equal(closed.length, 1);
  assert.match(closed[0], /сервер запущен/);
  assert.doesNotMatch(closed[0], /восстанов|место/i);
  const next = f.session.connect('http://127.0.0.1:8788', { type: 'create' });
  f.advance(8000);
  await assert.rejects(next, /подключиться/);
  assert.equal(f.session.socket, null);
  assert.equal(f.sockets[1].closes, 1);
  assert.equal(closed.length, 2);
  assert.doesNotMatch(closed[1], /восстанов|место/i);
});

test('an explicit resume failure preserves the saved-seat recovery guidance before joined arrives', async (t) => {
  const closed = [],
    f = fixture(t, { onClosed: (message) => closed.push(message) });
  const attempt = f.session.connect('http://127.0.0.1:8788', {
    type: 'resume',
    code: 'ABC234',
    token: 'existing-seat',
  });
  f.advance(8000);
  await assert.rejects(attempt, /подключиться/);
  assert.equal(closed.length, 1);
  assert.match(closed[0], /Место можно восстановить/);
});

test('an established seat retains recovery guidance after reconnection attempts are exhausted', async (t) => {
  const closed = [],
    f = fixture(t, { onClosed: (message) => closed.push(message) }),
    socket = await f.join();
  f.session.retries = 12;
  socket.closed();
  assert.equal(closed.length, 1);
  assert.match(closed[0], /Место можно восстановить/);
  assert.ok(f.storage.has(SESSION_KEY));
});

test('intentional disconnect and leave never restart a socket; a disconnect callback can cancel recovery', async (t) => {
  const f = fixture(t),
    socket = await f.join();
  f.session.onRoom = (room) => {
    if (room.phase === 'disconnected') f.session.disconnect();
  };
  f.advance(15_000);
  f.advance(60_000);
  assert.equal(f.sockets.length, 1);
  assert.equal(socket.closes, 1);
  await f.join();
  f.session.leave();
  f.advance(60_000);
  assert.equal(f.sockets.length, 2);
  assert.equal(f.storage.has(SESSION_KEY), false);
});

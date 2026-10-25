import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { OutboundSnapshots } from '../../server/outbound-snapshots.mjs';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  callbacks = [];
  send(raw, callback) {
    this.messages.push(JSON.parse(raw));
    this.callbacks.push(callback);
  }
  complete() {
    this.callbacks.shift()?.();
  }
  close(code) {
    this.code = code;
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.close(1006);
  }
}

test('expensive generation sets a CPU pacing floor without delaying command replies', (t) => {
  let now = 0;
  const socket = new Socket(),
    queue = new OutboundSnapshots(socket, { now: () => now });
  t.after(() => queue.dispose());
  queue.requireAck = true;
  queue.snapshot(() => {
    now += 40;
    return { sync: { seq: 1 }, state: {} };
  });
  assert.equal(queue.diagnostics().generationMs, 40);
  assert.equal(queue.diagnostics().cpuFloorMs, 250);
  socket.complete();
  queue.control({ type: 'ack', sequence: 1 });
  assert.equal(socket.messages.at(-1).type, 'ack');
  socket.complete();
  queue.acknowledge(1);
  assert.ok(queue.diagnostics().intervalMs >= 250, 'fast ACK cannot defeat generation budget');
  queue.snapshot(() => ({ sync: { seq: 2 }, state: {} }));
  assert.equal(queue.diagnostics().snapshotsSerialized, 1);
  now = 250;
  queue.flush();
  socket.complete();
  queue.acknowledge(2);
  assert.equal(
    queue.diagnostics().intervalMs,
    225,
    'recovery is at most 25 ms per acknowledged world',
  );
});

test('a stalled write has a bounded reliable control queue and releases all pending references', () => {
  const socket = new Socket(),
    queue = new OutboundSnapshots(socket);
  queue.control({ type: 'joined' });
  for (let i = 0; i < 256; i++) queue.control({ type: 'ack', sequence: i });
  assert.equal(queue.diagnostics().controlsQueued, 256);
  queue.snapshot(() => ({ state: 'never encoded' }));
  queue.control({ type: 'ack', sequence: 257 });
  assert.equal(socket.code, 1013);
  assert.equal(queue.diagnostics().controlsQueued, 0);
  assert.equal(queue.diagnostics().pendingSnapshot, false);
  socket.complete();
  assert.equal(socket.messages.length, 1);
});

test('application ACK bounds serialization and controls bypass a slow snapshot consumer', (t) => {
  let now = 0,
    encoded = 0,
    revision = 0;
  const socket = new Socket(),
    queue = new OutboundSnapshots(socket, { now: () => now });
  t.after(() => queue.dispose());
  queue.requireAck = true;
  const produce = () => ({ type: 'snapshot', sync: { seq: ++encoded }, state: { revision } });
  queue.snapshot(produce);
  socket.complete();
  for (revision = 1; revision <= 1000; revision++) queue.snapshot(produce);
  assert.equal(encoded, 1);
  queue.control({ type: 'ack', sequence: 7 });
  socket.complete();
  queue.control({ type: 'pong' }, 'pong');
  socket.complete();
  assert.deepEqual(
    socket.messages.map((m) => m.type),
    ['snapshot', 'ack', 'pong'],
  );
  assert.equal(queue.acknowledge(99), false);
  now = 900;
  assert.equal(queue.acknowledge(1), true);
  assert.equal(encoded, 2);
  assert.equal(socket.messages.at(-1).state.revision, 1001);
  assert.equal(queue.diagnostics().intervalMs, 500);
  socket.complete();
  queue.resetSnapshots();
  now = 1500;
  queue.snapshot(produce);
  socket.complete();
  assert.equal(queue.acknowledge(2), false);
  assert.equal(queue.diagnostics().awaitingSeq, 3);
});

test('legacy TCP backlog keeps one lazy world without disconnecting at two megabytes', (t) => {
  const socket = new Socket(),
    queue = new OutboundSnapshots(socket);
  t.after(() => queue.dispose());
  socket.bufferedAmount = 2_100_000;
  let encoded = 0;
  for (let i = 0; i < 1000; i++) queue.snapshot(() => ({ state: ++encoded, i }));
  assert.equal(encoded, 0);
  assert.equal(socket.code, undefined);
  queue.control({ type: 'pong' }, 'pong');
  socket.complete();
  socket.bufferedAmount = 0;
  queue.flush();
  assert.equal(encoded, 1);
  assert.equal(socket.messages.at(-1).i, 999);
});

test('slow local writes serialize once and deliver controls before the newest world', (t) => {
  let now = 0;
  const socket = new Socket(),
    queue = new OutboundSnapshots(socket, { now: () => now });
  t.after(() => queue.dispose());
  queue.snapshot(() => ({ state: 1 }));
  for (let i = 2; i <= 200; i++) queue.snapshot(() => ({ state: i }));
  queue.control({ type: 'ack' });
  assert.equal(queue.diagnostics().snapshotsSerialized, 1);
  now = 300;
  socket.complete();
  assert.equal(socket.messages.at(-1).type, 'ack');
  socket.complete();
  assert.equal(socket.messages.at(-1).state, 200);
  socket.close(1000);
  socket.complete();
  assert.equal(queue.diagnostics().pendingSnapshot, false);
});

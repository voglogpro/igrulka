import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoomServer } from '../../server/rooms.mjs';

test('real slow WebSocket consumer stays connected, gets controls, resyncs and resumes', async (t) => {
  const server = createRoomServer({ autoTick: false });
  await new Promise((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `ws://127.0.0.1:${server.http.address().port}/match`;
  async function peer() {
    const socket = new WebSocket(url),
      messages = [];
    socket.on('message', (raw) => messages.push(JSON.parse(raw)));
    await new Promise((resolve) => socket.once('open', resolve));
    return {
      socket,
      messages,
      send: (m) => socket.send(JSON.stringify(m)),
      async next(predicate) {
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          const index = messages.findIndex(predicate);
          if (index >= 0) return messages.splice(index, 1)[0];
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw Error('No expected WebSocket message');
      },
    };
  }
  const a = await peer(),
    b = await peer();
  a.send({ type: 'create', mode: 'coop', snapshotEncoding: 'delta-v1' });
  const host = await a.next((m) => m.type === 'joined');
  b.send({ type: 'join', code: host.room.code });
  await b.next((m) => m.type === 'joined');
  a.send({ type: 'ready', value: true });
  b.send({ type: 'ready', value: true });
  await a.next((m) => m.type === 'room' && m.room.players.every((p) => p?.ready));
  a.send({ type: 'start' });
  const first = await a.next((m) => m.type === 'snapshot');
  const room = server.rooms.get(host.room.code),
    outbound = room.players[0].socket.outbound;
  for (let i = 0; i < 20; i++) server.tick();
  a.send({ type: 'ping', clientTime: 123 });
  await a.next((m) => m.type === 'pong' && m.clientTime === 123);
  a.send({ type: 'command', sequence: 1, command: 'invalid', args: {} });
  const ack = await a.next((m) => m.type === 'ack');
  assert.equal(Object.hasOwn(ack, 'state'), false);
  assert.equal(outbound.diagnostics().snapshotsSerialized, 1);
  assert.equal(outbound.diagnostics().pendingSnapshot, true);
  assert.equal(room.players[0].socket.readyState, WebSocket.OPEN);
  a.send({ type: 'snapshot-ack', seq: first.sync.seq });
  const latest = await a.next((m) => m.type === 'snapshot');
  assert.equal(latest.tick, room.tick);
  assert.equal(latest.sync.base, first.sync.seq);
  a.send({ type: 'resync' });
  const baseline = await a.next((m) => m.type === 'snapshot');
  assert.equal(baseline.sync.base, 0);
  assert.ok(baseline.sync.seq > latest.sync.seq);
  a.send({ type: 'snapshot-ack', seq: latest.sync.seq });
  a.send({ type: 'ping', clientTime: 124 });
  await a.next((m) => m.type === 'pong' && m.clientTime === 124);
  assert.equal(outbound.diagnostics().awaitingSeq, baseline.sync.seq);
  const closed = new Promise((resolve) => a.socket.once('close', resolve));
  a.socket.terminate();
  await closed;
  await b.next((m) => m.type === 'room' && m.room.phase === 'disconnected');
  const c = await peer();
  c.send({ type: 'resume', code: host.room.code, token: host.token, snapshotEncoding: 'delta-v1' });
  const resumed = await c.next((m) => m.type === 'joined');
  assert.equal(resumed.lastSequence, 1);
  const restored = await c.next((m) => m.type === 'snapshot');
  assert.equal(restored.sync.base, 0);
  assert.equal(restored.state.sides.length, 4);
});

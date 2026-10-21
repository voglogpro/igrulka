import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoomServer } from '../../server/rooms.mjs';
import { economy, makeGround } from '../../src/game/index.js';

class Peer {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.waiters = [];
    this.closeInfo = null;
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index < 0) this.messages.push(message);
      else this.waiters.splice(index, 1)[0].resolve(message);
    });
    socket.on('close', (code, reason) => {
      this.closeInfo = { code, reason: reason.toString() };
    });
    socket.on('error', () => {});
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  next(predicate, timeout = 2500) {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve: null };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(Error('Timed out waiting for WebSocket message'));
      }, timeout);
      waiter.resolve = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push(waiter);
    });
  }

  async closed(timeout = 2500) {
    if (this.closeInfo) return this.closeInfo;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Socket did not close')), timeout);
      this.socket.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
  }
}

async function fixture(t, options = {}) {
  const server = createRoomServer({ autoTick: false, seed: 1022, ...options });
  await new Promise((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `ws://127.0.0.1:${server.http.address().port}/match`;
  async function connect() {
    const peer = new Peer(new WebSocket(url));
    await new Promise((resolve, reject) => {
      peer.socket.once('open', resolve);
      peer.socket.once('error', reject);
    });
    return peer;
  }
  return { server, connect };
}

async function joinedPair(t, options) {
  const { server, connect } = await fixture(t, options);
  const a = await connect();
  a.send({ type: 'create', name: 'Alpha' });
  const host = await a.next((m) => m.type === 'joined');
  const b = await connect();
  b.send({ type: 'join', code: host.room.code, name: 'Bravo' });
  const guest = await b.next((m) => m.type === 'joined');
  return { server, connect, a, b, host, guest, room: server.rooms.get(host.room.code) };
}

async function startPair(pair) {
  const { a, b } = pair;
  a.send({ type: 'ready', value: true });
  b.send({ type: 'ready', value: true });
  await a.next((m) => m.type === 'room' && m.room.players.every((p) => p?.ready));
  a.send({ type: 'start' });
  const [viewA, viewB] = await Promise.all([
    a.next((m) => m.type === 'snapshot' && m.room.phase === 'playing'),
    b.next((m) => m.type === 'snapshot' && m.room.phase === 'playing'),
  ]);
  return { viewA, viewB };
}

test('two clients start one authoritative match; side 1 owns its commands and sees the same battle', async (t) => {
  const pair = await joinedPair(t);
  const { server, connect, a, b, host, guest, room } = pair;
  assert.equal(host.side, 0);
  assert.equal(guest.side, 1);
  assert.equal(host.lastSequence, 0);
  assert.equal(guest.lastSequence, 0);
  assert.equal(host.room.code.length, 6);
  assert.equal(server.rooms.size, 1);
  assert.equal(room.state.seed, 1022);
  assert.equal(room.state.mode, 'multiplayer');

  const third = await connect();
  third.send({ type: 'join', code: host.room.code, name: 'Charlie' });
  assert.equal((await third.next((m) => m.type === 'error')).type, 'error');
  assert.equal(room.players.length, 2);
  assert.equal(room.players[1].token, guest.token);

  b.send({ type: 'start' });
  assert.equal((await b.next((m) => m.type === 'error')).type, 'error');
  const { viewA, viewB } = await startPair(pair);
  assert.equal(viewA.state.sides[0].credits, viewB.state.sides[0].credits);
  assert.equal(economy(room.state, 0).bonus, 1);
  assert.equal(economy(room.state, 1).bonus, 1);
  assert.deepEqual(room.state.sides[0], room.state.sides[1]);

  const own = makeGround(room.state, 1, 'infantry', 330, 510);
  const foe = makeGround(room.state, 0, 'infantry', 390, 510);
  room.state.groundUnits.push(own, foe);
  b.send({
    type: 'command',
    sequence: 1,
    side: 0,
    command: 'formation',
    args: { value: 'spread' },
  });
  const formationAck = await b.next((m) => m.type === 'ack' && m.sequence === 1);
  assert.equal(formationAck.result, true);
  assert.deepEqual(room.state.formations, ['line', 'spread']);
  assert.deepEqual(formationAck.state.formations, ['spread', 'line']);
  assert.equal(formationAck.state.groundUnits.find((u) => u.id === own.id).side, 0);
  assert.equal(formationAck.state.groundUnits.find((u) => u.id === foe.id).side, 1);
  assert.equal(formationAck.state.groundUnits.find((u) => u.id === own.id).x, own.x);

  b.send({
    type: 'command',
    sequence: 2,
    side: 0,
    command: 'order',
    args: { ids: [foe.id], aim: { x: 350, z: 510, mode: 'move' } },
  });
  assert.ok((await b.next((m) => m.type === 'ack' && m.sequence === 2)).error);
  assert.equal(foe.order, null);
  b.send({
    type: 'command',
    sequence: 3,
    command: 'group',
    args: { index: 1, ids: [own.id] },
  });
  assert.deepEqual((await b.next((m) => m.type === 'ack' && m.sequence === 3)).result, [own.id]);
  assert.deepEqual(room.state.groups[1][1], [own.id]);

  const originalAI = structuredClone(room.state.ai);
  room.state.time = 231;
  room.state.ai.nextBuild = 0;
  room.state.ai.nextAttack = 0;
  const startingBuildings = room.state.buildings.length;
  for (let i = 0; i < 80; i++) server.tick();
  const [battleA, battleB] = await Promise.all([
    a.next((m) => m.type === 'snapshot' && m.tick === 80),
    b.next((m) => m.type === 'snapshot' && m.tick === 80),
  ]);
  assert.equal(room.state.buildings.length, startingBuildings);
  assert.equal(room.state.ai.nextBuild, 0);
  assert.equal(room.state.ai.nextAttack, 0);
  assert.equal(room.state.ai.roadPlan, originalAI.roadPlan);
  assert.equal(room.state.sides[0].credits, room.state.sides[1].credits);
  assert.equal(battleA.state.time, battleB.state.time);
  assert.equal(
    battleA.state.groundUnits.find((u) => u.id === own.id).hp,
    battleB.state.groundUnits.find((u) => u.id === own.id).hp,
  );
  assert.equal(
    battleA.state.groundUnits.find((u) => u.id === foe.id).hp,
    battleB.state.groundUnits.find((u) => u.id === foe.id).hp,
  );
  assert.equal(battleA.state.groundUnits.find((u) => u.id === own.id).side, 1);
  assert.equal(battleB.state.groundUnits.find((u) => u.id === own.id).side, 0);
  assert.ok(
    own.hp < own.maxHp || foe.hp < foe.maxHp,
    'the manual ticks should resolve live combat',
  );
});

test('disconnect freezes simulation and commands; resume restores the slot and sequence', async (t) => {
  const pair = await joinedPair(t);
  const { server, connect, a, b, guest, host, room } = pair;
  await startPair(pair);
  b.send({ type: 'command', sequence: 7, command: 'formation', args: { value: 'column' } });
  assert.equal((await b.next((m) => m.type === 'ack' && m.sequence === 7)).result, true);
  b.socket.close();
  await b.closed();
  await a.next((m) => m.type === 'snapshot' && m.room.phase === 'disconnected');
  const before = [room.tick, room.state.time, room.state.sides[0].credits];
  for (let i = 0; i < 10; i++) server.tick();
  assert.deepEqual([room.tick, room.state.time, room.state.sides[0].credits], before);
  a.send({ type: 'command', sequence: 1, command: 'formation', args: { value: 'spread' } });
  const frozenAck = await a.next((m) => m.type === 'ack' && m.sequence === 1);
  assert.ok(frozenAck.error);
  assert.deepEqual(room.state.formations, ['line', 'column']);

  const resumed = await connect();
  resumed.send({ type: 'resume', code: host.room.code, token: 'wrong-token' });
  assert.equal((await resumed.next((m) => m.type === 'error')).type, 'error');
  resumed.send({ type: 'resume', code: host.room.code, token: guest.token });
  const joined = await resumed.next((m) => m.type === 'joined');
  assert.equal(joined.side, 1);
  assert.equal(joined.lastSequence, 7);
  assert.equal(joined.token, guest.token);
  resumed.send({ type: 'command', sequence: 7, command: 'formation', args: { value: 'spread' } });
  assert.equal((await resumed.next((m) => m.type === 'error')).type, 'error');
  assert.deepEqual(room.state.formations, ['line', 'column']);
  resumed.send({ type: 'command', sequence: 8, command: 'formation', args: { value: 'spread' } });
  assert.equal((await resumed.next((m) => m.type === 'ack' && m.sequence === 8)).result, true);
  assert.deepEqual(room.state.formations, ['line', 'spread']);
  server.tick();
  assert.equal(room.tick, before[0] + 1);
  assert.ok(room.state.time > before[1]);
});

test('malformed frames and commands are contained; leaving closes a room for both peers', async (t) => {
  const pair = await joinedPair(t);
  const { a, b, server, host } = pair;
  await startPair(pair);
  a.socket.send('{');
  assert.equal((await a.next((m) => m.type === 'error')).type, 'error');
  a.socket.send(Buffer.from([1, 2, 3]), { binary: true });
  assert.equal((await a.next((m) => m.type === 'error')).type, 'error');
  a.send({ type: 'command', sequence: 1, command: 'not-a-command', args: {} });
  const unknown = await a.next((m) => m.type === 'ack' && m.sequence === 1);
  assert.ok(unknown.error);
  assert.equal(pair.room.state.formations[0], 'line');
  a.send({ type: 'leave' });
  const [closedA, closedB] = await Promise.all([
    a.next((m) => m.type === 'closed'),
    b.next((m) => m.type === 'closed'),
  ]);
  assert.equal(closedA.message, closedB.message);
  assert.equal(server.rooms.has(host.room.code), false);
  a.send({ type: 'command', sequence: 2, command: 'formation', args: { value: 'spread' } });
  assert.equal((await a.next((m) => m.type === 'error')).type, 'error');
});

test('WebSocket payload and per-second message limits close abusive sockets', async (t) => {
  const { connect } = await fixture(t, { now: () => 0 });
  const oversized = await connect();
  oversized.socket.send('x'.repeat(17_000));
  assert.equal((await oversized.closed()).code, 1009);

  const rapid = await connect();
  for (let i = 0; i < 41; i++) rapid.send({ type: 'ping', clientTime: i });
  assert.equal((await rapid.closed()).code, 1008);
});

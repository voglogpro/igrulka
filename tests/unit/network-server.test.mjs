import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoomServer } from '../../server/rooms.mjs';
import * as E from '../../src/game/index.js';
import { PROTOCOL_VERSION } from '../../src/network/commands.js';
const { economy, makeGround } = E;

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
  a.send({ type: 'create', protocol: PROTOCOL_VERSION, name: 'Alpha' });
  const host = await a.next((m) => m.type === 'joined');
  const b = await connect();
  b.send({ type: 'join', protocol: PROTOCOL_VERSION, code: host.room.code, name: 'Bravo' });
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

async function command(peer, name, args) {
  const sequence = (peer.sequence || 0) + 1;
  peer.sequence = sequence;
  peer.send({ type: 'command', protocol: PROTOCOL_VERSION, sequence, command: name, args });
  return peer.next((m) => m.type === 'ack' && m.sequence === sequence);
}

async function tickSnapshots(pair, count, beforeTick = () => {}) {
  for (let i = 0; i < count; i++) {
    beforeTick(pair.room.state);
    pair.server.tick();
    // Let real TCP writes/readers drain instead of manufacturing a slow-client disconnect.
    if ((i + 1) % 10 === 0) await new Promise(setImmediate);
  }
  assert.equal(pair.room.tick % 2, 0, 'snapshots are published on even authority ticks');
  return Promise.all(
    [pair.a, pair.b].map((peer) =>
      peer.next((m) => m.type === 'snapshot' && m.tick === pair.room.tick),
    ),
  );
}

test('internet WebSocket compression negotiates and keeps authoritative snapshots and commands intact', async (t) => {
  const pair = await joinedPair(t, { compression: true });
  assert.ok(pair.a.socket.extensions.includes('permessage-deflate'));
  assert.ok(pair.b.socket.extensions.includes('permessage-deflate'));
  const { viewA, viewB } = await startPair(pair);
  assert.equal(viewA.state.mode, 'multiplayer');
  assert.equal(viewB.state.buildings.find((b) => b.key === 'hq' && b.side === 0).x, 1015);
  const result = await command(pair.a, 'build', { key: 'power', x: -1070, z: -80 });
  assert.ok(result.result?.id);
  const [updatedA, updatedB] = await tickSnapshots(pair, 20);
  assert.equal(updatedA.state.time, updatedB.state.time);
  assert.ok(updatedA.state.buildings.some((b) => b.id === result.result.id && b.side === 0));
  assert.ok(updatedB.state.buildings.some((b) => b.id === result.result.id && b.side === 1));
});

function ground(pair, side, key, point) {
  const u = makeGround(pair.room.state, side, key, point.x, point.z);
  u.holdFire = true;
  pair.room.state.groundUnits.push(u);
  return u;
}

const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

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

  const own = makeGround(room.state, 1, 'infantry', 730, 510);
  const foe = makeGround(room.state, 0, 'infantry', 790, 510);
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
    args: { ids: [foe.id], aim: { x: 750, z: 510, mode: 'move' } },
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

test('old protocols are explicitly refused and protocol eight creates and joins a real room', async (t) => {
  const { server, connect } = await fixture(t);
  assert.equal(PROTOCOL_VERSION, 8);
  const host = await connect();
  host.send({ type: 'create', protocol: 5, name: 'Old host' });
  assert.match((await host.next((m) => m.type === 'error')).message, /Версии/);
  assert.equal(server.rooms.size, 0);
  host.send({ type: 'create', protocol: PROTOCOL_VERSION, name: 'Current host' });
  const joinedHost = await host.next((m) => m.type === 'joined');
  assert.equal(joinedHost.protocol, PROTOCOL_VERSION);
  assert.equal(joinedHost.side, 0);
  const guest = await connect();
  guest.send({ type: 'join', protocol: 2, code: joinedHost.room.code });
  assert.match((await guest.next((m) => m.type === 'error')).message, /Версии/);
  assert.equal(server.rooms.get(joinedHost.room.code).players[1], null);
  guest.send({ type: 'join', protocol: PROTOCOL_VERSION, code: joinedHost.room.code });
  const joinedGuest = await guest.next((m) => m.type === 'joined');
  assert.equal(joinedGuest.protocol, PROTOCOL_VERSION);
  assert.equal(joinedGuest.side, 1);
});

test('WebSocket auto-defense belongs to each owner and snapshots preserve only own observation and growing posts', async (t) => {
  const pair = await joinedPair(t);
  await startPair(pair);
  const { a, b, room } = pair;
  const peers = [a, b];
  for (const d of room.state.districts)
    d.owner = E.DISTRICTS.find((v) => v.id === d.id).x < 0 ? 0 : 1;
  room.state.networkRevision++;
  const defenders = [0, 1].map((side) => {
    const corridorId = side ? 'south' : 'north';
    const point = E.frontlineReport(room.state, side).posts.find(
      (p) => p.corridorId === corridorId && p.slot === 2,
    );
    const u = ground(pair, side, 'infantry', point);
    u.defensePost = { corridorId, slot: 2, row: 0 };
    return u;
  });
  const observed = [
    ground(pair, 0, 'infantry', { x: -850, z: -270 }),
    ground(pair, 1, 'infantry', { x: -800, z: -270 }),
  ];
  for (const u of defenders) {
    u.guard = { x: u.x, z: u.z };
    u.order = { ...u.guard, mode: 'guard' };
  }
  for (const side of [0, 1]) {
    const foreignBefore = defenders[1 - side].autoDefense;
    assert.ok(
      (await command(peers[side], 'auto-defense', { ids: [defenders[1 - side].id], enabled: true }))
        .error,
    );
    assert.equal(defenders[1 - side].autoDefense, foreignBefore);
    assert.equal(
      (await command(peers[side], 'auto-defense', { ids: [defenders[side].id], enabled: true }))
        .result,
      1,
    );
  }
  const snapshots = await tickSnapshots(pair, 280);
  for (const side of [0, 1]) {
    const view = snapshots[side].state;
    const own = view.groundUnits.find((u) => u.id === defenders[side].id);
    const enemy = view.groundUnits.find((u) => u.id === observed[1 - side].id);
    assert.equal(own.autoDefense, true);
    assert.ok(enemy, 'the observed enemy is present without future plans');
    assert.equal(Object.hasOwn(enemy, 'autoDefense'), false);
    assert.equal(Object.hasOwn(enemy, 'guard'), false);
    assert.ok(view.frontlineMemory[0].seen.some((v) => v.id === observed[1 - side].id));
    assert.deepEqual(view.frontlineMemory[1], { nextThink: 0, seen: [] });
    assert.equal(E.fortificationStatus(view.trenches.find((v) => v.id === own.trenchId)).level, 1);
    assert.equal(
      view.trenches.some((v) => v.id === defenders[1 - side].trenchId),
      false,
    );
    assert.deepEqual(
      E.frontlineReport(view, 0).polyline,
      E.frontlineReport(room.state, side).polyline,
    );
    assert.equal(
      (await command(peers[side], 'auto-defense', { ids: [own.id], enabled: false })).result,
      1,
    );
    assert.equal(defenders[side].autoDefense, false);
  }
});

test('WebSocket district commands capture for both sides, project control and pay for owner-only repair', async (t) => {
  const pair = await joinedPair(t);
  await startPair(pair);
  const { a, b, room } = pair;
  const left = E.DISTRICTS[0];
  const right = E.DISTRICTS[3];
  const zero = ground(pair, 0, 'infantry', { x: left.x - 20, z: left.z });
  const one = ground(pair, 1, 'infantry', { x: right.x + 20, z: right.z });
  assert.ok((await command(a, 'district', { ids: [one.id], id: right.id })).error);
  assert.ok((await command(b, 'district', { ids: [zero.id], id: left.id })).error);
  assert.equal(one.order, null);
  assert.equal(zero.order, null);
  assert.equal((await command(a, 'district', { ids: [zero.id], id: left.id })).result, 1);
  assert.equal((await command(b, 'district', { ids: [one.id], id: right.id })).result, 1);

  const [partialA, partialB] = await tickSnapshots(pair, 200);
  assert.equal(room.state.districts[0].owner, null);
  assert.equal(room.state.districts[3].owner, null);
  assert.ok(room.state.districts[0].control > 0 && room.state.districts[0].control < 1);
  assert.ok(room.state.districts[3].control < 0 && room.state.districts[3].control > -1);
  for (let i = 0; i < E.DISTRICTS.length; i++)
    near(partialA.state.districts[i].control, -partialB.state.districts[i].control);
  assert.equal(partialA.state.districts[0].capturing, 0);
  assert.equal(partialB.state.districts[3].capturing, 0);
  near(E.economy(partialA.state, 0).districts.materials, 0);
  near(E.economy(partialB.state, 0).districts.materials, 0);

  const materialsBefore = room.state.sides.map((s) => s.materials);
  const [capturedA, capturedB] = await tickSnapshots(pair, 300);
  assert.equal(room.state.districts[0].owner, 0);
  assert.equal(room.state.districts[3].owner, 1);
  assert.equal(capturedA.state.districts[0].owner, 0);
  assert.equal(capturedA.state.districts[3].owner, 1);
  assert.equal(capturedB.state.districts[0].owner, 1);
  assert.equal(capturedB.state.districts[3].owner, 0);
  assert.equal(capturedA.state.districts[0].control, 1);
  assert.equal(capturedB.state.districts[3].control, 1);
  near(E.economy(capturedA.state, 0).districts.materials, left.materials);
  near(E.economy(capturedB.state, 0).districts.materials, right.materials);
  assert.ok(room.state.sides.every((s, i) => s.materials > materialsBefore[i]));
  assert.ok(
    Math.abs(room.state.sides[0].materials - room.state.sides[1].materials) <=
      left.materials * 0.05 + 1e-7,
    'symmetric physical capture paths finish within one authority tick',
  );
  near(capturedA.state.sides[0].materials, room.state.sides[0].materials);
  near(capturedB.state.sides[0].materials, room.state.sides[1].materials);
  assert.equal(capturedA.state.sides[1].materials, 0, 'opponent reserves remain private');
  assert.equal(capturedB.state.sides[1].materials, 0, 'opponent reserves remain private');

  E.applyBlast(room.state, right.x, right.z, 10000, 20);
  const [destroyedA, destroyedB] = await tickSnapshots(pair, 2);
  assert.equal(destroyedA.state.districts[3].hp, 0);
  assert.equal(destroyedB.state.districts[3].hp, 0);
  assert.equal(destroyedB.state.districts[3].owner, 0);
  near(E.economy(destroyedB.state, 0).districts.materials, 0);
  assert.ok((await command(a, 'district-repair', { id: right.id, enabled: true })).error);
  assert.equal(room.state.districts[3].repairing, false);
  assert.equal((await command(b, 'district-repair', { id: right.id, enabled: true })).result, true);
  const before = { ...room.state.sides[1] };
  const earned = { credits: 0, materials: 0 };
  const [repairA, repairB] = await tickSnapshots(pair, 40, (s) => {
    const rates = E.economy(s, 1);
    earned.credits += rates.net * 0.05;
    earned.materials += rates.materials * 0.05;
  });
  const hp = room.state.districts[3].hp;
  assert.ok(hp > 0 && hp < right.hp);
  near(
    room.state.sides[1].credits,
    before.credits + earned.credits - hp * E.DISTRICT_RULES.repairCreditsPerHp,
  );
  near(
    room.state.sides[1].materials,
    before.materials + earned.materials - hp * E.DISTRICT_RULES.repairMaterialsPerHp,
  );
  near(repairA.state.districts[3].hp, repairB.state.districts[3].hp);
  near(repairB.state.sides[0].credits, room.state.sides[1].credits);
  assert.equal(repairB.state.districts[3].repairing, true);
});

test('side one queues routes and delivers real passengers over WebSocket without exposing future paths', async (t) => {
  const pair = await joinedPair(t);
  await startPair(pair);
  const { a, b, room } = pair;
  const walker = ground(pair, 1, 'infantry', { x: 730, z: 510 });
  const apc = ground(pair, 1, 'apc', { x: 730, z: 390 });
  const passenger = ground(pair, 1, 'infantry', { x: 724, z: 390 });
  ground(pair, 0, 'infantry', { x: 790, z: 510 });
  const first = { x: 850, z: 510, mode: 'move' };
  const second = { x: 850, z: 430, mode: 'move' };
  assert.ok((await command(a, 'route-add', { ids: [walker.id], aim: first })).error);
  assert.equal(walker.order, null);
  assert.equal((await command(b, 'route-add', { ids: [walker.id], aim: first })).result, 1);
  const appended = await command(b, 'route-add', { ids: [walker.id], aim: second });
  assert.equal(appended.result, 1);
  assert.deepEqual(walker.routeQueue, [second]);
  const ownWalker = appended.state.groundUnits.find((u) => u.id === walker.id);
  assert.equal(ownWalker.side, 0);
  assert.deepEqual(ownWalker.routeQueue, [second]);
  assert.equal((await command(b, 'board', { ids: [passenger.id], id: apc.id })).result, 1);
  await tickSnapshots(pair, 2);
  assert.equal(passenger.carrierId, apc.id);
  const deliveryPoint = { x: 880, z: 390 };
  assert.ok((await command(a, 'deliver', { id: apc.id, point: deliveryPoint })).error);
  assert.equal(apc.delivery, undefined);
  const delivered = await command(b, 'deliver', { id: apc.id, point: deliveryPoint });
  assert.equal(delivered.result, 1);
  assert.deepEqual(delivered.state.groundUnits.find((u) => u.id === apc.id).delivery, apc.delivery);

  const [movingA, movingB] = await tickSnapshots(pair, 20);
  assert.ok(apc.x > 350 && apc.x < deliveryPoint.x);
  assert.equal(passenger.carrierId, apc.id, 'passenger must ride until actual arrival');
  assert.ok(distance(passenger, apc) < 0.01);
  for (const id of [walker.id, apc.id]) {
    const enemy = movingA.state.groundUnits.find((u) => u.id === id);
    assert.ok(enemy, 'the observer must really see this enemy, rather than filtering it entirely');
    assert.equal(enemy.side, 1);
    for (const field of ['order', 'path', 'routeQueue', 'routeState', 'delivery', 'boardingId'])
      assert.equal(Object.hasOwn(enemy, field), false, `enemy snapshot leaked ${field}`);
  }
  assert.equal(
    movingA.state.groundUnits.some((u) => u.id === passenger.id),
    false,
  );
  assert.equal(movingB.state.groundUnits.find((u) => u.id === passenger.id).carrierId, apc.id);
  assert.equal(movingB.state.groundUnits.find((u) => u.id === walker.id).routeQueue.length, 1);

  const [, arrivedB] = await tickSnapshots(pair, 280);
  assert.equal(walker.routeState, null);
  assert.deepEqual(walker.routeQueue, []);
  assert.ok(distance(walker, second) < 4);
  assert.equal(apc.delivery, null);
  assert.ok(distance(apc, deliveryPoint) < 4);
  assert.equal(passenger.carrierId, null);
  assert.ok(distance(passenger, apc) <= 28);
  assert.equal(E.walkable(room.state, passenger.x, passenger.z, 0.84), true);
  assert.equal(arrivedB.state.groundUnits.find((u) => u.id === passenger.id).carrierId, null);
  assert.equal(arrivedB.state.groundUnits.find((u) => u.id === apc.id).delivery, null);
  assert.equal(
    new Set(room.state.groundUnits.map((u) => u.id)).size,
    room.state.groundUnits.length,
  );
});

test('both WebSocket players use private paid factory plans, preserve reserves and replace actual launches', async (t) => {
  const pair = await joinedPair(t);
  await startPair(pair);
  const { a, b, room } = pair;
  function ready(side, key, x, z) {
    const value = E.build(room.state, side, key, x, z);
    assert.notEqual(typeof value, 'string', value);
    value.hp = value.maxHp;
    value.progress = 1;
    return value;
  }
  const factories = [];
  const launchers = [];
  for (const side of [0, 1]) {
    const sign = side === 0 ? -1 : 1;
    factories.push(ready(side, 'factory', sign * (E.HQ_X + 65), -10));
    ready(side, 'power', sign * (E.HQ_X + 55), -80);
    launchers.push(ready(side, 'launcher', sign * (E.HQ_X - 65), -10));
    room.state.sides[side].credits = 5000;
    room.state.sides[side].materials = 116;
  }
  const plan = {
    key: 'drone',
    target: 2,
    reserveCredits: 1000,
    reserveMaterials: 100,
    enabled: true,
  };
  assert.ok((await command(a, 'factory-plan', { id: factories[1].id, plan })).error);
  assert.equal(factories[1].productionPlan, undefined);
  assert.ok((await command(b, 'factory-plan', { id: factories[0].id, plan })).error);
  assert.equal(factories[0].productionPlan, undefined);
  assert.equal((await command(a, 'factory-plan', { id: factories[0].id, plan })).result, true);
  assert.equal((await command(b, 'factory-plan', { id: factories[1].id, plan })).result, true);
  const [stockA, stockB] = await tickSnapshots(pair, 500);
  for (const [side, own] of [
    [0, stockA],
    [1, stockB],
  ]) {
    const f = room.state.sides[side];
    assert.equal(E.weaponStock(room.state, side, 'drone'), 2);
    assert.equal(factories[side].queue.length, 0);
    near(f.materials, 100);
    assert.ok(f.credits >= plan.reserveCredits);
    assert.equal(E.weaponStock(own.state, 0, 'drone'), 2);
    assert.deepEqual(
      own.state.buildings.find((u) => u.id === factories[side].id).productionPlan,
      plan,
    );
    const opponent = own.state.buildings.find((u) => u.id === factories[1 - side].id);
    assert.equal(Object.hasOwn(opponent, 'productionPlan'), false);
    assert.equal(Object.hasOwn(opponent, 'queue'), false);
  }
  const launch = await command(b, 'launch', {
    key: 'drone',
    aim: { x: -800, z: 400 },
    count: 1,
    siteId: launchers[1].id,
  });
  assert.equal(launch.result, 1);
  assert.equal(E.weaponStock(room.state, 1, 'drone'), 1);
  const [, waitingB] = await tickSnapshots(pair, 20);
  assert.equal(factories[1].queue.length, 0, 'replacement cannot spend the material reserve');
  assert.equal(E.factoryPlanStatus(waitingB.state, 0, factories[1].id).status, 'materials');
  near(room.state.sides[1].materials, 100);
  room.state.sides[1].materials += E.WEAPONS.drone.metal;
  const [, replacedB] = await tickSnapshots(pair, 300);
  assert.equal(E.weaponStock(room.state, 1, 'drone'), 2);
  assert.equal(E.weaponStock(replacedB.state, 0, 'drone'), 2);
  assert.equal(E.factoryPlanStatus(replacedB.state, 0, factories[1].id).status, 'stock');
  near(room.state.sides[1].materials, 100);
  assert.ok(room.state.sides[1].credits >= plan.reserveCredits);
  assert.equal(E.weaponStock(room.state, 0, 'drone'), 2);
  assert.equal(factories[0].queue.length, 0);
  assert.equal(
    room.state.units.filter((u) => u.side === 1 && u.sourceId === launchers[1].id).length,
    1,
  );
});

test('team room: two humans command one side against the bot at the chosen difficulty', async (t) => {
  const { server, connect } = await fixture(t);
  const a = await connect();
  a.send({
    type: 'create',
    protocol: PROTOCOL_VERSION,
    name: 'Alpha',
    mode: 'coop',
    difficulty: 'ultra',
  });
  const host = await a.next((m) => m.type === 'joined');
  assert.equal(host.room.mode, 'coop');
  assert.equal(host.room.difficulty, 'ultra');
  assert.equal(host.side, 0);
  const b = await connect();
  b.send({ type: 'join', protocol: PROTOCOL_VERSION, code: host.room.code, name: 'Bravo' });
  const guest = await b.next((m) => m.type === 'joined');
  assert.equal(guest.side, 0, 'the second human is on the same side');
  assert.equal(guest.seat, 1);
  const room = server.rooms.get(host.room.code);
  assert.equal(room.state.mode, 'coop');
  assert.equal(room.state.difficulty, 'ultra');
  const pair = { server, connect, a, b, host, guest, room };
  const { viewA, viewB } = await startPair(pair);
  assert.equal(viewA.state.buildings.find((x) => x.key === 'hq' && x.side === 0).id, 1);
  assert.equal(viewB.state.buildings.find((x) => x.key === 'hq' && x.side === 0).id, 1);
  // Either human spends the shared treasury; the other sees the same building.
  room.state.sides[0].credits = 20000;
  room.state.sides[0].materials = 2000;
  const placed = await command(b, 'build', { key: 'power', x: -1070, z: -80 });
  assert.equal(placed.error, undefined, placed.error);
  server.tick();
  server.tick();
  const seenByHost = await a.next(
    (m) =>
      m.type === 'snapshot' && m.state.buildings.some((x) => x.key === 'power' && x.side === 0),
  );
  assert.ok(seenByHost);
  // The bot runs and the economy bonus follows the difficulty.
  for (let i = 0; i < 400; i++) server.tick();
  assert.ok(room.state.buildings.filter((x) => x.side === 1).length > 2, 'the bot builds');
  assert.equal(E.economy(room.state, 1).bonus, 1.45);
  assert.equal(E.economy(room.state, 0).bonus, 1);
  const bad = await connect();
  bad.send({ type: 'create', protocol: PROTOCOL_VERSION, mode: 'coop', difficulty: 'nightmare' });
  assert.match((await bad.next((m) => m.type === 'error')).message, /сложность/);
});

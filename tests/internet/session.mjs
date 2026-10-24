import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { serverAddress } from '../../src/network/client.js';
import { PROTOCOL_VERSION } from '../../src/network/commands.js';
import * as E from '../../src/game/index.js';
import { internetAgent } from '../../server/proxy.mjs';

const argument = (name) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const target = argument('url');
if (!target) {
  console.error(
    'Usage: node tests/internet/session.mjs --url=https://your-session.trycloudflare.com',
  );
  process.exit(2);
}
const endpoint = serverAddress(target);
const agent = await internetAgent(endpoint);
const timeout = Math.min(60_000, Math.max(1000, Number(argument('timeout-ms')) || 20_000));
const peers = new Set();
const startedAt = performance.now();
const metrics = {
  ok: false,
  protocol: PROTOCOL_VERSION,
  transport: new URL(endpoint).protocol,
  checks: [],
  snapshots: 0,
  commands: 0,
  receivedBytes: 0,
  peerClosures: [],
};
let stage = 'connect',
  host = null,
  roomCreated = false;

class Peer {
  constructor(label) {
    this.label = label;
    this.socket = new WebSocket(endpoint, {
      handshakeTimeout: timeout,
      maxPayload: 16_000_000,
      agent,
      rejectUnauthorized: true,
    });
    this.messages = [];
    this.waiters = [];
    this.sequence = 0;
    this.socket.on('error', () => {});
    this.socket.on('close', (code) => {
      this.closeCode = code;
      metrics.peerClosures.push({ peer: this.label, code });
      for (const waiter of this.waiters.splice(0))
        waiter.reject(Error(`${this.label}: connection closed (${code})`));
    });
    this.socket.on('message', (raw) => {
      metrics.receivedBytes += raw.length;
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === 'snapshot') {
        this.latest = message;
        metrics.snapshots++;
      }
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(message);
      else {
        this.messages.push(message);
        if (this.messages.length > 80) this.messages.shift();
      }
    });
    peers.add(this);
  }
  async open() {
    await once(this.socket, 'open', { signal: AbortSignal.timeout(timeout) });
    return this;
  }
  send(message) {
    this.socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, ...message }));
  }
  next(predicate, description) {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    if (this.closeCode != null)
      return Promise.reject(Error(`${this.label}: connection closed (${this.closeCode})`));
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve: null, reject: null };
      const timer = setTimeout(() => {
        const current = this.waiters.indexOf(waiter);
        if (current >= 0) this.waiters.splice(current, 1);
        reject(Error(`${this.label}: timeout waiting for ${description}`));
      }, timeout);
      waiter.resolve = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
      waiter.reject = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      this.waiters.push(waiter);
    });
  }
  async join(request) {
    this.send(request);
    const reply = await this.next(
      (m) => m.type === 'joined' || m.type === 'error',
      'join acknowledgement',
    );
    assert.equal(
      reply.type,
      'joined',
      'server must accept the requested join with the current protocol',
    );
    assert.equal(reply.protocol, PROTOCOL_VERSION, 'server protocol must match the local build');
    this.sequence = reply.lastSequence || 0;
    return reply;
  }
  command(command, args) {
    const sequence = ++this.sequence;
    metrics.commands++;
    this.send({ type: 'command', sequence, command, args });
    return this.next(
      (m) => m.type === 'ack' && m.sequence === sequence,
      `${command} acknowledgement`,
    );
  }
  snapshot(predicate = () => true) {
    return this.next((m) => m.type === 'snapshot' && predicate(m), 'authoritative snapshot');
  }
}

function check(name) {
  metrics.checks.push(name);
}
function buildPosition(view) {
  const headquarters = view.buildings.find(
    (building) => building.side === 0 && building.key === 'hq',
  );
  assert.ok(headquarters, 'own headquarters must be present in the projected view');
  const sign = Math.sign(headquarters.x) || -1;
  for (const [offsetX, z] of [
    [55, -80],
    [65, -40],
    [65, 40],
    [-55, -80],
    [-55, 80],
    [40, 80],
  ]) {
    const point = { x: headquarters.x + sign * offsetX, z };
    const result = E.build(structuredClone(view), 0, 'power', point.x, point.z);
    if (result && typeof result !== 'string') return point;
  }
  throw Error('No valid initial power-station site found beside the own road network');
}

try {
  host = await new Peer('host').open();
  const hostJoin = await host.join({ type: 'create', name: 'Internet QA Alpha', mode: 'pvp' });
  roomCreated = true;
  let guest = await new Peer('guest').open();
  const guestJoin = await guest.join({
    type: 'join',
    code: hostJoin.room.code,
    name: 'Internet QA Bravo',
  });
  assert.equal(hostJoin.side, 0, 'host must command side 0');
  assert.equal(guestJoin.side, 1, 'guest must command side 1');
  check('two independent WebSocket clients created and joined one room');

  stage = 'ready/start';
  guest.send({ type: 'start' });
  const deniedStart = await guest.next((m) => m.type === 'error', 'guest start rejection');
  assert.ok(deniedStart.message, 'guest cannot start the match');
  host.send({ type: 'ready', value: true });
  guest.send({ type: 'ready', value: true });
  await host.next(
    (m) => m.type === 'room' && m.room.players.every((player) => player?.ready),
    'both ready',
  );
  host.send({ type: 'start' });
  const [initialHost, initialGuest] = await Promise.all([
    host.snapshot((m) => m.room.phase === 'playing'),
    guest.snapshot((m) => m.room.phase === 'playing'),
  ]);
  const hostHQ = initialHost.state.buildings.find((b) => b.key === 'hq' && b.side === 0);
  const guestHQ = initialGuest.state.buildings.find((b) => b.key === 'hq' && b.side === 0);
  assert.ok(hostHQ.x < 0 && guestHQ.x > 0, 'each player sees its own real headquarters as side 0');
  assert.equal(initialHost.state.mode, 'multiplayer');
  assert.equal(initialGuest.state.mode, 'multiplayer');
  check('explicit readiness, host-only start and opposite player perspectives');

  stage = 'build/authority';
  const firstBuild = await host.command('build', {
    key: 'power',
    ...buildPosition(initialHost.state),
  });
  assert.ok(!firstBuild.error && firstBuild.result?.id, 'host own build must succeed');
  const secondBuild = await guest.command('build', {
    key: 'power',
    ...buildPosition(initialGuest.state),
  });
  assert.ok(!secondBuild.error && secondBuild.result?.id, 'guest own build must succeed');
  const builtIds = [firstBuild.result.id, secondBuild.result.id];
  const [builtHost, builtGuest] = await Promise.all([
    host.snapshot((m) => builtIds.every((id) => m.state.buildings.some((b) => b.id === id))),
    guest.snapshot((m) => builtIds.every((id) => m.state.buildings.some((b) => b.id === id))),
  ]);
  assert.equal(builtHost.state.buildings.find((b) => b.id === builtIds[1]).side, 1);
  assert.equal(builtGuest.state.buildings.find((b) => b.id === builtIds[1]).side, 0);
  const forbidden = await host.command('demolish', { id: builtIds[1] });
  assert.ok(forbidden.error, 'foreign demolition must be rejected by the server');
  assert.ok(
    forbidden.state.buildings.find((b) => b.id === builtIds[1]).hp > 0,
    'foreign building remains alive',
  );
  check('own construction synchronizes; server refuses foreign ownership commands');

  stage = 'disconnect/freeze';
  const formation = await guest.command('formation', { value: 'column' });
  assert.equal(formation.result, true);
  const previousSequence = guest.sequence;
  guest.socket.terminate();
  const frozen = await host.snapshot((m) => m.room.phase === 'disconnected');
  const freezeTime = frozen.state.time,
    freezeCredits = frozen.state.sides[0].credits;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const refused = await host.command('formation', { value: 'spread' });
  assert.ok(refused.error, 'commands are blocked while the other player is disconnected');
  assert.equal(
    host.latest.state.time,
    freezeTime,
    'no advancing snapshots arrive during disconnect',
  );
  check('disconnect freezes simulation, economy and commands');

  stage = 'resume';
  host.messages = host.messages.filter((message) => message.type !== 'snapshot');
  guest = await new Peer('resumed guest').open();
  const resumeAt = performance.now();
  const resumed = await guest.join({
    type: 'resume',
    code: hostJoin.room.code,
    token: guestJoin.token,
  });
  metrics.resumeMs = Math.round(performance.now() - resumeAt);
  assert.ok(resumed.token === guestJoin.token, 'resume preserves the private slot token');
  assert.equal(resumed.lastSequence, previousSequence, 'resume preserves command sequence');
  assert.equal(resumed.side, 1, 'resumed guest retains side 1');
  const [resumedView, resumedHost] = await Promise.all([
    guest.snapshot((m) => m.room.phase === 'playing'),
    host.snapshot((m) => m.room.phase === 'playing'),
  ]);
  assert.equal(
    resumedView.state.time,
    freezeTime,
    'first resume snapshot proves authority time stayed frozen',
  );
  assert.equal(
    resumedHost.state.sides[0].credits,
    freezeCredits,
    'economy also stayed frozen during disconnect',
  );
  assert.equal(resumedView.state.formations[0], 'column', 'guest formation survives reconnect');
  const afterResume = await guest.command('formation', { value: 'spread' });
  assert.equal(afterResume.result, true, 'next command succeeds with restored sequence');
  await host.snapshot((m) => m.room.phase === 'playing' && m.state.time > freezeTime);
  check('resume restores slot, token, sequence and projected state; simulation continues');

  stage = 'cleanup';
  host.send({ type: 'leave' });
  await Promise.all([
    host.next((m) => m.type === 'closed', 'room closed'),
    guest.next((m) => m.type === 'closed', 'room closed'),
  ]);
  roomCreated = false;
  const probe = await new Peer('closed-room probe').open();
  probe.send({ type: 'join', code: hostJoin.room.code, name: 'Internet QA Probe' });
  await probe.next((m) => m.type === 'error', 'removed room rejection');
  check('leave closes both sessions and removes the room');
  metrics.ok = true;
} catch (error) {
  metrics.stage = stage;
  metrics.error = error.message;
  process.exitCode = 1;
} finally {
  if (roomCreated && host?.socket.readyState === WebSocket.OPEN) host.send({ type: 'leave' });
  for (const peer of peers) peer.socket.terminate();
  metrics.elapsedMs = Math.round(performance.now() - startedAt);
  // Never print messages, request objects, join replies, resume tokens or state payloads.
  console.log(JSON.stringify(metrics, null, 2));
}

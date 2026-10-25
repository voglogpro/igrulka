import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createRoomServer } from '../../server/rooms.mjs';
import { NetworkSession } from '../../src/network/client.js';
import { loadFixture } from '../support/network-load.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate) {
  const deadline = performance.now() + 8000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, 'network phase did not settle');
    await sleep(5);
  }
}
const duration = Number(process.argv.find((s) => s.startsWith('--seconds='))?.split('=')[1] || 12);
const results = [];
globalThis.sessionStorage = {
  setItem() {},
  removeItem() {},
  getItem() {
    return null;
  },
};

async function run(air, delay) {
  let bytes = 0,
    frames = 0,
    decoded = 0,
    disconnects = 0,
    phaseFailures = 0;
  class DelayedSocket extends WebSocket {
    constructor(url) {
      super(url);
      this.ackDelay = DelayedSocket.nextDelay;
      this.on('message', (raw) => {
        bytes += raw.length;
        frames++;
      });
    }
    send(raw, ...args) {
      if (JSON.parse(raw).type === 'snapshot-ack' && this.ackDelay) {
        const timer = setTimeout(() => {
          if (this.readyState === WebSocket.OPEN) super.send(raw, ...args);
        }, this.ackDelay);
        timer.unref();
      } else super.send(raw, ...args);
    }
  }
  globalThis.WebSocket = DelayedSocket;
  const server = createRoomServer();
  const sessions = [];
  try {
    await new Promise((resolve) => server.http.listen(0, '127.0.0.1', resolve));
    const address = `ws://127.0.0.1:${server.http.address().port}`;
    const make = () => {
      const session = new NetworkSession({
        onState() {
          decoded++;
        },
        onRoom(room) {
          if (room.phase === 'disconnected') phaseFailures++;
        },
        onClosed() {
          disconnects++;
        },
      });
      sessions.push(session);
      return session;
    };
    DelayedSocket.nextDelay = 0;
    const host = make();
    await host.connect(address, { type: 'create', mode: 'coop' });
    DelayedSocket.nextDelay = delay;
    const guest = make();
    await guest.connect(address, { type: 'join', code: host.room.code });
    const room = server.rooms.get(host.room.code);
    room.state = loadFixture(air);
    host.send({ type: 'ready', value: true });
    guest.send({ type: 'ready', value: true });
    await waitFor(() => host.room.players.every((p) => p?.ready));
    host.send({ type: 'start' });
    await waitFor(() => guest.room.phase === 'playing');
    assert.equal(host.side, 0);
    assert.equal(guest.side, 2);
    assert.equal(room.state.buildings.filter((b) => b.key === 'hq').length, 4);
    assert.equal(room.state.groundUnits.length, 480);
    const start = performance.now(),
      tick = room.tick,
      rtts = [],
      peaks = { bufferedBytes: 0, pendingSnapshots: 0, controls: 0, projectiles: 0, air: 0 };
    let nextCommand = start;
    const observedProjectiles = new Set(),
      observedAirProjectiles = new Set();
    while (performance.now() - start < duration * 1000) {
      if (performance.now() >= nextCommand) {
        nextCommand += 1000;
        await Promise.all(
          sessions.map(async (session) => {
            session.send({ type: 'ping', clientTime: performance.now() });
            const at = performance.now(),
              result = await session.command('formation', {
                value: rtts.length % 2 ? 'line' : 'column',
              });
            assert.equal(result, true);
            rtts.push(performance.now() - at);
          }),
        );
      }
      for (const player of room.players) {
        const d = player.socket.outbound.diagnostics();
        peaks.bufferedBytes = Math.max(peaks.bufferedBytes, player.socket.bufferedAmount);
        peaks.pendingSnapshots = Math.max(peaks.pendingSnapshots, Number(d.pendingSnapshot));
        peaks.controls = Math.max(peaks.controls, d.controlsQueued);
      }
      peaks.projectiles = Math.max(peaks.projectiles, room.state.projectiles.length);
      peaks.air = Math.max(peaks.air, room.state.units.length);
      for (const p of room.state.projectiles) {
        observedProjectiles.add(p.id);
        if (p.domain !== 'ground') observedAirProjectiles.add(p.id);
      }
      assert.equal(host.room.phase, 'playing');
      assert.equal(guest.room.phase, 'playing');
      await sleep(25);
    }
    rtts.sort((a, b) => a - b);
    const elapsed = (performance.now() - start) / 1000;
    const report = {
      air,
      ground: 480,
      ackDelayMs: delay,
      elapsedSeconds: elapsed,
      ticks: room.tick - tick,
      ticksPerSecond: (room.tick - tick) / elapsed,
      commandRttMs: {
        p50: rtts[Math.floor(rtts.length * 0.5)],
        p95: rtts[Math.floor(rtts.length * 0.95)],
        max: rtts.at(-1),
        count: rtts.length,
      },
      peaks,
      observedProjectileIds: observedProjectiles.size,
      observedAirProjectileIds: observedAirProjectiles.size,
      buildingAAShots: room.state.stats.shots,
      frames,
      decoded,
      authoritativeSides: [host.side, guest.side],
      headquarters: room.state.buildings.filter((b) => b.key === 'hq').length,
      finalPhase: [host.room.phase, guest.room.phase],
      snapshotEncoding: 'delta-v1',
      receivedBytes: bytes,
      disconnects,
      paused: phaseFailures,
      writers: room.players.map((p) => p.socket.outbound.diagnostics()),
    };
    console.log(JSON.stringify(report));
    results.push(report);
    assert.ok(observedProjectiles.size > 0, 'fixture must really fire');
    assert.ok(observedAirProjectiles.size > 0, 'fixture must include actual AA firing');
    assert.ok(peaks.projectiles > 0);
    assert.ok(decoded >= 4);
    assert.equal(disconnects, 0);
    assert.equal(phaseFailures, 0);
    assert.ok(peaks.pendingSnapshots <= 1);
    assert.ok(peaks.controls <= 256);
    report.passed = true;
  } finally {
    for (const session of sessions) session.disconnect();
    await server.close();
  }
}
try {
  for (const [air, delay] of [
    [10, 500],
    [20, 500],
    [100, 1200],
    [400, 1200],
  ])
    await run(air, delay);
} finally {
  await mkdir('artifacts/qa', { recursive: true });
  await writeFile(
    'artifacts/qa/network-load8102.json',
    JSON.stringify(
      {
        transport: 'real loopback TCP WebSocket; NetworkSession decoder; delayed application ACK',
        results,
      },
      null,
      2,
    ),
  );
}

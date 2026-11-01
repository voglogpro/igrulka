// QA-only, original room server and original NetworkSession. No manual ticks/grants.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { createRoomServer } from '../server/rooms.mjs';
import { NetworkSession } from '../src/network/client.js';
import * as E from '../src/game/index.js';
import { placementPlan } from '../src/game/city/construction.js';

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function until(test, label, timeout = 90000) {
  const end = performance.now() + timeout;
  while (!test()) {
    if (performance.now() > end) throw Error('Timed out: ' + label);
    await delay(25);
  }
}
export const wallet = (side) =>
  Object.fromEntries(
    ['credits', 'materials', 'oil', 'components'].map((key) => [key, side[key] || 0]),
  );
const ammunition = (b) =>
  Object.fromEntries(
    ['groundAmmo', 'ammoReserve', 'ammo', 'missiles', 'reserve']
      .filter((k) => b[k] !== undefined)
      .map((k) => [k, b[k]]),
  );
const signature = (b) => ({
  id: b.id,
  key: b.key,
  side: b.side,
  x: b.x,
  z: b.z,
  hp: b.hp,
  maxHp: b.maxHp,
  progress: b.progress,
  demolished: !!b.demolished,
  ammunition: ammunition(b),
});

export async function createReconnectHost(log = () => {}) {
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: WebSocket });
  const storage = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      setItem: (k, v) => storage.set(k, v),
      getItem: (k) => storage.get(k) || null,
      removeItem: (k) => storage.delete(k),
    },
  });
  const server = createRoomServer({ autoTick: true });
  const checks = [],
    ledger = [],
    frames = new Map(),
    errors = [];
  const report = {
    passed: false,
    scope: 'Original authority with a real reconnecting guest; loopback only',
    manualTicks: false,
    grants: false,
    checks,
    ledger,
  };
  let host,
    control,
    room,
    hostBuildingId,
    armed,
    freeze,
    reattach,
    recovered,
    closed = false,
    completed = false,
    failure,
    guestEpoch = 0,
    guestPrivate,
    freezeTask;
  const roomPhase = () => host?.room?.phase;
  function check(name, passed, detail) {
    checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
    if (!passed) throw Error(name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  }
  function summary() {
    const state = room.state;
    return {
      tick: room.tick,
      time: state.time,
      rng: state.rng,
      hash: createHash('sha256').update(E.save(state)).digest('hex'),
      wallets: state.sides.map(wallet),
      inventories: state.sides.map((s) => ({ ...s.inventory })),
      ammoStocks: state.sides.map((s) => ({ ...s.ammoStock })),
      buildings: state.buildings
        .filter((b) => [hostBuildingId, armed?.guestBuildingId, armed?.mogId].includes(b.id))
        .map(signature),
    };
  }
  const fail = (error) => {
    failure = String(error?.stack || error);
    log({ stage: 'host-error', passed: false, error: failure });
  };
  // Observe commands and actual serialized snapshots without changing their data/timing.
  server.wss.on('connection', (socket) => {
    const send = socket.send;
    let epoch = 0;
    socket.send = function (raw, ...args) {
      try {
        const message = JSON.parse(String(raw));
        if (message.type === 'joined' && message.side === 1) {
          epoch = ++guestEpoch;
          if (epoch === 1)
            guestPrivate = {
              player: room.players[1],
              token: message.token,
              seat: message.seat,
              code: message.room.code,
            };
          if (epoch === 2) {
            reattach = summary();
            check(
              'original resume restores same player, token, room and seat',
              room.players[1] === guestPrivate.player &&
                message.token === guestPrivate.token &&
                message.seat === guestPrivate.seat &&
                message.room.code === guestPrivate.code,
              { tokenMatched: true, seat: message.seat, room: message.room.code },
            );
            check(
              'reattach preserves complete frozen authority',
              !!freeze &&
                reattach.hash === freeze.after.hash &&
                reattach.tick === freeze.after.tick,
              { before: freeze?.after, reattach },
            );
            check(
              'resume restores source command sequence',
              message.lastSequence === armed.sequence,
              { lastSequence: message.lastSequence, expected: armed.sequence },
            );
            log({
              stage: 'host-reattached',
              passed: true,
              epoch,
              seat: message.seat,
              tick: reattach.tick,
              time: reattach.time,
              tokenMatched: true,
              lastSequence: message.lastSequence,
            });
          }
        }
        if (epoch && message.type === 'snapshot') {
          const s = room.state;
          frames.set(epoch + ':' + message.tick + ':' + (message.sync?.seq || 0), {
            generation: epoch,
            tick: message.tick,
            syncSeq: message.sync?.seq || 0,
            time: s.time,
            resources: wallet(s.sides[1]),
            inventory: { ...s.sides[1].inventory },
            ammoStock: { ...s.sides[1].ammoStock },
          });
          if (frames.size > 512) frames.delete(frames.keys().next().value);
        }
      } catch (error) {
        fail(error);
      }
      return send.call(this, raw, ...args);
    };
    const pending = new Map();
    socket.prependListener('message', (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.type !== 'command' || !room) return;
      const side = socket.seat;
      pending.set(m.sequence, {
        sequence: m.sequence,
        side,
        command: m.command,
        args: m.args,
        time: room.state.time,
        before: wallet(room.state.sides[side]),
        quote:
          m.command === 'build' ? E.purchaseQuote(room.state, side, 'building', m.args.key) : null,
        driveCost:
          m.command === 'build'
            ? placementPlan(room.state, side, m.args.key, m.args.x, m.args.z).driveCost || 0
            : 0,
      });
    });
    socket.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      const entry = pending.get(m.sequence);
      if (!entry) return;
      pending.delete(m.sequence);
      entry.after = wallet(room.state.sides[entry.side]);
      entry.spent = Object.fromEntries(
        Object.keys(entry.before).map((k) => [k, entry.before[k] - entry.after[k]]),
      );
      ledger.push(entry);
    });
  });
  const initialWork = async () => {
    const hq = room.state.buildings.find((b) => b.side === 0 && b.key === 'hq');
    const power = await host.command('build', {
      key: 'power',
      x: hq.x - 55,
      z: hq.z - 80,
      rotation: 0,
    });
    check('original host pays for power building', !!power?.id);
    hostBuildingId = power.id;
    log({ stage: 'host-paid-building', passed: true, id: hostBuildingId });
  };
  let started = false;
  host = new NetworkSession({
    onError: (e) => {
      errors.push(String(e));
      fail(Error('Original host network error: ' + e));
    },
    onClosed: () => {
      closed = true;
    },
    onRoom: (meta) => {
      if (
        meta.phase === 'waiting' &&
        meta.players.length === 2 &&
        meta.players.every((p) => p?.connected && p.ready) &&
        !started
      ) {
        started = true;
        host.send({ type: 'start' });
      }
      if (meta.phase === 'playing' && !hostBuildingId && !report.initialWorkStarted) {
        report.initialWorkStarted = true;
        initialWork().catch(fail);
      }
      if (meta.phase === 'disconnected' && armed && !freezeTask) {
        freezeTask = (async () => {
          const before = summary(),
            sequence = host.sequence;
          const denied = await host.command('demolish', { id: hostBuildingId });
          check(
            'source host command is refused during disconnected phase',
            typeof denied === 'string' && host.sequence === sequence,
            { denied, sequence },
          );
          await delay(200);
          check('actual disconnected window remains observable', roomPhase() === 'disconnected');
          const after = summary();
          check(
            'authority time, RNG, wallets, stocks and paid entities freeze',
            before.hash === after.hash && before.tick === after.tick,
            { before, after },
          );
          freeze = { before, after, observedMilliseconds: 200 };
          report.freeze = freeze;
          log({
            stage: 'host-authority-frozen',
            passed: true,
            tick: after.tick,
            time: after.time,
            rng: after.rng,
            hash: after.hash,
          });
        })().catch(fail);
      }
      if (meta.phase === 'playing' && reattach && !recovered) {
        recovered = { tick: room.tick, time: room.state.time };
        log({ stage: 'host-playing-resumed', passed: true, ...recovered });
      }
    },
  });
  await new Promise((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + server.http.address().port;
  await host.connect(endpoint, { type: 'create', mode: 'pvp', name: 'Original reconnect host' });
  room = server.rooms.get(host.room.code);
  check(
    'host starts original idle-human PvP with no bots',
    room.mode === 'pvp' && E.aiSides(room.state).length === 0,
  );
  host.send({ type: 'ready', value: true });
  const status = () => ({
    failed: !!failure,
    error: failure,
    phase: roomPhase(),
    hostBuildingId,
    armed: !!armed,
    freeze: freeze ? { passed: true, before: freeze.before, after: freeze.after } : null,
    reattach: reattach ? { passed: true, tick: reattach.tick, time: reattach.time } : null,
    recovered,
    passed: report.passed,
    closed,
    completed,
  });
  const action = async (name, body = {}) => {
    if (failure) throw Error(failure);
    if (name === 'arm') {
      check(
        'drop armed once after both original paid cities are visible',
        !armed && roomPhase() === 'playing' && hostBuildingId,
      );
      const housing = room.state.buildings.find((b) => b.id === body.guestBuildingId),
        mog = room.state.buildings.find((b) => b.id === body.mogId);
      check(
        'actual guest paid housing and armed MOG exist',
        housing?.key === 'housing' &&
          housing.side === 1 &&
          mog?.key === 'gun' &&
          mog.side === 1 &&
          Object.values(ammunition(mog)).some((v) => typeof v === 'number' && v > 0),
        { housing: housing && signature(housing), mog: mog && signature(mog) },
      );
      for (const b of [housing, mog, room.state.buildings.find((b) => b.id === hostBuildingId)]) {
        const paid = ledger.find(
          (e) =>
            e.command === 'build' &&
            e.side === b.side &&
            e.args.key === b.key &&
            e.args.x === b.x &&
            e.args.z === b.z,
        );
        check(
          'building ' + b.id + ' used exact original purchase quote and driveway',
          !!paid &&
            paid.spent.credits === paid.quote.cost + paid.driveCost &&
            paid.spent.materials === (paid.quote.metal || 0) &&
            paid.spent.components === (paid.quote.components || 0),
          paid && { id: b.id, spent: paid.spent, quote: paid.quote, driveCost: paid.driveCost },
        );
      }
      armed = {
        guestBuildingId: housing.id,
        mogId: mog.id,
        sequence: room.players[1].lastSequence,
        seat: guestPrivate.seat,
        room: room.code,
      };
      report.armed = armed;
      return {
        armed: true,
        sequence: armed.sequence,
        hostBuildingId,
        guestBuildingId: housing.id,
        mogId: mog.id,
      };
    }
    if (name === 'snapshot') {
      const expected = frames.get(body.generation + ':' + body.tick + ':' + body.syncSeq);
      check(
        'native decoded wallet/stock match actual original serialized snapshot',
        !!expected &&
          expected.time === body.time &&
          JSON.stringify(expected.resources) === JSON.stringify(body.resources) &&
          JSON.stringify(expected.inventory) === JSON.stringify(body.inventory) &&
          JSON.stringify(expected.ammoStock) === JSON.stringify(body.ammoStock),
        { expected, actual: body },
      );
      return { matched: true, generation: body.generation, tick: body.tick, syncSeq: body.syncSeq };
    }
    if (name === 'verify') {
      check(
        'source automatic resume completed without manual restart',
        !!freeze && !!reattach && !!recovered && roomPhase() === 'playing' && guestEpoch === 2,
      );
      check(
        'original authority resumes forward progress',
        room.tick > freeze.after.tick && room.state.time > freeze.after.time,
        { frozen: freeze.after.tick, current: room.tick },
      );
      const power = room.state.buildings.find((b) => b.id === body.postBuildingId);
      check(
        'new native paid command succeeds after resume',
        power?.key === 'power' && power.side === 1 && room.players[1].lastSequence > armed.sequence,
      );
      const paid = ledger.find(
        (e) =>
          e.side === 1 &&
          e.command === 'build' &&
          e.args.key === 'power' &&
          e.args.x === power.x &&
          e.args.z === power.z,
      );
      check(
        'post-resume power cost uses original quote and driveway',
        !!paid &&
          paid.spent.credits === paid.quote.cost + paid.driveCost &&
          paid.spent.materials === (paid.quote.metal || 0),
        paid && { spent: paid.spent, quote: paid.quote, driveCost: paid.driveCost },
      );
      const denied = ledger.findLast(
        (e) => e.side === 1 && e.command === 'demolish' && e.args.id === hostBuildingId,
      );
      check(
        'post-resume ownership rejection leaves both wallets unchanged',
        !!denied &&
          JSON.stringify(denied.before) === JSON.stringify(denied.after) &&
          room.state.buildings.find((b) => b.id === hostBuildingId).hp > 0,
      );
      check(
        'all original paid pre-drop entities persist exactly once',
        [hostBuildingId, armed.guestBuildingId, armed.mogId].every(
          (id) =>
            room.state.buildings.filter((b) => b.id === id && !b.demolished && b.hp > 0).length ===
            1,
        ),
      );
      check(
        'nonzero original MOG ammunition survives resume',
        JSON.stringify(ammunition(room.state.buildings.find((b) => b.id === armed.mogId))) ===
          JSON.stringify(freeze.after.buildings.find((b) => b.id === armed.mogId).ammunition),
      );
      check('original host has no unexpected errors', errors.length === 0, errors);
      report.passed = true;
      report.recovered = recovered;
      report.reattach = reattach;
      report.final = summary();
      report.tokenMatched = true;
      report.guestEpochs = guestEpoch;
      return {
        passed: true,
        checks: checks.length,
        tick: room.tick,
        time: room.state.time,
        tokenMatched: true,
        sequence: room.players[1].lastSequence,
      };
    }
    if (name === 'finish') {
      check(
        'native original leave closes the same room',
        report.passed && closed && !server.rooms.has(room.code),
      );
      completed = true;
      return { passed: true, checks: checks.length };
    }
    throw Error('Unknown QA-only action');
  };
  control = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/status') {
        res.end(JSON.stringify(status()));
        return;
      }
      if (req.method !== 'POST') throw Error('Expected QA POST');
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 32768) throw Error('QA body too large');
      }
      const result = await action(url.pathname.slice(1), raw ? JSON.parse(raw) : {});
      res.end(JSON.stringify(result));
    } catch (error) {
      fail(error);
      res.writeHead(500);
      res.end(JSON.stringify({ failed: true, error: String(error.message) }));
    }
  });
  await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
  const config = {
    endpoint,
    code: room.code,
    mode: 'pvp',
    control: 'http://127.0.0.1:' + control.address().port,
  };
  log({ stage: 'host-ready', passed: true, ...config });
  return {
    config,
    report,
    status,
    action,
    server,
    host,
    room,
    async close() {
      host.disconnect();
      await server.close();
      await new Promise((resolve) => control.close(resolve));
    },
    get failure() {
      return failure;
    },
  };
}

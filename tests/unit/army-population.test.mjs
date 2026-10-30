import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { executeCommand, PROTOCOL_VERSION } from '../../src/network/commands.js';
import { updateArmyComposition } from '../../src/game/units/ground/composition.js';
import { updateGround } from '../../src/game/units/ground/update.js';
import { createRoomServer } from '../../server/rooms.mjs';
import { WebSocket } from 'ws';
import { once } from 'node:events';
function fixture(population = 500) {
  const s = E.createGame(811);
  s.mode = 'multiplayer';
  Object.assign(s.sides[0], { credits: 1e6, materials: 1e6, oil: 150 });
  const b = E.build(s, 0, 'barracks', -1272, -10);
  assert.equal(typeof b, 'object');
  b.progress = 1;
  b.hp = b.maxHp;
  b.rallyMode = 'wait';
  for (let i = 0; i < population; i++)
    s.groundUnits.push(
      E.makeGround(s, 0, 'infantry', -1442 + (i % 10) * 7, 300 + Math.floor(i / 10) * 7),
    );
  return { s, b };
}
test('paid infantry and vehicle production, deployment and MOG continue above 500 alive units', () => {
  const { s, b } = fixture();
  const before = s.sides[0].credits;
  assert.equal(E.recruit(s, 0, 'infantry', b.id), true);
  assert.equal(s.sides[0].credits, before - E.GROUND_UNITS.infantry.cost);
  b.armyQueue[0].progress = 1;
  updateGround(
    s,
    s.sides.map((_, side) => E.economy(s, side)),
    0,
    { event() {}, random: () => 0.5 },
  );
  assert.equal(s.groundUnits.length, 501, 'completed paid queue must actually spawn');
  assert.equal(b.armyQueue.length, 0);
  assert.equal(
    s.sides[0].credits,
    before - E.GROUND_UNITS.infantry.cost,
    'spawn charges no second fee',
  );
  assert.equal(E.deploymentPlan(s, 0, 'infantry', { x: -992, z: 250 }, 5, b.id).ok, true);
  const v = E.build(s, 0, 'vehiclebase', -1152, -80);
  assert.equal(typeof v, 'object');
  v.progress = 1;
  v.hp = v.maxHp;
  const credits = s.sides[0].credits;
  assert.equal(E.recruit(s, 0, 'leopard', v.id), true);
  assert.equal(s.sides[0].credits, credits - E.GROUND_UNITS.leopard.cost);
  v.armyQueue[0].progress = 1;
  updateGround(
    s,
    s.sides.map((_, side) => E.economy(s, side)),
    0,
    { event() {}, random: () => 0.5 },
  );
  assert.equal(s.groundUnits.filter((u) => u.key === 'leopard').length, 1);
  const gun = E.build(s, 0, 'gun', -1292, 120);
  assert.equal(typeof gun, 'object');
  gun.progress = 1;
  gun.hp = gun.maxHp;
  const id = E.redeployMOG(s, 0, gun.id);
  assert.equal(typeof id, 'number');
  assert.ok(s.groundUnits.some((u) => u.id === id));
});
test('independent finite goals above old cap continue paid replenishment and preserve resource reserve', () => {
  const { s, b } = fixture();
  assert.equal(executeCommand(s, 0, 'army-target', { key: 'infantry', count: 600 }), true);
  assert.equal(E.setArmyTarget(s, 0, 'leopard', 500), true);
  assert.equal(E.armyCompositionStatus(s, 0).totals.desired, 1100);
  assert.equal(E.armyCompositionStatus(s, 0).totals.limit, null);
  const funds = s.sides[0].credits;
  updateArmyComposition(s);
  assert.equal(b.armyQueue.length, 1);
  assert.equal(s.sides[0].credits, funds - E.GROUND_UNITS.infantry.cost);
  b.armyQueue = [];
  s.time += 4;
  s.sides[0].credits = 250 + E.GROUND_UNITS.infantry.cost - 1;
  updateArmyComposition(s);
  assert.equal(b.armyQueue.length, 0);
  assert.equal(E.setArmyTarget(s, 0, 'infantry', 0), true);
  assert.equal(
    E.armyCompositionStatus(s, 0).types.find((r) => r.key === 'infantry').status,
    'disabled',
  );
  assert.equal(typeof E.setArmyTarget(s, 0, 'infantry', E.ARMY_TARGET_MAX + 1), 'string');
});
test('a paid queue and goals survive saving an army larger than one command batch', () => {
  const { s, b } = fixture(E.GROUND_COMMAND_LIMIT + 201);
  assert.equal(E.setArmyTarget(s, 0, 'infantry', 2000), true);
  const credits = s.sides[0].credits;
  assert.equal(E.recruit(s, 0, 'infantry', b.id), true);
  b.armyQueue[0].progress = 0.4;
  const loaded = E.load(E.save(s));
  assert.equal(loaded.groundUnits.length, 1201);
  assert.deepEqual(
    loaded.groundUnits.map((u) => [u.id, u.x, u.z]),
    s.groundUnits.map((u) => [u.id, u.x, u.z]),
  );
  assert.equal(loaded.sides[0].credits, credits - E.GROUND_UNITS.infantry.cost);
  assert.equal(loaded.sides[0].armyComposition.targets.infantry, 2000);
  assert.deepEqual(loaded.buildings.find((site) => site.id === b.id).armyQueue, b.armyQueue);
});
function message(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', receive);
      reject(Error('WS probe timeout'));
    }, 5000);
    function receive(raw) {
      const data = JSON.parse(raw);
      if (predicate(data)) {
        clearTimeout(timer);
        socket.off('message', receive);
        resolve(data);
      }
    }
    socket.on('message', receive);
  });
}
test('real server accepts 1000 owned selected IDs but rejects excessive, duplicate and foreign selections atomically', async (t) => {
  const server = createRoomServer({ autoTick: false });
  await new Promise((r) => server.http.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `ws://127.0.0.1:${server.http.address().port}/match`;
  const a = new WebSocket(url),
    b = new WebSocket(url);
  await Promise.all([once(a, 'open'), once(b, 'open')]);
  const created = message(a, (m) => m.type === 'joined');
  a.send(JSON.stringify({ type: 'create', protocol: PROTOCOL_VERSION, mode: 'coop' }));
  const host = await created;
  const joined = message(b, (m) => m.type === 'joined');
  b.send(JSON.stringify({ type: 'join', protocol: PROTOCOL_VERSION, code: host.room.code }));
  await joined;
  const ready = message(a, (m) => m.type === 'room' && m.room.players.every((p) => p?.ready));
  a.send(JSON.stringify({ type: 'ready', value: true }));
  b.send(JSON.stringify({ type: 'ready', value: true }));
  await ready;
  const playing = message(a, (m) => m.type === 'snapshot' && m.room.phase === 'playing');
  a.send(JSON.stringify({ type: 'start' }));
  await playing;
  const s = server.rooms.get(host.room.code).state;
  for (let i = 0; i < 1001; i++) s.groundUnits.push(E.makeGround(s, 0, 'infantry', -1492, 300));
  const ids = s.groundUnits.map((u) => u.id),
    selected = ids.slice(0, 1000);
  let sequence = 0;
  async function command(selection) {
    const request = {
      type: 'command',
      sequence: ++sequence,
      command: 'stance',
      args: { ids: selection, command: 'fire' },
    };
    assert.ok(Buffer.byteLength(JSON.stringify(request)) < 16384);
    const ack = message(a, (m) => m.type === 'ack' && m.sequence === sequence);
    a.send(JSON.stringify(request));
    return ack;
  }
  assert.equal((await command(selected)).result, 1000);
  assert.ok(s.groundUnits.slice(0, 1000).every((u) => u.holdFire));
  assert.ok(!s.groundUnits[1000].holdFire);
  assert.equal(typeof (await command(ids)).error, 'string');
  assert.equal(typeof (await command([...selected.slice(0, 999), selected[0]])).error, 'string');
  const foreign = E.makeGround(s, 2, 'infantry', -1492, 400);
  s.groundUnits.push(foreign);
  assert.equal(typeof (await command([...selected.slice(0, 999), foreign.id])).error, 'string');
  assert.ok(
    s.groundUnits.slice(0, 1000).every((u) => u.holdFire),
    'rejected batches cannot toggle any owned unit',
  );
  a.terminate();
  b.terminate();
});

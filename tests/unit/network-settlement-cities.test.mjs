import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoomServer } from '../../server/rooms.mjs';
import { NetworkSession } from '../../src/network/client.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = performance.now() + 30000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, 'town snapshot did not arrive');
    await sleep(20);
  }
}

test('two real co-op clients receive ordinary acquired town buildings through delta snapshots', async () => {
  globalThis.WebSocket = WebSocket;
  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const server = createRoomServer(),
    views = [],
    sessions = [0, 1].map((index) => new NetworkSession({ onState: (s) => (views[index] = s) }));
  try {
    await new Promise((resolve) => server.http.listen(0, '127.0.0.1', resolve));
    const address = `ws://127.0.0.1:${server.http.address().port}`,
      [host, guest] = sessions;
    await host.connect(address, { type: 'create', mode: 'coop' });
    await guest.connect(address, { type: 'join', code: host.room.code });
    host.send({ type: 'ready', value: true });
    guest.send({ type: 'ready', value: true });
    await until(() => host.room.players.every((p) => p?.ready));
    host.send({ type: 'start' });
    await until(() => guest.room.phase === 'playing');
    for (const args of [
      { a: { x: -1297, z: -1060 }, b: { x: -1707, z: -1060 } },
      { a: { x: -1707, z: -1060 }, b: { x: -1707, z: -1337 } },
    ])
      assert.equal(typeof (await host.command('road', args)), 'object');
    const town = (s) => s?.settlements.find((d) => d.id === 'north-village-1');
    await until(() => views.every((s) => town(s)?.materialized));
    const ids = town(views[0]).componentIds;
    assert.equal(ids.length, 2);
    assert.deepEqual(town(views[1]).componentIds, ids);
    for (const [index, s] of views.entries()) {
      const buildings = s.buildings.filter((b) => ids.includes(b.id));
      assert.deepEqual(buildings.map((b) => b.key).sort(), ['housing', 'industry']);
      assert.ok(buildings.every((b) => b.settlementId === 'north-village-1'));
      assert.ok(buildings.every((b) => b.side === (index ? 2 : 0)));
      assert.ok(s.sides.slice(1).every((f) => f.credits === 0));
    }
    assert.match(await guest.command('demolish', { id: ids[0] }), /принадлеж/);
    assert.equal(await host.command('demolish', { id: ids[0] }), true);
    await until(() => views.every((s) => s.buildings.find((b) => b.id === ids[0])?.demolished));
    assert.deepEqual(town(views[1]).componentIds, ids, 'demolition does not respawn the starter');
    assert.equal(host.room.phase, 'playing');
    assert.equal(guest.room.phase, 'playing');
  } finally {
    for (const session of sessions) session.disconnect();
    await server.close();
  }
});

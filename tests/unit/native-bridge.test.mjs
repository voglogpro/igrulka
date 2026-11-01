import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  createBridgeSession,
  createOutputQueue,
  createWorldDescriptor,
} from '../../native/runtime/bridge.mjs';
import { createGame } from '../../src/game/state.js';
import { executeCommand } from '../../src/network/commands.js';
import { step } from '../../src/game/simulation.js';
import { save } from '../../src/game/persistence/saves.js';

test('native commands and fixed ticks preserve reference rules and original campaign JSON', () => {
  const bridge = createBridgeSession({ seed: 412 });
  const reference = createGame(412, { difficulty: 'normal', mode: 'solo' });
  const action = { key: 'barracks', x: -2040, z: -10 };
  const expected = executeCommand(reference, 0, 'build', action);
  const reply = bridge.handle({ id: 1, cmd: 'action', type: 'build', payload: action });
  assert.equal(reply.ok, true, reply.message);
  assert.deepEqual(reply.data, expected);
  for (let i = 0; i < 20; i++) {
    bridge.tick();
    step(reference, 0.05);
  }
  assert.equal(bridge.handle({ cmd: 'save' }).data, save(reference));
  const before = bridge.handle({ cmd: 'save' }).data;
  bridge.handle({ cmd: 'pause', paused: true });
  bridge.tick();
  assert.equal(bridge.handle({ cmd: 'save' }).data, before);
  const restored = createBridgeSession();
  assert.equal(restored.handle({ cmd: 'load', data: before }).ok, true);
  assert.equal(restored.snapshot().paused, true);
  assert.equal(restored.state.rng, bridge.state.rng);
  assert.equal(restored.state.time, bridge.state.time);
  assert.equal(restored.state.buildings.length, bridge.state.buildings.length);
});

test('gateway ownership and load failure are transactional; private authority is not exposed', () => {
  const bridge = createBridgeSession();
  const before = save(bridge.state);
  assert.equal(bridge.handle({ cmd: 'action', type: 'upgrade', payload: { id: 2 } }).ok, false);
  assert.equal(bridge.handle({ cmd: 'load', data: '{}' }).ok, false);
  assert.equal(bridge.handle({ cmd: 'new', seed: -1 }).ok, false);
  assert.equal(save(bridge.state), before);
  bridge.state.sides[1].credits = 123456789;
  const view = bridge.snapshot();
  assert.equal(view.rng, undefined);
  assert.equal(view.seed, undefined);
  assert.equal(view.ai, undefined);
  assert.equal(JSON.stringify(view).includes('123456789'), false);
  assert.equal(view.buildings[0].id, 1);
  assert.equal(view.sideHQ.length, 2);
});

test('world exports deterministic scenery and correct row-major terrain without changing battle RNG', () => {
  const bridge = createBridgeSession();
  const before = bridge.state.rng;
  const world = createWorldDescriptor();
  assert.equal(world.schema, 23);
  assert.equal(world.protocol, 18);
  assert.equal(world.heightGrid.values.length, world.heightGrid.columns * world.heightGrid.rows);
  assert.equal(world.heightGrid.water.length, world.heightGrid.values.length);
  assert.equal(world.waterLevel, -1);
  assert.ok(world.trees.length > 1000);
  assert.deepEqual(world.trees, createWorldDescriptor().trees);
  assert.equal(bridge.state.rng, before);
  assert.ok(world.catalogs.buildings.refinery);
  assert.ok(world.catalogs.groundUnits.infantry);
});

test('backpressured pipe retains one newest snapshot and bounded ordered replies', () => {
  class SlowPipe extends EventEmitter {
    lines = [];
    write(line) {
      this.lines.push(JSON.parse(line));
      return false;
    }
  }
  const output = new SlowPipe();
  let overflow = 0;
  const queue = createOutputQueue(output, () => overflow++);
  queue.send({ kind: 'state', seq: 1 });
  for (let seq = 2; seq < 100; seq++) queue.send({ kind: 'state', seq });
  assert.equal(queue.pendingStates, 1);
  for (let id = 1; id <= 32; id++) queue.send({ kind: 'reply', id });
  assert.equal(queue.send({ kind: 'reply', id: 33 }), false);
  assert.equal(overflow, 1);
  for (let i = 0; i < 33; i++) output.emit('drain');
  assert.equal(output.lines.at(-1).seq, 99);
  assert.deepEqual(
    output.lines.filter((x) => x.kind === 'reply').map((x) => x.id),
    Array.from({ length: 32 }, (_, i) => i + 1),
  );
});

test(
  'real child process speaks NDJSON only, replies with save JSON and exits on quit',
  { timeout: 60000 },
  async () => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../../native/runtime/bridge.mjs', import.meta.url))],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    const lines = createInterface({ input: child.stdout });
    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    const messages = [];
    const exited = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(Error(stderr))));
    });
    lines.on('line', (line) => {
      const message = JSON.parse(line);
      messages.push(message);
      if (message.kind === 'state' && !messages.some((m) => m.id === 10))
        child.stdin.write(JSON.stringify({ id: 10, cmd: 'save' }) + '\n');
      if (message.id === 10) child.stdin.write(JSON.stringify({ id: 11, cmd: 'quit' }) + '\n');
    });
    try {
      await exited;
      assert.equal(messages[0].kind, 'world');
      const saved = messages.find((m) => m.id === 10);
      assert.equal(saved.ok, true);
      assert.equal(JSON.parse(saved.data).version, 23);
      assert.equal(messages.find((m) => m.id === 11).ok, true);
      assert.equal(stderr, '');
    } finally {
      child.kill();
      lines.close();
    }
  },
);

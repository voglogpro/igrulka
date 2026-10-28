import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttackRecallAction } from '../../src/ui/controllers/attack-recall.js';
import * as E from '../../src/game/index.js';
import { executeCommand } from '../../src/network/commands.js';
import {
  playerView,
  compactPlayerView,
  snapshotPlayerView,
} from '../../src/network/perspective.js';

test('recall gateway rejects side injection and private membership stays owner-only in coop views', () => {
  const s = E.createGame(813, { mode: 'coop' });
  for (let side = 0; side < 4; side++) {
    const home = s.buildings.find((b) => b.key === 'hq' && b.side === side);
    const u = E.makeGround(s, side, 'machinegunner', home.x, home.z);
    u.defenseAttack = {
      phase: 'active',
      home: { x: u.x, z: u.z },
      wave: u.id,
      initial: 1,
      nextAt: 0,
    };
    u.airThreatAt = 12;
    u.supportFront = 'north';
    u.supportRouteAt = 13;
    s.groundUnits.push(u);
  }
  const before = JSON.stringify(s);
  assert.equal(executeCommand(s, 0, 'attack-recall', { side: 2 }), 'Некорректная команда');
  assert.equal(JSON.stringify(s), before);
  assert.equal(executeCommand(s, 2, 'attack-recall', {}), 1);
  assert.equal(s.groundUnits.find((u) => u.side === 2).defenseAttack.phase, 'returning');
  assert.equal(s.groundUnits.find((u) => u.side === 0).defenseAttack.phase, 'active');
  for (const viewOf of [playerView, compactPlayerView, snapshotPlayerView]) {
    for (const side of [0, 2]) {
      const view = viewOf(s, side);
      assert.ok(view.groundUnits.some((u) => u.side === 0 && u.defenseAttack));
      for (const u of view.groundUnits.filter((u) => u.side !== 0))
        for (const field of ['defenseAttack', 'airThreatAt', 'supportFront', 'supportRouteAt'])
          assert.equal(Object.hasOwn(u, field), false);
    }
  }
});

test('recall UI coalesces pending clicks, refreshes errors and ignores replies from a previous campaign', async () => {
  let epoch = 0,
    finish;
  const calls = [],
    button = { dataset: {}, disabled: false };
  const recall = createAttackRecallAction({
    getEpoch: () => epoch,
    execute: (type, args) => {
      calls.push([type, args]);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    persist: () => calls.push('persist'),
    refresh: () => calls.push('refresh'),
    toast: (...args) => calls.push(args),
  });
  const first = recall(button);
  await recall({ dataset: {} });
  assert.deepEqual(calls, [['attack-recall', {}]]);
  assert.equal(button.disabled, true);
  finish('Нет участников атаки');
  await first;
  assert.equal(button.dataset.pending, undefined);
  assert.deepEqual(calls.slice(1), [['Нет участников атаки', true], 'refresh']);
  const stale = recall(button);
  epoch++;
  finish(3);
  await stale;
  assert.equal(calls.includes('persist'), false);
  const success = recall(button);
  finish(3);
  await success;
  assert.ok(calls.includes('persist'));
  assert.equal(calls.at(-1), 'refresh');
});

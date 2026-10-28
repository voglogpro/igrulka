import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { executeCommand } from '../../src/network/commands.js';
import { playerView } from '../../src/network/perspective.js';

test('recovery commands address removed roads without exposing or spending another co-op city funds', () => {
  const s = E.createGame(8133, { mode: 'coop' });
  const roads = [0, 2].map((side) => s.roads.find((r) => r.side === side && r.camp));
  for (const r of roads) assert.equal(E.demolish(s, r.id, r.side), true);
  assert.equal(
    E.targetById(s, roads[1].id),
    null,
    'demolished roads are deliberately unselectable',
  );
  for (const id of [roads[1].id, -1, NaN, 1.5, '1']) {
    const before = E.save(s);
    assert.equal(typeof executeCommand(s, 0, 'road-recovery', { id }), 'string');
    assert.equal(E.save(s), before);
  }
  assert.equal(executeCommand(s, 2, 'road-recovery', { id: roads[1].id, side: 0 }), true);
  E.step(s, 0.1);
  assert.ok(s.sides[2].roadRecovery.paid > 0);
  assert.equal(s.sides[0].roadRecovery, null);
  const own = playerView(s, 2),
    other = playerView(s, 0);
  assert.equal(own.sides[0].roadRecovery.id, roads[1].id);
  assert.equal(other.sides[2].roadRecovery, undefined);
  assert.equal(executeCommand(s, 2, 'road-recovery-toggle', { enabled: false }), true);
  const paid = s.sides[2].roadRecovery.paid;
  E.step(s, 0.1);
  assert.equal(s.sides[2].roadRecovery.paid, paid);
  assert.equal(executeCommand(s, 0, 'road-recovery-cancel'), 'Нет подряда для отмены');
  assert.equal(s.sides[2].roadRecovery.paid, paid);
  assert.equal(executeCommand(s, 2, 'road-recovery-cancel'), true);
});

test('ordinary simulation completes an earmarked road payment across actual save and reload', () => {
  let s = E.createGame(8133, { mode: 'multiplayer' });
  const road = s.roads.find((r) => r.side === 0 && r.camp);
  E.demolish(s, road.id, 0);
  const id = road.id,
    before = s.sides[0].credits;
  assert.equal(executeCommand(s, 0, 'road-recovery', { id }), true);
  E.advance(s, 10);
  assert.ok(s.sides[0].roadRecovery.paid > 17.99);
  const saved = E.save(s);
  s = E.load(saved);
  assert.equal(s.version, 22);
  E.advance(s, 20);
  assert.equal(s.sides[0].roadRecovery, null);
  const restored = s.roads.find((r) => r.id === id);
  assert.equal(restored.removed, false);
  assert.equal(restored.hp, restored.maxHp);
  const cost = Math.ceil(Math.hypot(restored.bx - restored.ax, restored.bz - restored.az) * 0.8);
  assert.ok(Math.abs(s.sides[0].credits - (before + 30 * 1.8 - cost)) < 1e-7);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  updateGroundRoutes,
  GROUND_ROUTE_PATHS_PER_STEP,
} from '../../src/game/units/ground/route-queue.js';
import { executeCommand } from '../../src/network/commands.js';

test('a 500-unit click queues destinations without 500 synchronous searches and planner attempts only two paths at a time', () => {
  const s = E.createGame(8112),
    ids = [];
  for (let i = 0; i < 500; i++) {
    const u = E.makeGround(s, 0, 'infantry', -1500 + (i % 25) * 8, -500 + Math.floor(i / 25) * 8);
    s.groundUnits.push(u);
    ids.push(u.id);
  }
  assert.equal(
    executeCommand(s, 0, 'order', { ids, aim: { x: -1000, z: -400, mode: 'move' } }),
    500,
  );
  assert.ok(s.groundUnits.every((u) => u.path.length === 0 && u.routeState && u.order));
  updateGroundRoutes(s);
  assert.equal(s.groundUnits.filter((u) => u.path.length).length, GROUND_ROUTE_PATHS_PER_STEP);
  const before = E.save(s);
  const enemy = E.makeGround(s, 1, 'infantry', 1500, 300);
  s.groundUnits.push(enemy);
  const invalid = E.save(s);
  assert.equal(
    typeof executeCommand(s, 0, 'order', {
      ids: [...ids.slice(0, 499), enemy.id],
      aim: { x: -800, z: -300, mode: 'move' },
    }),
    'string',
  );
  assert.equal(E.save(s), invalid);
  assert.ok(before.length > 0);
});

test('old unrouteable jobs do not starve untouched later IDs and saved groups resolve ownership in one army scan', () => {
  const s = E.createGame(8112);
  for (let i = 0; i < 20; i++) {
    const u = E.makeGround(s, 0, 'infantry', -1400 + i * 4, -300);
    s.groundUnits.push(u);
  }
  const ids = s.groundUnits.map((u) => u.id);
  E.orderGround(s, 0, ids, { x: -1100, z: -200, mode: 'move' });
  for (const u of s.groundUnits.slice(0, 2)) u.order = { x: 0, z: 0, mode: 'move' };
  for (let tick = 0; tick < 12; tick++) {
    s.time += 0.05;
    updateGroundRoutes(s);
  }
  assert.ok(s.groundUnits.slice(2).every((u) => u.path.length));
  assert.ok(s.groundUnits.slice(0, 2).every((u) => u.routeState.status === 'blocked'));
  assert.equal(E.saveGroup(s, 0, 1, ids).length, 20);
  s.groundUnits[0].hp = 0;
  const spy = [...ids];
  spy.includes = () => assert.fail('quadratic selection lookup');
  assert.equal(E.commandUnits(s, 0, spy, 'fire'), 19);
  assert.equal(E.getGroup(s, 0, 1).length, 19);
});

test('a large ally order does not monopolize the shared route budget', () => {
  const s = E.createGame(8112, { mode: 'coop' });
  for (const side of [0, 2]) {
    const ids = [];
    for (let i = 0; i < 40; i++) {
      const u = E.makeGround(s, side, 'infantry', -1400 + i * 5, side === 0 ? -1400 : 1400);
      s.groundUnits.push(u);
      ids.push(u.id);
    }
    assert.equal(
      E.orderGround(s, side, ids, { x: -1100, z: side === 0 ? -1300 : 1300, mode: 'move' }),
      40,
    );
  }
  updateGroundRoutes(s);
  for (const side of [0, 2])
    assert.equal(s.groundUnits.filter((u) => u.side === side && u.path.length).length, 1);
});

test('pending attack orders never rescan the whole army for every soldier without a target', () => {
  const s = E.createGame(8112),
    ids = [];
  for (let i = 0; i < 500; i++) {
    const u = E.makeGround(s, 0, 'infantry', -1500 + (i % 25) * 8, -500 + Math.floor(i / 25) * 8);
    s.groundUnits.push(u);
    ids.push(u.id);
  }
  E.orderGround(s, 0, ids, { x: -1000, z: -400, mode: 'attackmove' });
  s.groundUnits.find = () => assert.fail('per-soldier linear target search');
  updateGroundRoutes(s);
  assert.equal(s.groundUnits.filter((u) => u.path.length).length, GROUND_ROUTE_PATHS_PER_STEP);
});

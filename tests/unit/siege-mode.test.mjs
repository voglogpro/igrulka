import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { corridorGeometry } from '../../src/game/defense/geometry.js';
import { frontDirection, frontIds } from '../../src/game/factions.js';

const siege = (difficulty = 'normal') => E.createGame(2302, { mode: 'siege', difficulty });

test('one player in the middle of the western bank faces two allied bots on the eastern bank', () => {
  const s = siege();
  assert.equal(s.sides.length, 3);
  assert.deepEqual(s.sides[1], s.sides[0], 'equal starting resources');
  const hqs = [0, 1, 2].map((side) => E.hqOf(s, side));
  assert.deepEqual(
    hqs.map((b) => [b.x, b.z]),
    [
      [-E.HQ_X, 0],
      [E.HQ_X, -1015],
      [E.HQ_X, 1015],
    ],
  );
  for (const hq of hqs) {
    assert.equal(E.isWater(hq.x, hq.z), false);
    assert.equal(E.groundHeight(hq.x, hq.z), 0);
  }
  assert.deepEqual(
    [0, 1, 2].map((side) => E.teamOf(s, side)),
    [0, 1, 1],
  );
  assert.equal(E.hostile(s, 0, 2), true);
  assert.equal(E.allied(s, 1, 2), true);
  assert.deepEqual(E.aiSides(s), [1, 2]);
  assert.deepEqual(
    [0, 1, 2].map((side) => frontDirection(s, side)),
    [1, -1, -1],
  );
  assert.deepEqual(frontIds(s, 0), ['north', 'south']);
  assert.deepEqual(frontIds(s, 1), ['north']);
  assert.deepEqual(frontIds(s, 2), ['south']);
  assert.deepEqual(
    corridorGeometry(s, 0).map((line) => line.id),
    ['north', 'south'],
  );
  assert.equal(E.pairedEnemy(s, 2), 0);
  assert.equal(E.pairedEnemy(s, 0), 1);
  E.hqOf(s, 1).hp = 0;
  assert.equal(E.pairedEnemy(s, 0), 2, 'the player turns to the surviving bot');
});

test('two bot cities keep independent plans through save/load and corrupt layouts are rejected', () => {
  const s = siege();
  E.advance(s, 240);
  assert.ok(s.buildings.filter((b) => b.side === 1).length > 1);
  assert.ok(s.buildings.filter((b) => b.side === 2).length > 1);
  assert.ok(s.aiBySide[2] && !s.aiBySide[3]);
  const loaded = E.load(E.save(s));
  assert.equal(loaded.mode, 'siege');
  assert.deepEqual(loaded.aiBySide, s.aiBySide);
  E.advance(loaded, 5);
  for (const corrupt of [
    (v) => (v.mode = undefined),
    (v) => (v.aiBySide = { 3: v.aiBySide[2] }),
    (v) => delete v.aiBySide,
    (v) => (v.version = 22),
  ]) {
    const raw = JSON.parse(E.save(s));
    corrupt(raw);
    assert.throws(() => E.load(JSON.stringify(raw)));
  }
});

test('victory needs both bot headquarters; losing the single player headquarters is defeat', () => {
  const win = siege();
  E.hqOf(win, 1).hp = 0;
  E.step(win, 0.05);
  assert.equal(win.result, null);
  E.hqOf(win, 2).hp = 0;
  E.step(win, 0.05);
  assert.equal(win.result, 'victory');
  const loss = siege();
  E.hqOf(loss, 0).hp = 0;
  E.step(loss, 0.05);
  assert.equal(loss.result, 'defeat');
});

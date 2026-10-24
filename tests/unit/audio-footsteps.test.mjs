import test from 'node:test';
import assert from 'node:assert/strict';
import { FootstepScheduler, recordedGroundSample } from '../../src/audio/footsteps.js';

const listener = { x: 0, y: 10, z: 0 };
const walker = (id, extra = {}) => ({
  id,
  key: 'infantry',
  hp: 20,
  moving: true,
  x: 20,
  z: 0,
  ...extra,
});
test('walking audio excludes passengers, casualties, vehicles, stationary and distant troops', () => {
  const s = new FootstepScheduler();
  for (const extra of [
    { carrierId: 3 },
    { downed: true },
    { hp: 0 },
    { moving: false },
    { key: 'apc' },
    { x: 400 },
  ])
    assert.equal(s.take([walker(1, extra)], listener, 0), null);
  assert.equal(s.take([walker(1)], listener, 1).id, 1);
  assert.equal(s.take([walker(1)], listener, 1.2), null);
  assert.equal(s.take([walker(1)], listener, 1.5).id, 1);
  assert.equal(s.take([walker(1)], listener, 2, true), null);
});
test('a large army keeps at most four cadence records and eight starts per second', () => {
  const s = new FootstepScheduler(),
    army = Array.from({ length: 1000 }, (_, i) => walker(i + 1, { x: 20 + i }));
  let starts = 0;
  for (let tick = 0; tick < 100; tick++) if (s.take(army, listener, tick / 100)) starts++;
  assert.ok(starts <= 8 && starts >= 4);
  assert.ok(s.next.size <= 4);
  s.take([], listener, 2);
  assert.equal(s.next.size, 0);
  assert.ok(s.take(army, listener, 0));
});
test('small bundled recordings resample to finite bounded mono PCM', () => {
  for (const kind of ['footstep', 'truck'])
    for (let variant = 0; variant < 3; variant++) {
      const data = recordedGroundSample(44100, kind, variant);
      assert.ok(data.length < 44100 * 2);
      assert.ok(data.every(Number.isFinite));
      assert.ok(Math.max(...data.slice(0, 16000).map(Math.abs)) <= 0.66);
      assert.ok(data.some((v) => Math.abs(v) > 0.1));
    }
});

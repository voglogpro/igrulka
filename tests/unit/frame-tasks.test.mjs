import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameTasks } from '../../src/ui/session/frame-tasks.js';

test('a frame executes one periodic UI refresh using its latest callback without moving older pending panels behind it', () => {
  const queue = createFrameTasks(),
    seen = [];
  queue.request({ hud: () => seen.push('old HUD'), panel: () => seen.push('old panel') });
  queue.request({ hud: () => seen.push('new HUD'), minimap: () => seen.push('map') });
  assert.equal(queue.pending, 3);
  assert.equal(queue.runNext(), true);
  assert.deepEqual(seen, ['new HUD']);
  queue.request({ hud: () => seen.push('next HUD'), panel: () => seen.push('new panel') });
  queue.runNext();
  assert.deepEqual(seen, ['new HUD', 'new panel']);
  queue.runNext();
  assert.deepEqual(seen, ['new HUD', 'new panel', 'map']);
  queue.runNext();
  assert.deepEqual(seen, ['new HUD', 'new panel', 'map', 'next HUD']);
  assert.equal(queue.runNext(), false);
});

test('closing a panel removes its pending refresh and null tasks never consume a frame', () => {
  const queue = createFrameTasks(),
    seen = [];
  queue.request({ panel: () => assert.fail('closed panel'), map: () => seen.push('map') });
  queue.request({ panel: null, strike: undefined });
  assert.equal(queue.pending, 1);
  queue.runNext();
  assert.deepEqual(seen, ['map']);
  assert.equal(queue.pending, 0);
});

test('350 ms polling coalesces at 30 FPS without starving twelve panels even when polling is faster than the complete refresh batch', () => {
  const queue = createFrameTasks(),
    calls = Array(12).fill(0),
    lastFrame = Array(12).fill(-1);
  let latestCycle = -1,
    nextPoll = 0,
    longestWait = 0;
  for (let frame = 0; frame < 360; frame++) {
    const now = (frame * 1000) / 30;
    if (now >= nextPoll) {
      latestCycle++;
      const cycle = latestCycle;
      queue.request(
        Object.fromEntries(
          calls.map((_, id) => [
            `panel-${id}`,
            () => {
              assert.equal(cycle, latestCycle, 'a stale poll callback must be replaced');
              if (lastFrame[id] >= 0) longestWait = Math.max(longestWait, frame - lastFrame[id]);
              lastFrame[id] = frame;
              calls[id]++;
            },
          ]),
        ),
      );
      nextPoll += 350;
    }
    assert.ok(queue.pending <= 12, 'waiting frames cannot create a repeated work backlog');
    const before = calls.reduce((sum, count) => sum + count, 0);
    queue.runNext();
    assert.ok(calls.reduce((sum, count) => sum + count, 0) - before <= 1);
  }
  // A completed panel can wait until the next poll (at most eleven frames),
  // then at most twelve FIFO jobs. Refresh rates need not be identical.
  assert.ok(
    calls.every((count) => count >= 15),
    JSON.stringify(calls),
  );
  assert.ok(longestWait <= 23, `${longestWait} frames between panel refreshes`);
});

test('campaign reset cancels all queued work while new callbacks read only the replacement state', () => {
  const queue = createFrameTasks();
  let state = { campaign: 'old', rendered: 0 };
  queue.request({ panel: () => assert.fail('outgoing campaign callback') });
  queue.clear();
  assert.equal(queue.pending, 0);
  assert.equal(queue.runNext(), false);
  queue.request({ panel: () => state.rendered++ });
  const oldState = state;
  state = { campaign: 'new', rendered: 0 };
  queue.runNext();
  assert.equal(oldState.rendered, 0);
  assert.equal(state.rendered, 1);
});

test('a failed refresh cannot discard the other pending panels or execute them in the same frame', () => {
  const queue = createFrameTasks(),
    calls = [];
  queue.request({
    broken: () => {
      throw Error('broken UI');
    },
    map: () => calls.push('map'),
  });
  assert.throws(() => queue.runNext(), /broken UI/);
  assert.deepEqual(calls, []);
  assert.equal(queue.pending, 1);
  queue.runNext();
  assert.deepEqual(calls, ['map']);
});

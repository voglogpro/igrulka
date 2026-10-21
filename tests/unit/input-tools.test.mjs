import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../src/game/index.js';
import { cancelRoad, pointerUp } from '../../src/rendering/input/build-tools.js';

function roadRequest() {
  let finish;
  const response = new Promise((resolve) => (finish = resolve));
  const issued = [];
  const ghostUpdates = [];
  const start = { x: -680, z: -200 };
  const event = { button: 0, clientX: 0, clientY: 0, shiftKey: false };
  const world = {
    state: createGame(39),
    buildKey: 'road',
    roadAnchor: start,
    selectionBox: { hidden: false },
    keys: { MouseLeft: true },
    controls: { rotating: false },
    down: { x: 0, y: 0 },
    pointerPoint: { x: -560, z: -200 },
    groundPoint() {
      return this.pointerPoint;
    },
    callbacks: {
      onRoad(a, b) {
        issued.push({ a, b });
        return response;
      },
    },
    updateGhost(pointer) {
      ghostUpdates.push(pointer);
    },
  };
  const pending = pointerUp.call(world, event);
  assert.equal(issued.length, 1, 'the real pointer handler must have requested one road');
  assert.equal(issued[0].a, start);
  assert.equal(world.roadAnchor, start, 'an unacknowledged road must not advance its anchor');
  return { world, event, start, end: issued[0].b, issued, ghostUpdates, finish, pending };
}

test('a successful deferred road response advances the same active road from A to B', async () => {
  const request = roadRequest();
  request.finish(true);
  await request.pending;
  assert.equal(request.world.roadAnchor, request.end);
  assert.equal(request.world.selectionBox.hidden, true);
  assert.equal(request.world.keys.MouseLeft, false);
  assert.deepEqual(request.ghostUpdates, [request.event]);
});

test('a refused deferred road response keeps A available for a corrected road', async () => {
  const request = roadRequest();
  request.finish(false);
  await request.pending;
  assert.equal(request.world.roadAnchor, request.start);
  assert.deepEqual(request.ghostUpdates, [request.event]);
});

test('an old road response cannot overwrite a new start C after cancellation', async () => {
  const request = roadRequest();
  const { world } = request;
  assert.equal(cancelRoad.call(world), true);
  assert.equal(world.roadAnchor, null);
  world.pointerPoint = { x: -500, z: 200 };
  world.down = { x: 0, y: 0 };
  await pointerUp.call(world, request.event);
  const newStart = world.roadAnchor;
  assert.deepEqual(newStart, { x: -500, z: 200 });
  assert.equal(request.issued.length, 1, 'choosing a new start must not order another segment');
  const beforeAck = request.ghostUpdates.length;
  request.finish(true);
  await request.pending;
  assert.equal(world.roadAnchor, newStart);
  assert.equal(
    request.ghostUpdates.length,
    beforeAck,
    'an obsolete response must not refresh tools',
  );
});

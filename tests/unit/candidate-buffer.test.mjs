import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateBuffer } from '../../src/game/units/ground/candidate-buffer.js';

function entries(count) {
  return Array.from({ length: count }, (_, i) => ({
    unit: { id: i % 11, index: i },
    score: Math.hypot((i * 131) % 29, (i * 73) % 31),
  }));
}
const reference = (items, descending = false) =>
  items
    .slice()
    .sort((a, b) => (descending ? b.score - a.score : a.score - b.score) || a.unit.id - b.unit.id)
    .map((v) => v.unit);

test('index sorting retains exact numeric scores, ID ties and original order for equal keys', () => {
  for (const descending of [false, true]) {
    const buffer = new CandidateBuffer(descending),
      items = entries(500);
    for (const { unit, score } of items) buffer.add(unit, score);
    const order = buffer.sortedOrder();
    assert.deepEqual(
      order.map((index) => buffer.units[index]),
      reference(items, descending),
    );
  }
});

test('nearest-first popping preserves the full stable sort order across growing, shrinking and empty searches', () => {
  const buffer = new CandidateBuffer();
  for (const count of [0, 1, 17, 500, 3, 0, 127]) {
    buffer.reset();
    const items = entries(count);
    for (const { unit, score } of items) buffer.add(unit, score);
    buffer.heapify();
    const actual = [];
    while (buffer.order.length) actual.push(buffer.pop());
    assert.deepEqual(actual, reference(items));
    assert.equal(buffer.pop(), null);
    assert.equal(
      buffer.units.length,
      count,
      'inactive unit references are not retained beyond the current search',
    );
    assert.equal(buffer.scores.length, count);
  }
});

test('finding the nearest candidate takes linear preparation rather than sorting every distant candidate', () => {
  const count = 500,
    buffer = new CandidateBuffer(),
    items = Array.from({ length: count }, (_, i) => ({
      unit: { id: i },
      score: (i * 397) % 503,
    }));
  for (const { unit, score } of items) buffer.add(unit, score);
  const compare = buffer.compare;
  let heapComparisons = 0,
    sortComparisons = 0;
  buffer.compare = (a, b) => {
    heapComparisons++;
    return compare(a, b);
  };
  buffer.heapify();
  const first = buffer.pop();
  const sorted = items.slice().sort((a, b) => {
    sortComparisons++;
    return a.score - b.score || a.unit.id - b.unit.id;
  });
  assert.equal(first, sorted[0].unit);
  assert.ok(heapComparisons <= count * 3, `${heapComparisons} comparisons for ${count} candidates`);
  assert.ok(
    heapComparisons < sortComparisons / 2,
    `${heapComparisons} heap comparisons versus ${sortComparisons} full-sort comparisons`,
  );
});

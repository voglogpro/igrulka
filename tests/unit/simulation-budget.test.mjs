import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSimulationFrame } from '../../src/ui/session/simulation-budget.js';
import * as E from '../../src/game/index.js';

test('slow catch-up steps yield while retaining the unprocessed fixed-step time', () => {
  let time = 0;
  const s = { time: 0 },
    tick = (state, dt) => {
      state.time += dt;
      time += 30;
    };
  let budget = advanceSimulationFrame(s, 0, 0.2, tick, () => time);
  assert.equal(budget.steps, 1);
  assert.ok(Math.abs(budget.remainder - 0.15) < 1e-9);
  for (let i = 0; i < 3; i++)
    budget = advanceSimulationFrame(s, budget.remainder, 1e-9, tick, () => time);
  assert.ok(Math.abs(s.time - 0.2) < 1e-9);
  assert.ok(budget.remainder < 1e-8);
});
test('normal fixed-step simulation remains deterministic across different frame grouping', () => {
  const actual = E.createGame(811),
    expected = E.createGame(811);
  let acc = 0;
  for (let i = 0; i < 60; i++) {
    const budget = advanceSimulationFrame(actual, acc, 1 / 60, E.step, () => 0);
    acc = budget.remainder;
  }
  for (let i = 0; i < Math.round(actual.time / 0.05); i++) E.step(expected, 0.05);
  assert.equal(E.save(actual), E.save(expected));
  assert.ok(actual.time >= 0.95 && actual.time <= 1.01);
});
test('large suspended intervals keep the existing backlog bound and never run five ticks in one task', () => {
  const s = { steps: 0 },
    result = advanceSimulationFrame(
      s,
      0,
      10,
      () => s.steps++,
      () => 0,
    );
  assert.equal(result.steps, 2);
  assert.equal(s.steps, 2);
  assert.ok(Math.abs(result.remainder - 0.15) < 1e-9);
});
test('saving a large army preserves the exact JSON contract without cloning or mutating live events', () => {
  const s = E.createGame(811),
    events = s.events;
  for (let i = 0; i < 500; i++)
    s.groundUnits.push(E.makeGround(s, i % 2, 'infantry', -1200 + (i % 20) * 15, -1000));
  const copy = structuredClone(s);
  copy.events = [];
  assert.equal(E.save(s), JSON.stringify(copy));
  assert.equal(s.events, events);
  assert.equal(s.groundUnits.length, 500);
});

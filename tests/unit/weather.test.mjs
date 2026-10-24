import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateWeather, createWeather } from '../../src/game/weather.js';

test('weather arrives, peaks, ends and is announced in advance', () => {
  const s = E.createGame(100);
  s.mode = 'multiplayer';
  const kinds = new Set(),
    peaks = [];
  let announced = 0,
    previous = 'clear';
  for (let t = 0; t < 9000; t += 0.5) {
    s.time += 0.5;
    updateWeather(s, 0.5);
    kinds.add(s.weather.kind);
    peaks.push(s.weather.amount);
    if (s.weather.goal === 0 && s.weather.amount === 0 && s.weather.next !== previous) announced++;
    previous = s.weather.next;
    assert.ok(s.weather.amount >= 0 && s.weather.amount <= 1);
    assert.ok(s.weather.visibility > 0.2 && s.weather.visibility <= 1);
  }
  assert.ok(kinds.size >= 3, [...kinds].join());
  assert.ok(Math.max(...peaks) === 1);
  assert.ok(announced >= 1);
});

test('weather is deterministic for a seed, saved and restored', () => {
  const a = E.createGame(7),
    b = E.createGame(7);
  for (const s of [a, b]) for (let i = 0; i < 4000; i++) E.step(s, 0.05);
  assert.deepEqual(a.weather, b.weather);
  const restored = E.load(E.save(a));
  assert.deepEqual(restored.weather, a.weather);
  const old = JSON.parse(E.save(a));
  delete old.weather;
  assert.equal(E.load(JSON.stringify(old)).weather.kind, 'clear');
  const broken = JSON.parse(E.save(a));
  broken.weather.kind = 'acid';
  assert.throws(() => E.load(JSON.stringify(broken)));
});

test('fog and rain shrink sight and spoil aim, but never a unit’s own weapon reach', () => {
  const s = E.createGame(3);
  s.mode = 'multiplayer';
  const spotter = E.makeGround(s, 0, 'infantry', -100, 0),
    near = E.makeGround(s, 1, 'leopard', 120, 0),
    leopard = E.makeGround(s, 0, 'leopard', -300, 200),
    farTank = E.makeGround(s, 1, 'infantry', -140, 200);
  s.groundUnits.push(spotter, near, leopard, farTank);
  s.weather = { ...createWeather(3), kind: 'fog', goal: 1, amount: 1, until: 1e9 };
  updateWeather(s, 0.05);
  s.time += 1;
  // Infantry sight (185) times fog (0.5) no longer reaches 220 away.
  assert.equal(E.groundVisible(s, 0, near), false);
  // The leopard still sees what it can shoot at.
  assert.equal(E.groundVisible(s, 0, farTank), true);
  assert.ok(E.weatherSpread(s) > 1);
  s.weather = createWeather(3);
  s.time += 1;
  assert.equal(E.weatherSpread(s), 1);
});

import { event } from './shared/events.js';
import { random } from './shared/random.js';
import { dayPhase } from './clock.js';

// Weather is part of the simulation so both players, the bot and saved games agree on it.
// A phase of one kind ramps in, holds, ramps out, and a clear spell follows before the next one.
export const WEATHER = {
  clear: { name: 'Ясно', visibility: 1, spread: 1, speed: 1 },
  rain: { name: 'Дождь', visibility: 0.86, spread: 1.3, speed: 0.93 },
  fog: { name: 'Туман', visibility: 0.74, spread: 1.15, speed: 1 },
  storm: { name: 'Гроза', visibility: 0.76, spread: 1.5, speed: 0.88 },
};
const WEIGHTS = [
  ['rain', 0.42],
  ['fog', 0.3],
  ['storm', 0.18],
  ['clear', 0.1],
];
const RAMP = 1 / 40;

export function createWeather(seed = 1) {
  return {
    kind: 'clear',
    amount: 0,
    goal: 0,
    until: 130 + (seed % 70),
    next: 'rain',
    visibility: 1,
    spread: 1,
    speed: 1,
    strikeAt: 0,
  };
}

export function validWeather(w) {
  return (
    !!w &&
    typeof w === 'object' &&
    Object.hasOwn(WEATHER, w.kind) &&
    Object.hasOwn(WEATHER, w.next) &&
    [w.amount, w.goal, w.until, w.visibility, w.spread, w.speed, w.strikeAt].every(
      Number.isFinite,
    ) &&
    w.amount >= 0 &&
    w.amount <= 1 &&
    (w.goal === 0 || w.goal === 1)
  );
}

function pickNext(s) {
  let roll = random(s);
  for (const [kind, weight] of WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return 'rain';
}

export function updateWeather(s, dt) {
  const w = (s.weather ||= createWeather(s.seed));
  if (s.time >= w.until) {
    if (w.goal === 1) {
      // The active phase ends; a clear spell follows and the next phase is announced.
      w.goal = 0;
      w.until = s.time + 100 + random(s) * 160;
      w.next = pickNext(s);
    } else if (w.next === 'clear') {
      w.until = s.time + 90 + random(s) * 120;
      w.next = pickNext(s);
    } else {
      w.kind = w.next;
      w.goal = 1;
      w.until = s.time + 110 + random(s) * 150;
      w.strikeAt = s.time + 8 + random(s) * 10;
    }
  }
  w.amount += Math.max(-RAMP * dt, Math.min(RAMP * dt, w.goal - w.amount));
  if (w.amount <= 0 && w.goal === 0) w.kind = 'clear';
  const base = WEATHER[w.kind],
    night = dayPhase(s.time).night;
  // Darkness limits sight a little on top of the weather itself.
  w.visibility = (1 - (1 - base.visibility) * w.amount) * (1 - 0.26 * night);
  w.spread = 1 + (base.spread - 1) * w.amount;
  w.speed = 1 - (1 - base.speed) * w.amount;
  if (w.kind === 'storm' && w.amount > 0.45 && s.time >= w.strikeAt) {
    w.strikeAt = s.time + 5 + random(s) * 14;
    event(s, 'lightning', {
      x: (random(s) - 0.5) * 1500,
      y: 0,
      z: (random(s) - 0.5) * 1000,
      key: 'lightning',
      side: -1,
    });
  }
}

export const weatherSpread = (s) => s.weather?.spread ?? 1;
export const weatherSpeed = (s) => s.weather?.speed ?? 1;
export const forecast = (s) => {
  const w = s.weather;
  if (!w) return null;
  return w.goal === 1
    ? { now: w.kind, amount: w.amount, endsIn: Math.max(0, w.until - s.time), next: null }
    : { now: w.kind, amount: w.amount, endsIn: Math.max(0, w.until - s.time), next: w.next };
};

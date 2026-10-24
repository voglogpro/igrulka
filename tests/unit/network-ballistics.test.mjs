import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkSession } from '../../src/network/client.js';
import { projectileTrailPoint } from '../../src/rendering/effects/projectile-trail.js';

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('interpolated ballistic heads and history remain on the physical trajectory at every display age', () => {
  for (const arc of [0, 150]) {
    const originY = 6,
      gravity = arc ? 0 : 18,
      flight = 3;
    const initialVy = arc
      ? (4 * arc + 2 - originY) / flight
      : (2 - originY + 0.5 * gravity * flight * flight) / flight;
    const height = (age) =>
      arc
        ? originY * (1 - age / flight) +
          (2 * age) / flight +
          4 * arc * (age / flight) * (1 - age / flight)
        : originY + initialVy * age - 0.5 * gravity * age * age;
    const velocity = (age) =>
      arc ? (4 * arc * (1 - (2 * age) / flight) + 2 - originY) / flight : initialVy - gravity * age;
    const at = (life) => ({
      id: 1,
      domain: 'ground',
      life,
      originY,
      gravity,
      arc,
      flight,
      x: 100 * life,
      y: height(life),
      z: 20 * life,
      vx: 100,
      vy: velocity(life),
      vz: 20,
    });
    for (const startAge of [0.1, 1.4, 2.8]) {
      const session = new NetworkSession({});
      session.room = { phase: 'playing' };
      session.previous = { state: { time: 10, projectiles: [at(startAge)] } };
      session.latest = { received: 100, state: { time: 10.1, projectiles: [at(startAge + 0.1)] } };
      const originals = structuredClone([session.previous, session.latest]);
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const display = structuredClone(session.latest.state);
        session.renderInto(display, 100 + 100 * fraction);
        const p = display.projectiles[0],
          age = startAge + 0.1 * fraction;
        close(p.life, age);
        close(p.y, height(age));
        close(p.vy, velocity(age));
        close(p.x, 100 * age);
        const head = projectileTrailPoint(p, 0, {});
        close(head.y, p.y);
        close(head.x, p.x);
        const tail = projectileTrailPoint(p, 0.07, {});
        close(tail.y, height(age - 0.07));
        close(tail.x, 100 * (age - 0.07));
      }
      assert.deepEqual(
        [session.previous, session.latest],
        originals,
        'rendering never mutates authoritative samples',
      );
    }
  }
});

test('legacy and non-ballistic projectiles retain position interpolation without inventing launch state', () => {
  const session = new NetworkSession({});
  session.room = { phase: 'playing' };
  session.previous = {
    state: { time: 10, projectiles: [{ id: 1, x: 0, y: 10, z: 0, life: 1, vy: 2 }] },
  };
  session.latest = {
    received: 100,
    state: { time: 10.1, projectiles: [{ id: 1, x: 10, y: 14, z: 0, life: 1.1, vy: 4 }] },
  };
  const display = structuredClone(session.latest.state);
  session.renderInto(display, 150);
  close(display.projectiles[0].y, 12);
  close(display.projectiles[0].life, 1.05);
  close(display.projectiles[0].vy, 3);
  assert.equal(display.projectiles[0].originY, undefined);
});

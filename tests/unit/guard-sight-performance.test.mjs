import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateGuard } from '../../src/game/units/ground/guard.js';
import { hostile } from '../../src/game/factions.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function referenceThreat(s, u) {
  const posts = s.groundUnits.filter(
    (v) => v.side === u.side && v.hp > 0 && v.guard && distance(v.guard, u.guard) <= 68,
  );
  return s.groundUnits
    .filter(
      (v) =>
        hostile(s, v.side, u.side) &&
        v.hp > 0 &&
        !v.carrierId &&
        distance(v, u.guard) <= 145 &&
        E.groundVisible(s, u.side, v) &&
        (distance(v, u.guard) <= 95 ||
          posts.some((p) => p.id !== u.id && distance(v, p.guard) <= 55)) &&
        E.lineOfSight(s, u, v),
    )
    .sort((a, b) => distance(a, u.guard) - distance(b, u.guard) || a.id - b.id)[0];
}

test('guard threat choice keeps the nearest visible target, assistance range and ID ties', () => {
  const s = E.createGame(8111, { mode: 'coop' });
  const guard = E.makeGround(s, 0, 'infantry', -1200, -320);
  guard.guard = { x: guard.x, z: guard.z };
  const assist = E.makeGround(s, 0, 'infantry', -1140, -320);
  assist.guard = { x: assist.x, z: assist.z };
  s.groundUnits.push(guard, assist);
  for (let i = 0; i < 120; i++) {
    const angle = i * 2.399963229728653;
    const range = 45 + (i % 8) * 15;
    s.groundUnits.push(
      E.makeGround(
        s,
        i % 6 === 0 ? 2 : 1,
        i % 3 === 0 ? 'infantry' : 'apc',
        guard.x + Math.cos(angle) * range,
        guard.z + Math.sin(angle) * range,
      ),
    );
  }
  // Re-evaluate after deaths, movement, allies and transport occupancy changes.
  for (let pass = 0; pass < 24; pass++) {
    s.time += 0.5;
    guard.guardNextThink = 0;
    const expected = referenceThreat(s, guard);
    updateGuard(s, guard);
    assert.equal(guard.guardTargetId ?? null, expected?.id ?? null);
    if (expected) {
      if (pass % 2) expected.hp = 0;
      else expected.carrierId = assist.id;
    }
  }
});

test('guard skips terrain rays for farther visible enemies once its nearest threat is found', () => {
  const s = E.createGame(8112);
  const guard = E.makeGround(s, 0, 'infantry', -1300, -300);
  guard.guard = { x: guard.x, z: guard.z };
  s.groundUnits.push(guard);
  for (let i = 0; i < 90; i++)
    s.groundUnits.push(E.makeGround(s, 1, 'apc', guard.x + 20 + i * 0.5, guard.z));
  let reads = 0;
  const wall = {
    id: s.nextId++,
    side: 0,
    key: 'housing',
    get x() {
      reads++;
      return guard.x + 55;
    },
    z: guard.z + 45,
    hp: 100,
    maxHp: 100,
    progress: 1,
  };
  s.buildings.push(wall);
  // Populate the static centre index before measuring per-guard sight work.
  E.lineOfSight(s, guard, s.groundUnits[1]);
  reads = 0;
  updateGuard(s, guard);
  assert.equal(guard.guardTargetId, s.groundUnits[1].id);
  assert.ok(reads < 10, `one guard must not cast ninety city/terrain rays: ${reads}`);
});

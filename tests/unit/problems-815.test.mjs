import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

test('problem markers name what own buildings and soldier groups lack, never the enemy', () => {
  const s = E.createGame(8156);
  s.sides[0].credits = 1e5;
  s.sides[0].materials = 1e4;
  const X = -E.HQ_X;
  const pad = E.build(s, 0, 'launcher', X + 150, 250);
  assert.notEqual(typeof pad, 'string', pad);
  pad.progress = 1;
  pad.hp = pad.maxHp;
  for (let i = 0; i < 5; i++) {
    const u = E.makeGround(s, 0, 'infantry', X + 300 + i * 4, 300);
    u.groundAmmo = u.ammoReserve = 0;
    s.groundUnits.push(u);
  }
  const enemy = E.makeGround(s, 1, 'infantry', -X - 300, 300);
  enemy.groundAmmo = enemy.ammoReserve = 0;
  s.groundUnits.push(enemy);
  const markers = E.problemMarkers(s, 0);
  assert.ok(markers.some((m) => m.kind === 'weapons' && m.id === pad.id));
  const ammo = markers.filter((m) => m.kind === 'ammo');
  assert.equal(ammo.length, 1, 'one marker for one group of soldiers');
  assert.equal(ammo[0].count, 5);
  assert.ok(
    markers.every((m) => m.x < 0),
    'no enemy problems leak',
  );
  const summary = E.problemSummary(markers);
  assert.equal(summary.find((p) => p.kind === 'ammo').count, 5);
  assert.equal(summary.find((p) => p.kind === 'ammo').label, 'Нет боеприпасов');
  pad.hp = pad.maxHp * 0.2;
  assert.ok(E.problemMarkers(s, 0).some((m) => m.id === pad.id));
});

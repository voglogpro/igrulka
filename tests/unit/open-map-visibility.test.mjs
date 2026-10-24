import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { playerView } from '../../src/network/perspective.js';
import { FogVeil } from '../../src/rendering/fog-veil.js';
import { EveningPost } from '../../src/rendering/effects/post-processing.js';

test('both network perspectives see far ordinary units and flights while concealment and future plans stay private', () => {
  for (const side of [0, 1]) {
    const s = E.createGame(891),
      enemy = 1 - side,
      sign = side ? -1 : 1;
    s.mode = 'multiplayer';
    const patch = E.COVER_PATCHES.find((p) => p.x * sign > 900 && Math.abs(p.z) < 800);
    assert.ok(patch);
    const hidden = E.makeGround(s, enemy, 'infantry', patch.x, patch.z);
    hidden.camouflaged = true;
    const tank = E.makeGround(s, enemy, 'leopard', sign * 1500, 700),
      foot = E.makeGround(s, enemy, 'infantry', sign * 1450, 760);
    foot.moving = true;
    tank.path = [{ x: sign * 1200, z: 600 }];
    tank.order = { mode: 'attack', x: 0, z: 0 };
    s.groundUnits.push(hidden, tank, foot);
    const air = {
      id: s.nextId++,
      side: enemy,
      key: 'drone',
      x: sign * 1500,
      y: 80,
      z: 700,
      hp: 20,
      delay: 0,
      launched: true,
      vx: -sign * 20,
      vz: 0,
      route: [{ x: 0, z: 0 }],
      targetId: 1,
      tx: 0,
      tz: 0,
    };
    s.units.push(air);
    s.sides[enemy].inventory.drone = 99;
    assert.equal(E.unitVisible(s, side, air), true);
    assert.equal(E.groundVisible(s, side, tank), true);
    assert.equal(E.groundVisible(s, side, foot), true);
    foot.moving = false;
    for (let i = 0; i < 15 && E.coverInfo(s, foot).concealment; i++) foot.z += 40;
    assert.equal(E.coverInfo(s, foot).concealment, 0);
    assert.equal(
      E.groundVisible(s, side, foot),
      true,
      'stationary uncovered infantry also remains visible far away',
    );
    assert.equal(E.groundVisible(s, side, hidden), false);
    const view = playerView(s, side),
      visibleTank = view.groundUnits.find((u) => u.id === tank.id),
      visibleAir = view.units.find((u) => u.id === air.id);
    assert.ok(visibleTank && visibleAir);
    assert.ok(view.groundUnits.some((u) => u.id === foot.id));
    assert.ok(!view.groundUnits.some((u) => u.id === hidden.id));
    assert.equal(visibleTank.path, undefined);
    assert.equal(visibleTank.order, undefined);
    assert.equal(visibleAir.route, undefined);
    assert.equal(visibleAir.targetId, undefined);
    assert.notEqual(view.sides[1].inventory.drone, 99);
    hidden.moving = true;
    assert.ok(
      playerView(s, side).groundUnits.some((u) => u.id === hidden.id),
      'movement reveals the covered soldier',
    );
  }
});

test('retired map fog has no periodic grid work or effect on the atmospheric post pass', () => {
  const s = E.createGame(892),
    original = E.visionOf(s, 0);
  for (let i = 0; i < 100; i++) {
    s.time += 1;
    s.networkRevision++;
    assert.equal(E.visionOf(s, i % 2), original);
    assert.ok(E.fogVisible(s, i % 2, 1800, 1400));
  }
  const veil = new FogVeil();
  assert.equal(veil.active, false);
  assert.equal(veil.texture.image.data[3], 0);
  veil.update(s, 1);
  assert.equal(veil.active, false);
  const uniforms = { visionActive: { value: 1 }, groundFog: { value: 0.65 } };
  EveningPost.prototype.setVision.call({ uniforms }, { active: true });
  assert.equal(uniforms.visionActive.value, 0);
  assert.equal(uniforms.groundFog.value, 0.65, 'atmospheric depth fog is unaffected');
  veil.texture.dispose();
});

import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { damageGround } from '../../src/game/units/ground/combat.js';

// Two neighbouring front sectors of the sea map: the northern corridor and the northern shore.
const NORTH = E.FRONT_SECTORS.find((v) => v.id === 'north').z,
  SHORE = E.FRONT_SECTORS.find((v) => v.id === 'north-rear').z;
let deployments = 0,
  returns = 0,
  loads = 0,
  fortified = 0;
for (const [index, seed] of [861, 862, 2024, 2410].entries()) {
  const side = index % 2,
    direction = side ? -1 : 1;
  let s = E.createGame(seed);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 100000;
    f.materials = 10000;
    f.rearAuto = false;
  }
  const add = (owner, key, x, z, reserve) => {
    const u = E.makeGround(s, owner, key, x, z);
    u.holdFire = true;
    u.autoDefense = reserve;
    if (owner === side) {
      u.guard = { x, z };
      u.order = { x, z, mode: 'guard' };
    }
    s.groundUnits.push(u);
    return u;
  };
  const homes = new Map();
  for (const z of [NORTH, SHORE])
    for (let i = 0; i < 6; i++) {
      const u = add(
        side,
        i === 0 ? 'apc' : i === 1 ? 'engineer' : 'infantry',
        direction * (-450 + i * 11),
        z,
        true,
      );
      homes.set(u.id, { ...u.guard });
    }
  const pinned = add(side, 'infantry', direction * -500, NORTH, false);
  const pinnedPost = { ...pinned.guard };
  let foes = [],
    lastEvent = 0;
  for (let tick = 0; tick < 7200; tick++) {
    const cycle = tick % 2400;
    if (cycle === 0 || cycle === 1400) {
      const z = cycle === 0 ? NORTH : SHORE;
      for (let i = 0; i < 6; i++)
        foes.push(add(1 - side, 'leopard', direction * (-330 + i * 8), z, false).id);
    }
    if (cycle === 1000 || cycle === 2200) {
      for (const id of foes) {
        const u = s.groundUnits.find((u) => u.id === id);
        if (u) damageGround(s, u, 10000, undefined, 'blast');
      }
      foes = [];
    }
    const positions = new Map(s.groundUnits.map((u) => [u.id, { x: u.x, z: u.z }]));
    E.step(s, 0.05);
    assert.deepEqual(s.groundUnits.find((u) => u.id === pinned.id).guard, pinnedPost);
    const active = s.groundUnits.filter((u) => u.side === side && u.defenseTask);
    assert.ok(active.length <= E.FRONTLINE.maxReinforcing);
    for (const u of s.groundUnits) {
      const old = positions.get(u.id);
      if (old)
        assert.ok(
          Math.hypot(u.x - old.x, u.z - old.z) <= E.GROUND_UNITS[u.key].speed * 0.05 * 1.3 + 1e-6,
        );
      assert.ok([u.x, u.z, u.hp].every(Number.isFinite));
    }
    const report = E.frontlineReport(s, side);
    assert.equal(report.polyline.length, 5);
    assert.ok(
      report.polyline.every((p) => Number.isFinite(p.x) && p.confidence >= 0 && p.confidence <= 1),
    );
    assert.ok(s.frontlineMemory.every((memory) => memory.seen.length <= E.FRONTLINE.maxSeen));
    const newEvents = s.events.filter((event) => event.id > lastEvent);
    assert.ok(
      newEvents.filter((event) => event.type === 'defenseRedeployed' && event.side === side)
        .length <= E.FRONTLINE.maxNewAssignments,
    );
    deployments += newEvents.filter((event) => event.type === 'defenseRedeployed').length;
    returns += newEvents.filter((event) => event.type === 'defenseReturned').length;
    fortified += newEvents.filter(
      (event) => event.type === 'fortification' && event.level === 3,
    ).length;
    lastEvent = s.events.at(-1)?.id || lastEvent;
    assert.ok(s.sides.every((f) => f.credits >= 0 && f.materials >= 0));
    assert.ok(s.trenches.length <= E.FORTIFICATION.maxPositions);
    if (tick % 1000 === 900) {
      const saved = JSON.parse(E.save(s)),
        loaded = E.load(JSON.stringify(saved));
      assert.deepEqual(loaded.frontlineMemory, saved.frontlineMemory);
      assert.deepEqual(loaded.trenches, saved.trenches);
      assert.deepEqual(loaded.groundUnits, saved.groundUnits);
      s = loaded;
      loads++;
    }
  }
  E.advance(s, 90);
  returns += s.events.filter(
    (event) => event.id > lastEvent && event.type === 'defenseReturned',
  ).length;
  assert.ok(s.groundUnits.filter((u) => u.side === side).every((u) => !u.defenseTask));
  for (const [id, home] of homes) {
    const u = s.groundUnits.find((u) => u.id === id);
    assert.ok(Math.hypot(u.x - home.x, u.z - home.z) < 4);
  }
  console.log(
    JSON.stringify({
      seed,
      side,
      minutes: s.time / 60,
      positions: s.trenches.length,
      reinforced: s.trenches.filter((t) => E.fortificationStatus(t).level === 3).length,
    }),
  );
}
assert.ok(deployments > 0 && returns > 0 && fortified > 0);
console.log(
  JSON.stringify({
    runs: 4,
    minutesPerRun: 7.5,
    deployments,
    returns,
    loadCycles: loads,
    completedCheckpoints: fortified,
  }),
);

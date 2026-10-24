import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { damageGround } from '../../src/game/units/ground/combat.js';
import { corridorGeometry } from '../../src/game/defense/geometry.js';

let deployments = 0,
  returns = 0,
  loads = 0,
  fortified = 0,
  captures = 0;
const runs = [];
for (const [index, seed] of [881, 882, 2024, 2410].entries()) {
  const side = index % 2,
    direction = side === 0 ? 1 : -1;
  let s = E.createGame(seed);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 100000;
    f.materials = 10000;
    f.rearAuto = false;
  }
  const add = (owner, key, x, z, auto = false) => {
    const u = E.makeGround(s, owner, key, x, z);
    u.holdFire = true;
    u.autoDefense = auto;
    if (owner === side) {
      u.guard = { x, z };
      u.order = { x, z, mode: 'guard' };
    }
    s.groundUnits.push(u);
    return u;
  };
  for (let i = 0; i < 28; i++)
    add(
      side,
      i >= 26 ? 'apc' : i >= 24 ? 'engineer' : i >= 20 ? 'atrifle' : 'infantry',
      direction * -500,
      (i - 14) * 5,
      true,
    );
  E.advance(s, 210);
  for (const line of corridorGeometry(s, side))
    assert.equal(s.districts.find((d) => d.id === line.districtId).owner, side);
  captures += s.districts.filter((d) => d.owner === side).length;
  assert.ok(E.frontlineReport(s, side).sectors.every((v) => !v.coverage.weak));
  const pinned = add(side, 'infantry', direction * -450, E.CORRIDORS[0], false),
    pinnedPost = { ...pinned.guard };
  const primary = s.groundUnits
    .filter((u) => u.side === side && u.defensePost?.row === 0)
    .map((u) => ({ id: u.id, guard: { ...u.guard } }));
  let foes = [],
    lastEvent = s.events.at(-1)?.id || 0,
    lastDeployment = -Infinity,
    localDeployments = 0;
  for (let tick = 0; tick < 7200; tick++) {
    const cycle = tick % 2400;
    if (cycle === 0 || cycle === 1400) {
      const corridorId = cycle === 0 ? 'north' : 'south';
      const p = E.frontlineReport(s, side).posts.find(
        (p) => p.corridorId === corridorId && p.slot === 2,
      );
      for (let i = 0; i < 5; i++)
        foes.push(add(1 - side, 'leopard', p.x + direction * (65 + i * 8), p.z + i * 3).id);
    }
    if (cycle === 1000 || cycle === 2200) {
      for (const id of foes) {
        const u = s.groundUnits.find((u) => u.id === id);
        if (u) damageGround(s, u, 10000, undefined, 'blast');
      }
      foes = [];
    }
    const before = new Map(s.groundUnits.map((u) => [u.id, { x: u.x, z: u.z }]));
    E.step(s, 0.05);
    assert.deepEqual(s.groundUnits.find((u) => u.id === pinned.id).guard, pinnedPost);
    for (const p of primary)
      assert.deepEqual(s.groundUnits.find((u) => u.id === p.id).guard, p.guard);
    const active = s.groundUnits.filter((u) => u.side === side && u.defenseTask);
    assert.ok(active.length <= 6);
    const reinforcing = active.filter((u) => !u.defenseTask.returning);
    assert.equal(
      new Set(reinforcing.map((u) => `${u.guard.x},${u.guard.z}`)).size,
      reinforcing.length,
    );
    for (let i = 0; i < reinforcing.length; i++)
      for (let j = i + 1; j < reinforcing.length; j++) {
        const a = reinforcing[i],
          b = reinforcing[j],
          clearance = (E.GROUND_UNITS[a.key].size + E.GROUND_UNITS[b.key].size) * 0.5 + 7;
        assert.ok(Math.hypot(a.guard.x - b.guard.x, a.guard.z - b.guard.z) >= clearance - 1e-6);
      }
    for (const u of s.groundUnits) {
      const previous = before.get(u.id);
      if (previous)
        assert.ok(
          Math.hypot(u.x - previous.x, u.z - previous.z) <=
            E.GROUND_UNITS[u.key].speed * 0.05 * 1.3 + 1e-6,
        );
      assert.ok([u.x, u.z, u.hp].every(Number.isFinite));
    }
    const report = E.frontlineReport(s, side);
    assert.equal(report.lines.length, 2);
    assert.equal(report.polyline.filter((p) => p.breakBefore).length, 1);
    assert.ok(report.sectors.every((v) => !v.coverage.weak));
    assert.ok(s.frontlineMemory.every((m) => m.seen.length <= 120));
    const events = s.events.filter((e) => e.id > lastEvent);
    for (const e of events.filter((e) => e.type === 'defenseRedeployed' && e.side === side)) {
      assert.ok(e.time - lastDeployment >= 3 - 1e-6);
      lastDeployment = e.time;
      deployments++;
      localDeployments++;
    }
    returns += events.filter((e) => e.type === 'defenseReturned' && e.side === side).length;
    fortified += events.filter(
      (e) => e.type === 'fortification' && e.level === 3 && e.side === side,
    ).length;
    lastEvent = s.events.at(-1)?.id || lastEvent;
    assert.ok(s.sides.every((f) => f.credits >= 0 && f.materials >= 0));
    assert.ok(s.trenches.length <= 240);
    if (tick % 1000 === 900) {
      const saved = JSON.parse(E.save(s)),
        loaded = E.load(JSON.stringify(saved));
      assert.deepEqual(loaded.frontlineMemory, saved.frontlineMemory);
      assert.deepEqual(loaded.groundUnits, saved.groundUnits);
      assert.deepEqual(loaded.trenches, saved.trenches);
      s = loaded;
      loads++;
    }
  }
  E.advance(s, 150);
  returns += s.events.filter(
    (e) => e.id > lastEvent && e.type === 'defenseReturned' && e.side === side,
  ).length;
  assert.ok(s.groundUnits.filter((u) => u.side === side).every((u) => !u.defenseTask));
  assert.ok(localDeployments >= 12);
  const summary = {
    seed,
    side,
    minutes: 12,
    positions: s.trenches.length,
    deployments: localDeployments,
    coverage: E.frontlineReport(s, side).sectors.map((v) => v.coverage),
  };
  runs.push(summary);
  console.log(JSON.stringify(summary));
}
console.log(
  JSON.stringify({
    runs: runs.length,
    minutesPerRun: 12,
    deployments,
    returns,
    loadCycles: loads,
    fortified,
    captures,
  }),
);

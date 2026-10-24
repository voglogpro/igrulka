import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
let repairs = 0,
  snapshots = 0;
for (const seed of [24, 117, 834, 2410]) {
  let s = E.createGame(seed);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 20000;
    f.materials = 3000;
    f.rearAuto = false;
  }
  const stations = [],
    houses = [];
  for (const side of [0, 1])
    for (const [key, x, z, output] of [
      ['service', side ? 680 : -680, -80, stations],
      ['housing', side ? 560 : -560, -80, houses],
    ]) {
      const b = E.build(s, side, key, x, z);
      assert.equal(typeof b, 'object', String(b));
      b.progress = 1;
      b.hp = b.maxHp;
      output.push(b.id);
    }
  const hp = (side) =>
    s.buildings.filter((b) => b.side === side).reduce((n, b) => n + b.hp, 0) +
    s.roads.filter((r) => r.side === side).reduce((n, r) => n + r.hp, 0);
  for (let tick = 0; tick < 12000; tick++) {
    if (tick % 400 === 0)
      for (const id of houses) {
        const b = s.buildings.find((b) => b.id === id);
        b.hp = Math.max(1, b.hp - 50);
      }
    if (tick % 1800 === 0)
      for (const side of [0, 1]) {
        const road = s.roads.find((r) => r.side === side && r.camp && r.ax === (side ? 585 : -645));
        E.damageRoad(s, road, 120);
      }
    if (tick % 1800 === 400)
      for (let side = 0; side < 2; side++) E.setServiceEnabled(s, side, stations[side], false);
    if (tick % 1800 === 500)
      for (let side = 0; side < 2; side++) E.setServiceEnabled(s, side, stations[side], true);
    const rates = [E.economy(s, 0), E.economy(s, 1)];
    const old = s.sides.map((f) => ({ credits: f.credits, materials: f.materials }));
    const before = [hp(0), hp(1)];
    E.step(s, 0.05);
    for (let side = 0; side < 2; side++) {
      const delta = hp(side) - before[side];
      repairs += delta;
      near(s.sides[side].credits, old[side].credits + rates[side].net * 0.05 - delta * 0.3);
      near(
        s.sides[side].materials,
        old[side].materials + rates[side].materials * 0.05 - delta * 0.025,
      );
      assert.ok(s.sides[side].credits >= 0 && s.sides[side].materials >= 0);
    }
    if (tick % 1200 === 1100) {
      s = E.load(E.save(s));
      snapshots++;
    }
    assert.ok(s.serviceVehicles.length <= 4);
  }
  assert.ok(
    houses.every((id) => {
      const b = s.buildings.find((b) => b.id === id);
      return b.hp === b.maxHp;
    }),
  );
  console.log(
    JSON.stringify({
      seed,
      minutes: s.time / 60,
      fleet: s.serviceVehicles.length,
      weather: s.weather.kind,
    }),
  );
}
near(repairs, 18720);
console.log(
  JSON.stringify({ runs: 4, minutesPerRun: 10, loadCycles: snapshots, actualPaidHp: repairs }),
);

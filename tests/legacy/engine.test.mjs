import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../archive/legacy/engine.js';

test('construction charges resources and creates a persistent 3D placement on completion', () => {
  const s = E.createGame('normal', 1),
    cash = s.cash,
    n = s.cities[0].buildings.housing;
  assert.equal(E.placeBuilding(s, 'aurora', 'housing', 260, 80), null);
  assert.equal(s.cash, cash - E.BUILDINGS.housing.cost);
  assert.equal(s.queue[0].position.x, 260);
  assert.match(E.placeBuilding(s, 'aurora', 'housing', 260, 80), /занят/);
  E.nextDay(s);
  assert.equal(s.placements.length, 1);
  assert.equal(s.cities[0].buildings.housing, n + 1);
  assert.equal(E.demolish(s, s.placements[0].id), null);
  assert.equal(s.cities[0].buildings.housing, n);
});
test('roads, costs, save restoration and invalid coordinates', () => {
  const s = E.createGame('normal', 2),
    cash = s.cash;
  assert.equal(E.addRoad(s, { x: 10, z: 10 }, { x: 110, z: 10 }), null);
  assert.equal(s.cash, cash - 70);
  assert.ok(E.addRoad(s, { x: NaN, z: 0 }, { x: 30, z: 10 }));
  assert.deepEqual(E.validateSave(JSON.parse(JSON.stringify(s))), s);
});
test('research unlocks all four systems with prerequisites and actual durations', () => {
  const s = E.createGame('easy', 3);
  s.science = 5000;
  s.cash = 100000;
  s.metal = 5000;
  assert.ok(E.produce(s, 'ballistic', 1));
  assert.ok(E.research(s, 'ballistic'));
  for (const id of ['heavy', 'cruise', 'ballistic']) {
    if (s.event) E.resolveEvent(s, 0);
    const t = E.TECHS.find((t) => t.id === id);
    assert.equal(E.research(s, id), null);
    for (let i = 0; i < t.days; i++) {
      if (s.event) E.resolveEvent(s, 0);
      E.nextDay(s);
    }
    assert.ok(s.tech.includes(id));
  }
  if (s.event) E.resolveEvent(s, 0);
  assert.equal(E.produce(s, 'ballistic', 2), null);
  for (let i = 0; i < 4; i++) {
    if (s.event) E.resolveEvent(s, 0);
    E.nextDay(s);
  }
  assert.equal(s.units.ballistic, 2);
});
test('raid reserves inventory, cancellation restores it and battles apply damage', () => {
  const s = E.createGame('easy', 4);
  assert.equal(E.raid(s, 'vesper', { scout: 5 }), null);
  assert.equal(s.units.scout, 5);
  assert.equal(E.cancelRaid(s, s.orders[0].id), null);
  assert.equal(s.units.scout, 10);
  assert.equal(E.raid(s, 'vesper', { scout: 10 }), null);
  const r = E.nextDay(s);
  assert.equal(s.orders.length, 0);
  assert.equal(s.stats.launched, 10);
  assert.ok(r.dealt > 0);
  assert.equal(r.flights[0].units.scout, 10);
});
test('energy shortage and damaged factories reduce actual output', () => {
  const s = E.createGame('normal', 5),
    e = E.economics(s);
  s.cities.forEach((c) => (c.buildings.energy = 0));
  const shortage = E.economics(s);
  assert.ok(shortage.net < e.net);
  assert.ok(shortage.power < 1);
  s.cities.forEach((c) => (c.hp = 30));
  const damaged = E.economics(s);
  assert.ok(damaged.income < shortage.income);
});
test('defense uses ammunition, upgrades change interception, exhausted ammo lowers protection', () => {
  const s = E.createGame('normal', 6),
    c = s.cities[0],
    base = E.coverage(s, c);
  c.buildings.gun = 3;
  assert.ok(E.coverage(s, c) > base);
  s.ammo = 0;
  assert.ok(E.coverage(s, c) < base);
  s.ammo = 48;
  E.nextDay(s);
  const before = s.ammo,
    r = E.nextDay(s);
  assert.ok(r.incoming > 0);
  assert.ok(s.ammo < before);
});
test('cancelled construction refunds 75 percent and cannot complete', () => {
  const s = E.createGame('normal', 7),
    cash = s.cash;
  E.build(s, 'aurora', 'industry');
  const id = s.queue[0].id;
  assert.equal(E.cancel(s, id), null);
  assert.equal(s.cash, cash - 330 + Math.floor(330 * 0.75));
  E.nextDay(s);
  assert.equal(s.cities[0].buildings.industry, 2);
});
test('events block time and resource mutations until a valid choice', () => {
  const s = E.createGame('easy', 8);
  for (let i = 0; i < 5; i++) E.nextDay(s);
  assert.ok(s.event);
  assert.ok(E.nextDay(s).error);
  assert.ok(E.buyAmmo(s));
  assert.equal(E.resolveEvent(s, 0), null);
  assert.equal(s.event, null);
});
test('both campaign endings and the sixty-day survival rule are reachable', () => {
  const lose = E.createGame('normal', 9);
  lose.cities[0].hp = 0;
  E.nextDay(lose);
  assert.equal(lose.status, 'defeat');
  const win = E.createGame('normal', 9);
  win.enemies.forEach((c) => (c.hp = 0));
  E.nextDay(win);
  assert.equal(win.status, 'victory');
  const survive = E.createGame('easy', 12);
  survive.day = 60;
  survive.cities.forEach((c) => {
    c.buildings.gun = 3;
    c.buildings.sam = 3;
    c.buildings.shield = 2;
  });
  survive.tech = ['radar', 'efficiency', 'abm', 'resilience'];
  survive.ammo = 200;
  E.nextDay(survive);
  assert.equal(survive.status, 'victory');
  assert.equal(survive.day, 61);
});
test('invalid or hostile save data cannot enter charts, construction or flight rendering', () => {
  for (const mutate of [
    (s) =>
      s.history.push({ day: 1, cash: '<svg>', integrity: 100, power: 100, morale: 80, net: 1 }),
    (s) =>
      s.queue.push({
        id: 2,
        type: 'build',
        cityId: 'aurora',
        key: 'gun',
        left: 1,
        total: 1,
        cost: 1,
        metal: 1,
        position: { x: NaN, z: 0 },
      }),
    (s) => s.roads.push({ id: 1, a: { x: 0, z: 0 }, b: { x: Infinity, z: 0 } }),
    (s) => (s.stats.damage = -1),
  ]) {
    const s = E.createGame();
    mutate(s);
    assert.throws(() => E.validateSave(s));
  }
});
test('long campaigns remain finite and resumable on every difficulty', () => {
  const results = {};
  for (const diff of Object.keys(E.DIFFICULTIES)) {
    results[diff] = { victory: 0, defeat: 0 };
    for (let seed = 1; seed <= 25; seed++) {
      let s = E.createGame(diff, seed);
      while (s.status === 'playing' && s.day <= 60) {
        if (s.event)
          E.resolveEvent(
            s,
            s.event.choices.findIndex((c) => !c.cost || s.cash >= c.cost),
          );
        if (s.ammo < 45) E.buyAmmo(s);
        for (const c of [...s.cities].sort(
          (a, b) => (a.id === 'aurora' ? -100 : 0) + a.hp - ((b.id === 'aurora' ? -100 : 0) + b.hp),
        ))
          if (c.hp < 82) E.repair(s, c.id);
        if (E.economics(s).capacity < E.economics(s).demand + 18) {
          for (const c of s.cities)
            if (
              c.hp > 60 &&
              c.buildings.energy < 4 &&
              !s.queue.some((q) => q.key === 'energy' && q.cityId === c.id)
            ) {
              E.build(s, c.id, 'energy');
              break;
            }
        }
        if (!s.research) {
          for (const id of [
            'radar',
            'logistics',
            'efficiency',
            'grid',
            'abm',
            'resilience',
            'automation',
            'science',
            'heavy',
            'cruise',
            'ballistic',
            'guidance',
          ])
            if (!s.tech.includes(id) && E.research(s, id) === null) break;
        }
        for (const c of s.cities) {
          const pending = (k) => s.queue.some((q) => q.cityId === c.id && q.key === k);
          if (c.buildings.gun < 2 && !pending('gun')) E.build(s, c.id, 'gun');
          if (s.tech.includes('radar') && c.buildings.sam < 2 && !pending('sam'))
            E.build(s, c.id, 'sam');
          if (s.tech.includes('abm') && c.buildings.shield < 1 && !pending('shield'))
            E.build(s, c.id, 'shield');
          if (s.day > 20 && c.buildings.shelter < 2 && !pending('shelter'))
            E.build(s, c.id, 'shelter');
        }
        E.nextDay(s);
        s = E.validateSave(JSON.parse(JSON.stringify(s)));
        assert.ok(
          ['cash', 'metal', 'science', 'morale', 'ammo'].every(
            (k) => Number.isFinite(s[k]) && s[k] >= 0,
          ),
        );
      }
      results[diff][s.status]++;
    }
  }
  console.log('75 full campaign simulations:', JSON.stringify(results));
  assert.ok(results.easy.victory > 0);
  assert.ok(results.normal.victory > 0);
});

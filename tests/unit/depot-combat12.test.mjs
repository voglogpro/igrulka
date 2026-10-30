import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { corridorGeometry, defensePostPoint } from '../../src/game/defense/geometry.js';
import { coverInfo } from '../../src/game/units/infantry/cover.js';
import { damageGround } from '../../src/game/units/ground/combat.js';
import { depotSupplyPoint } from '../../src/game/defense/supply.js';
import { updateDefenseReserves } from '../../src/game/defense/reserves.js';
import { playerView } from '../../src/network/perspective.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fresh(mode = 'multiplayer') {
  const s = E.createGame(812, { mode });
  s.rules.oil = false;
  s.rules.rear = false;
  if (mode === 'coop')
    for (const p of [s.ai, s.aiBySide[3]]) {
      // Isolate the four-owner commander/network contract from city production.
      p.nextBuild = p.nextAttack = p.nextArmy = 1e9;
    }
  return s;
}
function own(s, side, corridor = null) {
  for (const d of s.districts)
    if (!corridor || d.id === `${corridor}-depot`) {
      d.owner = side;
      d.control = side % 2 ? -1 : 1;
    }
}
function troop(s, side, key, p, holdFire = false) {
  assert.ok(E.walkable(s, p.x, p.z, E.GROUND_UNITS[key].size * 0.42), 'valid spawn');
  const u = E.makeGround(s, side, key, p.x, p.z);
  u.holdFire = holdFire;
  s.groundUnits.push(u);
  return u;
}
function post(s, side, key, line, row, slot, holdFire = false) {
  const ref = { corridorId: line, row, slot };
  const p = defensePostPoint(corridorGeometry(s, side), ref, side % 2 ? -1 : 1);
  const u = troop(s, side, key, p, holdFire);
  u.autoDefense = true;
  u.guard = { ...p };
  u.order = { ...p, mode: 'guard' };
  u.stance = { mode: 'defend', post: 'auto' };
  u.defensePost = ref;
  return u;
}
function defend(s, side, units) {
  assert.equal(
    E.applyStance(
      s,
      side,
      units.map((u) => u.id),
      { mode: 'defend', post: 'auto' },
    ),
    units.length,
  );
}
function watchArmy(s, side) {
  const snipers = [];
  for (const line of corridorGeometry(s, side)) {
    for (const row of [0, 4])
      for (const slot of line.slots) post(s, side, 'infantry', line.id, row, slot.slot);
    for (const slot of [2, 3]) snipers.push(post(s, side, 'sniper', line.id, 2, slot));
  }
  return snipers;
}
function until(s, condition, seconds, sample = () => {}) {
  for (let i = 0; i < seconds && !condition(); i++) {
    E.advance(s, 1);
    sample();
  }
  assert.ok(condition(), `condition must become true within ${seconds}s (time=${s.time})`);
}

test('forty ordinary machinegunners physically occupy balanced outer, inner and rear layers', () => {
  const s = fresh();
  own(s, 0);
  const units = Array.from({ length: 40 }, (_, i) =>
    troop(
      s,
      0,
      'machinegunner',
      {
        x: -1092 - (i % 5) * 8,
        z: (Math.floor(i / 5) - 4) * 8,
      },
      true,
    ),
  );
  defend(s, 0, units);
  E.step(s, 0.05);
  assert.ok(units.filter((u) => u.defensePost).length <= E.FRONTLINE.maxNewAssignments);
  E.advance(s, 260);
  for (const line of corridorGeometry(s, 0)) {
    const local = units.filter((u) => u.defensePost?.corridorId === line.id);
    assert.equal(local.length, 20);
    // The wide corridor first completes its outer line, then the depot core, then the rear.
    assert.equal(local.filter((u) => u.defensePost.row === 0).length, line.slots.length);
    assert.ok(local.filter((u) => u.defensePost.row === 2).length >= 2);
    assert.ok(local.filter((u) => u.defensePost.row >= 4).length >= 1);
    for (const u of local) {
      assert.equal(u.path.length, 0);
      assert.ok(distance(u, u.guard) < 4);
      // The wide corridor's inner garrison spreads 20 m apart around and beside the depot.
      if (u.defensePost.row === 2) assert.ok(Math.abs(u.z - line.depot.z) < 20 * line.slots.length);
    }
  }
});

test('armour, anti-armour, mobile AA and artillery obtain useful distinct physical depot layers', () => {
  const s = fresh();
  own(s, 0);
  const keys = [
    ...Array(12).fill('infantry'),
    'atrifle',
    'atgm',
    'leopard',
    'lighttank',
    'tankdestroyer',
    'ifv',
    'shilka',
    'gepard',
    'mog',
    'howitzer',
    'mlrs',
  ];
  const units = keys.map((key, i) =>
    troop(
      s,
      0,
      key,
      {
        x: -300 + Math.floor(i / 2) * 8,
        z: (i % 2 ? 1360 : -1360) + (Math.floor(i / 2) - 5.5) * 10,
      },
      true,
    ),
  );
  defend(s, 0, units);
  E.advance(s, 120);
  for (const u of units) {
    assert.ok(u.defensePost && u.guard, `${u.key}: assigned physical guard`);
    assert.ok(E.walkable(s, u.guard.x, u.guard.z, E.GROUND_UNITS[u.key].size * 0.42));
    assert.ok(distance(u, u.guard) < 5 && !u.path.length, `${u.key}: arrived, not just assigned`);
    const row = u.defensePost.row;
    if (['leopard', 'lighttank', 'tankdestroyer', 'ifv'].includes(u.key)) assert.equal(row, 1);
    if (['shilka', 'gepard'].includes(u.key)) assert.equal(row, 3);
    if (['atgm', 'atrifle', 'mog'].includes(u.key)) assert.equal(row, 2);
    if (['howitzer', 'mlrs'].includes(u.key)) assert.ok(row >= 5 && row % 2 === 1);
  }
});

test('normal infantry fight a dug-in hostile garrison, capture its depot and face a combined-arms countercapture', () => {
  const s = fresh();
  own(s, 0);
  own(s, 1, 'north');
  const flag = s.districts.find((d) => d.id === 'north-depot');
  const guards = [2, 3].map((slot) => post(s, 1, 'infantry', 'north', 2, slot));
  for (const u of guards) s.trenches.push({ id: s.nextId++, side: 1, x: u.x, z: u.z, progress: 1 });
  const attackers = Array.from({ length: 20 }, (_, i) =>
    troop(s, 0, 'infantry', { x: -250 - (i % 4) * 10, z: -1360 + Math.floor(i / 4) * 6 }),
  );
  defend(s, 0, attackers);
  const shots = new Set();
  const sample = () => {
    for (const e of s.events) if (e.type === 'shot') shots.add(e.id);
  };
  until(s, () => flag.owner === 0, 240, sample);
  assert.ok(
    guards.every((u) => u.hp <= 0),
    'the live hostile garrison cannot be waved away',
  );
  assert.ok(
    attackers.some((u) => u.hp <= 0),
    'normal health and ammunition entail actual losses',
  );
  assert.ok(shots.size > 10);
  assert.ok(s.groundUnits.some((u) => u.side === 0 && distance(u, E.DISTRICTS[0]) < 64));
  // Ordinary rifles can exhaust both sides' finite magazines against completed
  // earthworks. The same thirty-person counterwave brings normal support weapons.
  const counterKeys = [
    ...Array(22).fill('infantry'),
    ...Array(6).fill('machinegunner'),
    ...Array(2).fill('sniper'),
  ];
  const counterattack = counterKeys.map((key, i) =>
    troop(s, 1, key, { x: 250 + (i % 4) * 10, z: -1360 + Math.floor(i / 4) * 6 }),
  );
  defend(s, 1, counterattack);
  const before = s.groundUnits.filter((u) => u.side === 0).length;
  until(s, () => flag.owner === 1, 180, sample);
  assert.ok(s.groundUnits.filter((u) => u.side === 0).length < before);
  assert.ok(counterattack.some((u) => u.hp < u.maxHp));
  assert.ok(s.stats.districtsCaptured >= 2);
});

test('a visible moving rear intruder is followed at bounded cadence and surviving reserves physically return', () => {
  const s = fresh();
  own(s, 0);
  const units = [];
  for (const row of [0, 2, 4, 6])
    for (const line of corridorGeometry(s, 0))
      for (const slot of line.slots)
        units.push(post(s, 0, 'infantry', line.id, row, slot.slot, true));
  const enemy = troop(s, 1, 'leopard', { x: -1242, z: -100 }, true);
  E.step(s, 0.05);
  const sent = units.find((u) => u.defenseTask);
  assert.ok(sent);
  const home = { ...sent.defenseTask.home },
    initial = { ...sent.guard };
  assert.ok(distance(initial, enemy) < 140);
  assert.equal(E.orderGround(s, 1, [enemy.id], { x: -1572, z: -350, mode: 'move' }), 1);
  const start = { x: sent.x, z: sent.z };
  E.advance(s, 14);
  assert.ok(distance(enemy, { x: -1242, z: -100 }) > 200, 'the intruder really moved');
  assert.ok(sent.defenseTask && !sent.defenseTask.returning);
  assert.ok(distance(sent.guard, initial) > 100);
  assert.ok(
    distance(sent.guard, enemy) < 140,
    'the fresh interception marker follows the observed tank',
  );
  assert.ok(distance(sent, start) > 100 && distance(sent, sent.guard) > 100);
  assert.ok(units.filter((u) => u.defenseTask).length <= E.FRONTLINE.maxReinforcing);
  damageGround(s, enemy, 1e9, undefined, 'blast');
  E.advance(s, 120);
  assert.equal(sent.defenseTask, null);
  assert.deepEqual(sent.guard, home);
  assert.ok(distance(sent, home) < 4);
});

function visibleBreach(s, ownUnits, target, armor = 1) {
  const memory = s.frontlineMemory[ownUnits[0].side];
  memory.seen = [{ id: target.id, x: target.x, z: target.z, time: s.time, strength: 3 }];
  const report = {
    posts: [
      {
        x: target.x,
        z: target.z,
        corridorId: 'north',
        threatPoint: { id: target.id, x: target.x, z: target.z },
        breakthrough: 1,
        pressure: 2,
        armor,
        enemy: 1,
        reserved: true,
      },
    ],
    sectors: [{ id: 'north', enemy: 1, contacts: 0, pressure: 2 }],
  };
  updateDefenseReserves(s, ownUnits[0].side, ownUnits, report, memory);
}

test('a coincident intruder produces a finite radial FPV interception outside rifle range for both owners', () => {
  for (const side of [0, 1]) {
    const s = fresh();
    own(s, side);
    const operator = post(s, side, 'operator', 'north', 4, 2, true);
    const buddies = [0, 5].map((slot) => post(s, side, 'infantry', 'north', 4, slot, true));
    const target = troop(s, side ^ 1, 'leopard', operator, true);
    assert.ok(operator.fpvAmmo > 0);
    visibleBreach(s, [operator, ...buddies], target);
    assert.ok(operator.defenseTask && operator.path.length);
    assert.ok(Number.isFinite(operator.guard.x) && Number.isFinite(operator.guard.z));
    assert.ok(distance(operator.guard, target) >= 185);
    assert.ok(
      distance(operator.guard, target) < 200,
      'within the existing FPV engagement envelope',
    );
    assert.ok(side ? operator.guard.x > target.x : operator.guard.x < target.x);
    assert.ok(
      buddies.every((u) => !u.defenseTask),
      'one bounded reinforcement per pulse',
    );
  }
});

test('comparable travel times favour actual anti-armour weapons and indirect reserves respect their dead zone', () => {
  const s = fresh();
  own(s, 0);
  const antiarmour = post(s, 0, 'atgm', 'north', 4, 2, true);
  const rifles = [0, 1, 3, 4, 5].map((slot) => post(s, 0, 'infantry', 'north', 4, slot, true));
  const target = troop(s, 1, 'leopard', { x: -692, z: -1360 }, true);
  visibleBreach(s, [antiarmour, ...rifles], target);
  assert.ok(
    antiarmour.defenseTask,
    'effective anti-armour is preferred over a slightly closer rifleman',
  );
  assert.ok(rifles.every((u) => !u.defenseTask));

  const indirect = fresh();
  own(indirect, 0);
  const guns = [2, 0, 5].map((slot) => post(indirect, 0, 'howitzer', 'north', 7, slot, true));
  const close = troop(indirect, 1, 'leopard', guns[0], true);
  visibleBreach(indirect, guns, close);
  assert.ok(guns[0].defenseTask && guns[0].path.length);
  assert.ok(distance(guns[0].guard, close) >= E.GROUND_UNITS.howitzer.groundMinRange + 25);
});

test('bounded sniper patrols physically reach natural concealment, preserve the core and return after their duty', () => {
  const s = fresh();
  own(s, 0);
  const snipers = watchArmy(s, 0);
  const posts = snipers.map((u) => structuredClone(u.defensePost));
  E.step(s, 0.05);
  assert.equal(snipers.filter((u) => u.defenseMission).length, 2, 'two new patrol paths per pulse');
  E.advance(s, 51);
  assert.equal(
    snipers.filter((u) => u.defenseMission).length,
    4,
    'bounded section, not the entire army',
  );
  for (const [i, u] of snipers.entries()) {
    assert.equal(u.defenseMission.phase, 'watch');
    assert.equal(u.path.length, 0);
    assert.ok(distance(u, u.defenseMission.point) < 5);
    assert.ok(distance(u, u.defenseMission.home) > 100);
    assert.ok(coverInfo(s, u).concealment >= 0.35, 'natural cover at the real physical position');
    assert.equal(
      !!u.camouflaged,
      false,
      'the commander cannot overwrite the player camouflage toggle',
    );
    assert.deepEqual(u.defensePost, posts[i]);
  }
  for (const line of corridorGeometry(s, 0))
    assert.ok(
      s.groundUnits.filter((u) => u.side === 0 && !u.defenseMission && distance(u, line.depot) < 64)
        .length >= 2,
    );
  E.advance(s, 144);
  for (const u of snipers) {
    assert.equal(u.defenseMission, null);
    assert.ok(distance(u, u.guard) < 4);
    assert.ok(u.defenseReadyAt > s.time);
  }
});

test('patrol movement saves exactly, zero-time steps stop it, and accepted manual orders cancel it', () => {
  const s = fresh();
  own(s, 0);
  const snipers = watchArmy(s, 0);
  E.advance(s, 22);
  assert.ok(snipers.every((u) => u.defenseMission));
  const paused = E.save(s);
  for (let i = 0; i < 20; i++) E.step(s, 0);
  assert.equal(E.save(s), paused, 'paused game loops supply zero simulation time');
  const loaded = E.load(E.save(s));
  E.advance(s, 12);
  E.advance(loaded, 12);
  for (const u of s.groundUnits) {
    const restored = loaded.groundUnits.find((v) => v.id === u.id);
    for (const key of [
      'x',
      'z',
      'yaw',
      'path',
      'order',
      'guard',
      'defensePost',
      'defenseMission',
      'hp',
      'groundAmmo',
      'ammoReserve',
    ])
      assert.deepEqual(restored[key], u[key], `${u.id}:${key}`);
  }
  assert.equal(loaded.rng, s.rng);
  assert.deepEqual(loaded.sides, s.sides);
  const u = snipers[0];
  assert.equal(
    E.orderGround(s, 1, [u.id], { x: u.x - 20, z: u.z, mode: 'move' }),
    'Нет прохода. Пассажиров сначала высадите из машины',
  );
  assert.ok(u.defenseMission, 'another owner cannot cancel this mission');
  assert.equal(E.orderGround(s, 0, [u.id], { x: u.x - 20, z: u.z, mode: 'move' }), 1);
  assert.equal(u.defenseMission, null);
  assert.equal(u.autoDefense, false);
  E.advance(s, 5);
  assert.equal(u.defenseMission, null);
  assert.equal(E.commandUnits(s, 0, [snipers[1].id], 'stop'), 1);
  assert.equal(snipers[1].defenseMission, null);
  assert.equal(snipers[1].autoDefense, false);
});

test('saved patrols reject forged ownership, clocks and contradictory orders while stripping extra fields', () => {
  const s = fresh();
  own(s, 0);
  const snipers = watchArmy(s, 0);
  E.advance(s, 3);
  const u = snipers.find((v) => v.defenseMission);
  assert.ok(u);
  const baseline = JSON.parse(E.save(s));
  const cases = [
    (v) => {
      v.defenseMission.kind = 'unknown';
    },
    (v) => {
      v.defenseMission.phase = 'teleport';
    },
    (v) => {
      v.defenseMission.sectorId = 'south';
    },
    (v) => {
      v.defenseMission.home.x = null;
    },
    (v) => {
      v.defenseMission.point.z = Infinity;
    },
    (v) => {
      v.defenseMission.startedAt = s.time + 1;
    },
    (v) => {
      v.defenseMission.until = v.defenseMission.startedAt + 181;
    },
    (v) => {
      v.defenseMission.nextThinkAt = s.time + 5;
    },
    (v) => {
      v.key = 'leopard';
    },
    (v) => {
      v.autoDefense = false;
    },
    (v) => {
      v.defensePost = null;
    },
    (v) => {
      v.defenseTask = {};
    },
    (v) => {
      v.defenseCapture = {};
    },
  ];
  for (const mutate of cases) {
    const raw = structuredClone(baseline);
    mutate(raw.groundUnits.find((v) => v.id === u.id));
    assert.throws(() => E.load(JSON.stringify(raw)), /задача обходной группы/, mutate.toString());
  }
  const extra = structuredClone(baseline);
  extra.groundUnits.find((v) => v.id === u.id).defenseMission.untrusted = { targetId: 999999 };
  const loaded = E.load(JSON.stringify(extra));
  assert.deepEqual(loaded.groundUnits.find((v) => v.id === u.id).defenseMission, u.defenseMission);
  const legacy = structuredClone(baseline);
  legacy.version = 19;
  const migrated = E.load(JSON.stringify(legacy));
  assert.ok(migrated.groundUnits.every((v) => v.defenseMission == null));
  assert.equal(migrated.sides[0].credits, s.sides[0].credits);
  assert.equal(migrated.sides[0].materials, s.sides[0].materials);
});

test('four city perspectives keep a cooperative patrol private even from its visible ally', () => {
  const s = fresh('coop');
  own(s, 0, 'north');
  own(s, 2, 'south');
  const snipers = [...watchArmy(s, 0), ...watchArmy(s, 2)];
  E.advance(s, 22);
  assert.equal(snipers.filter((u) => u.defenseMission).length, 4);
  for (const side of [0, 1, 2, 3]) {
    const view = playerView(s, side);
    for (const v of view.groundUnits) {
      const actual = s.groundUnits.find((u) => u.id === v.id);
      if (actual.side === side) assert.deepEqual(v.defenseMission, actual.defenseMission);
      else
        for (const field of [
          'defenseMission',
          'defensePost',
          'defenseTask',
          'guard',
          'path',
          'autoDefense',
        ])
          assert.equal(
            Object.hasOwn(v, field),
            false,
            `${side} sees private ${actual.side}:${field}`,
          );
    }
    for (const u of snipers.filter((u) => u.side === (side === 0 ? 2 : side === 2 ? 0 : -1))) {
      assert.ok(
        view.groundUnits.some((v) => v.id === u.id),
        'allied patrol is actually visible',
      );
    }
    for (const memory of view.frontlineMemory.slice(1))
      assert.deepEqual(memory, { nextThink: 0, seen: [] });
  }
});

function smallRounds(s) {
  return (
    s.sides[0].ammoStock.small +
    s.ammoVehicles.reduce(
      (sum, v) => sum + (v.cargo?.kind === 'ammo' && v.cargo.key === 'small' ? v.cargo.amount : 0),
      0,
    ) +
    s.ammoCrates.reduce((sum, c) => sum + c.stock.small, 0) +
    s.groundUnits.reduce((sum, u) => sum + u.groundAmmo + u.ammoReserve, 0)
  );
}
test('central depot hubs receive finite paid ammunition by real vans without duplicating it on save/load', () => {
  const s = fresh();
  own(s, 0);
  const before = s.sides[0].credits;
  const factory = E.build(s, 0, 'ammofactory', -1272, -80);
  assert.equal(factory.key, 'ammofactory');
  assert.ok(s.sides[0].credits < before);
  for (const line of corridorGeometry(s, 0))
    for (const slot of line.slots) {
      const u = post(s, 0, 'infantry', line.id, 2, slot.slot, true);
      u.groundAmmo = u.ammoReserve = 0;
    }
  let movingVan = false,
    supplied = false;
  const deliveredHubs = new Set(),
    suppliedFronts = new Set();
  for (let second = 0; second < 420; second++) {
    E.advance(s, 1);
    // Only small arms are demanded; each ordinary paid12-credit batch contains60 rounds.
    assert.ok(Math.abs(smallRounds(s) - (s.sides[0].ammoProductionSpent || 0) * 5) < 1e-6);
    movingVan ||= s.ammoVehicles.some(
      (v) => v.cargo?.kind === 'ammo' && v.fieldPoint && distance(v, v.fieldPoint) > 100,
    );
    supplied ||= s.groundUnits.some((u) => u.groundAmmo > 0);
    for (const line of corridorGeometry(s, 0)) {
      if (s.ammoCrates.some((c) => distance(c, line.depot) < 1)) deliveredHubs.add(line.id);
      if (s.groundUnits.some((u) => u.defensePost?.corridorId === line.id && u.groundAmmo > 0))
        suppliedFronts.add(line.id);
    }
  }
  assert.ok(movingVan && supplied);
  assert.ok(s.sides[0].ammoProductionSpent > 0);
  for (const line of corridorGeometry(s, 0)) {
    // Depleted, unreserved crates are legitimately retired by the next delivery.
    assert.ok(deliveredHubs.has(line.id), `${line.id}: actual delivery to the common depot hub`);
    assert.ok(suppliedFronts.has(line.id), `${line.id}: paid rounds reached its actual soldiers`);
  }
  const restored = E.load(E.save(s));
  assert.equal(smallRounds(restored), smallRounds(s));
  assert.deepEqual(restored.ammoCrates, s.ammoCrates);
  assert.deepEqual(restored.ammoVehicles, s.ammoVehicles);
  const u = s.groundUnits.find((v) => v.defensePost.corridorId === 'north');
  assert.ok(depotSupplyPoint(s, u));
  s.frontlineMemory[0].seen.push({ id: 999999, x: 0, z: -1360, time: s.time, strength: 3 });
  assert.equal(depotSupplyPoint(s, u), null, 'observed close danger prevents an unsafe rendezvous');
});

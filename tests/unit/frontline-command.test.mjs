import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { damageGround } from '../../src/game/units/ground/combat.js';
import { observedFrontline } from '../../src/game/defense/frontline.js';
import { updateArmyAI } from '../../src/game/ai/army-ai.js';

// The corridor sectors of the sea map (formerly the bridges at z = ±270).
const NORTH = E.FRONT_SECTORS.find((v) => v.id === 'north').z,
  SOUTH = E.FRONT_SECTORS.find((v) => v.id === 'south').z,
  // The neighbouring sector a reserve can be drawn from: the northern shore.
  SHORE = E.FRONT_SECTORS.find((v) => v.id === 'north-rear').z;
function fresh() {
  const s = E.createGame(862);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 1e5;
    f.materials = 1e4;
    f.rearAuto = false;
  }
  return s;
}
function unit(s, side, key, x, z, reserve = false) {
  const u = E.makeGround(s, side, key, x, z);
  u.holdFire = true;
  if (side === 0 || reserve) {
    u.guard = { x, z };
    u.order = { x, z, mode: 'guard' };
  }
  u.autoDefense = reserve;
  s.groundUnits.push(u);
  return u;
}
function battle(side = 0) {
  const s = fresh(),
    sign = side ? -1 : 1;
  const defenders = [],
    enemies = [];
  for (const z of [NORTH, SHORE])
    for (let i = 0; i < 6; i++) {
      const u = unit(s, side, i === 0 ? 'apc' : 'infantry', sign * (-450 + i * 11), z, true);
      defenders.push(u);
    }
  for (let i = 0; i < 6; i++)
    enemies.push(unit(s, 1 - side, 'leopard', sign * (-330 + i * 8), NORTH));
  return { s, defenders, enemies };
}

test('frontline is a dynamic evidence estimate, not the river, and districts change control without inventing enemy troops', () => {
  const s = fresh(),
    u = unit(s, 0, 'infantry', -400, 0);
  E.step(s, 0.05);
  const first = E.frontlineReport(s, 0).sectors.find((v) => v.id === 'center');
  assert.equal(first.knowledge, 'estimated');
  assert.equal(first.enemy, 0);
  assert.ok(first.x < -250);
  assert.equal(E.orderGround(s, 0, [u.id], { x: -250, z: 0 }), 1);
  E.advance(s, 8);
  const second = E.frontlineReport(s, 0).sectors.find((v) => v.id === 'center');
  assert.ok(second.x > first.x + 70);
  const raw = s.districts.find((d) => d.id === 'north-relay');
  raw.owner = 0;
  E.advance(s, 1.1);
  const north = E.frontlineReport(s, 0).sectors.find((v) => v.id === 'north');
  assert.equal(north.knowledge, 'estimated');
  assert.equal(north.enemy, 0);
  assert.ok(north.x > 100);
  assert.equal(E.frontlineReport(s, 0).polyline.length, 5);
});

test('hidden enemies cannot move the estimated line, create threat or trigger reserves', () => {
  const s = fresh();
  unit(s, 0, 'infantry', -600, NORTH, true);
  const hidden = unit(s, 1, 'leopard', 650, SOUTH);
  E.step(s, 0.05);
  assert.equal(s.frontlineMemory[0].seen.length, 0);
  const before = structuredClone(E.frontlineReport(s, 0));
  hidden.x = 700;
  hidden.z = -450;
  E.advance(s, 1.1);
  const after = E.frontlineReport(s, 0);
  assert.deepEqual(after.sectors, before.sectors);
  assert.ok(after.sectors.every((v) => v.enemy === 0 && v.threat === 0));
  assert.equal(after.counts.reinforcing, 0);
});

test('blurred hearing contacts estimate danger without revealing a hidden unit identity or exact position', () => {
  const s = fresh();
  s.contacts[0].push({ unitId: 123456, x: -220, z: NORTH, time: 0, expires: 7, radius: 45 });
  E.step(s, 0.05);
  const report = E.frontlineReport(s, 0),
    north = report.sectors.find((v) => v.id === 'north');
  assert.equal(north.contacts, 1);
  assert.equal(north.enemy, 0);
  assert.ok(north.threat > 0);
  assert.equal(north.knowledge, 'estimated');
  assert.ok(north.confidence < 0.5);
  assert.equal(JSON.stringify(report).includes('123456'), false);
  E.advance(s, 9);
  assert.ok(
    E.frontlineReport(s, 0).sectors.every((v) => v.contacts === 0 && v.knowledge === 'unknown'),
  );
});

test('observed casualties disappear from memory immediately; unseen movement stays at last seen coordinates and decays', () => {
  const s = fresh();
  unit(s, 0, 'infantry', -450, NORTH);
  const foe = unit(s, 1, 'leopard', -380, NORTH);
  E.step(s, 0.05);
  assert.ok(s.frontlineMemory[0].seen.some((v) => v.id === foe.id));
  damageGround(s, foe, 10000, undefined, 'blast');
  assert.equal(
    s.frontlineMemory[0].seen.some((v) => v.id === foe.id),
    false,
  );
  const next = unit(s, 1, 'leopard', -380, NORTH);
  E.advance(s, 1.1);
  const last = s.frontlineMemory[0].seen.find((v) => v.id === next.id);
  next.x = 650;
  next.z = 450;
  E.advance(s, 2);
  const remembered = s.frontlineMemory[0].seen.find((v) => v.id === next.id);
  assert.equal(remembered.x, last.x);
  assert.equal(remembered.z, last.z);
  const sector = E.frontlineReport(s, 0).sectors.find((v) => v.id === 'north');
  assert.equal(sector.knowledge, 'estimated');
  assert.ok(sector.confidence < 0.65);
  damageGround(s, next, 10000, undefined, 'blast');
  assert.ok(
    s.frontlineMemory[0].seen.some((v) => v.id === next.id),
    'an unseen casualty cannot reveal authority truth',
  );
  E.advance(s, 46);
  assert.equal(s.frontlineMemory[0].seen.length, 0);
});

test('a real breakthrough receives a bounded reserve that walks there and leaves the donor line manned', () => {
  const { s, defenders } = battle();
  const initial = new Map(defenders.map((u) => [u.id, { x: u.x, z: u.z }]));
  E.step(s, 0.05);
  let assigned = defenders.filter((u) => u.defenseTask);
  assert.ok(assigned.length > 0 && assigned.length <= E.FRONTLINE.maxNewAssignments);
  for (const u of assigned)
    assert.ok(
      Math.hypot(u.x - initial.get(u.id).x, u.z - initial.get(u.id).z) <=
        E.GROUND_UNITS[u.key].speed * 0.05 + 1e-6,
    );
  E.advance(s, 35);
  assigned = defenders.filter((u) => u.defenseTask);
  assert.equal(assigned.length, 3);
  assert.ok(
    assigned.every((u) => u.z < NORTH + 200 && Math.hypot(u.x - u.guard.x, u.z - u.guard.z) < 4),
  );
  assert.ok(defenders.filter((u) => !u.defenseTask && u.guard.z > NORTH + 200).length >= 3);
  const byTime = new Map();
  for (const event of s.events.filter((e) => e.type === 'defenseRedeployed'))
    byTime.set(event.time, (byTime.get(event.time) || 0) + 1);
  assert.ok([...byTime.values()].every((count) => count <= E.FRONTLINE.maxNewAssignments));
});

test('a quiet front returns the real reserve to its own reserved posts and applies cooldown', () => {
  const { s, defenders, enemies } = battle();
  E.advance(s, 35);
  const sent = defenders
    .filter((u) => u.defenseTask)
    .map((u) => ({ u, home: { ...u.defenseTask.home } }));
  for (const foe of enemies) damageGround(s, foe, 10000, undefined, 'blast');
  E.advance(s, 55);
  for (const { u, home } of sent) {
    assert.equal(u.defenseTask, null);
    assert.equal(u.autoDefense, true);
    assert.ok(Math.hypot(u.x - home.x, u.z - home.z) < 4);
    assert.ok(u.defenseReadyAt > 0);
  }
  assert.ok(s.events.some((e) => e.type === 'defenseReturned'));
});

test('successful manual commands override automatic tasks; failed commands and fire/camouflage do not', () => {
  for (const command of ['move', 'stop', 'dig', 'guard', 'line', 'retreat', 'board']) {
    const { s, defenders } = battle();
    E.step(s, 0.05);
    const u = defenders.find((u) => u.defenseTask && E.isInfantry(u.key));
    assert.ok(u);
    const before = structuredClone(u.defenseTask);
    assert.equal(typeof E.orderGround(s, 0, [u.id], { x: NaN, z: 0 }), 'string');
    assert.deepEqual(u.defenseTask, before);
    E.commandUnits(s, 0, [u.id], 'fire');
    E.commandUnits(s, 0, [u.id], 'camo');
    assert.deepEqual(u.defenseTask, before);
    let result;
    const p = { x: -500, z: 380 };
    if (command === 'move') result = E.orderGround(s, 0, [u.id], p);
    else if (command === 'guard') result = E.guardGround(s, 0, [u.id], p);
    else if (command === 'line') result = E.defendLineGround(s, 0, [u.id], p, p);
    else if (command === 'board') {
      const apc = unit(s, 0, 'apc', u.x - 30, u.z);
      result = E.boardGround(s, 0, [u.id], apc.id);
    } else result = E.commandUnits(s, 0, [u.id], command);
    assert.equal(typeof result, 'number', `${command}: ${result}`);
    assert.equal(u.autoDefense, false, command);
    assert.equal(u.defenseTask, null, command);
    const order = structuredClone(u.order);
    E.advance(s, 2);
    if (command === 'move') assert.deepEqual(u.order, order);
  }
});

test('only new automatic defend orders volunteer, pinned posts and legacy guards do not', () => {
  const s = fresh(),
    a = unit(s, 0, 'infantry', -450, -80),
    b = unit(s, 0, 'infantry', -450, 80);
  assert.equal(E.applyStance(s, 0, [a.id], { mode: 'defend', post: 'auto' }), 1);
  assert.equal(a.autoDefense, true);
  assert.equal(E.applyStance(s, 0, [b.id], { mode: 'defend', post: 'north' }), 1);
  assert.equal(b.autoDefense, false);
  assert.equal(E.setAutoDefense(s, 0, [b.id], true), 1);
  assert.equal(b.autoDefense, true);
  assert.equal(typeof E.setAutoDefense(s, 1, [b.id], true), 'string');
  const raw = JSON.parse(E.save(s));
  raw.version = 11;
  delete raw.frontlineMemory;
  assert.ok(E.load(JSON.stringify(raw)).groundUnits.every((u) => u.autoDefense === false));
});

test('a partially accepted standing order cannot rewrite the old post or consent of an unreachable selected unit', () => {
  const s = fresh(),
    a = unit(s, 0, 'infantry', -250, NORTH),
    b = unit(s, 0, 'infantry', 500, SOUTH);
  b.stance = { mode: 'defend', post: 'south' };
  // Wall off both land corridors, so the eastern soldier cannot reach a western post.
  for (const sign of [-1, 1])
    for (let z = E.SEA.halfZ - 60; z <= E.FIELD.z + 10; z += 20)
      s.buildings.push({
        id: s.nextId++,
        key: 'radar',
        side: 1,
        x: 0,
        z: sign * z,
        hp: 100,
        maxHp: 100,
        progress: 1,
      });
  s.networkRevision++;
  const previous = { guard: { ...b.guard }, stance: { ...b.stance } };
  assert.equal(E.applyStance(s, 0, [a.id, b.id], { mode: 'defend', post: 'north' }), 1);
  assert.deepEqual(b.guard, previous.guard);
  assert.deepEqual(b.stance, previous.stance);
  assert.equal(b.autoDefense, false);
});

test('both multiplayer owners and save/load run the same reserve journey, with pause and game-over freezing work', () => {
  for (const side of [0, 1]) {
    const { s } = battle(side);
    E.advance(s, 3);
    assert.ok(s.groundUnits.some((u) => u.side === side && u.defenseTask));
    const loaded = E.load(E.save(s));
    E.advance(s, 35);
    E.advance(loaded, 35);
    assert.deepEqual(loaded.groundUnits, s.groundUnits);
    assert.deepEqual(loaded.frontlineMemory, s.frontlineMemory);
    assert.deepEqual(loaded.trenches, s.trenches);
    assert.deepEqual(loaded.sides, s.sides);
    const before = E.save(s);
    E.step(s, 0);
    E.step(s, NaN);
    assert.equal(E.save(s), before);
    s.result = 'victory';
    const finished = E.save(s);
    E.advance(s, 5);
    assert.equal(E.save(s), finished);
  }
});

test('observation work is cadenced, memory is bounded, and repeated read queries do not mutate paid state', () => {
  const { s } = battle();
  E.step(s, 0.05);
  const before = E.save(s),
    report = E.frontlineReport(s, 0),
    time = s.frontlineMemory[0].seen[0].time;
  for (let i = 0; i < 100; i++) assert.equal(E.frontlineReport(s, 0), report);
  assert.equal(E.save(s), before);
  E.advance(s, 0.5);
  assert.equal(s.frontlineMemory[0].seen[0].time, time);
  const many = Array.from({ length: 300 }, (_, i) => ({
    id: 10000 + i,
    x: 500,
    z: 0,
    strength: 1,
    time: s.time,
  }));
  assert.ok(observedFrontline(s, 0, many).seen.length <= E.FRONTLINE.maxSeen);
});

test('paused commands and spawning invalidate counts immediately without a new simulation tick or enemy scan', () => {
  const s = fresh(),
    a = unit(s, 0, 'infantry', -450, 0);
  const first = E.frontlineReport(s, 0);
  assert.equal(first.counts.reserves, 0);
  assert.equal(E.setAutoDefense(s, 0, [a.id], true), 1);
  const selected = E.frontlineReport(s, 0);
  assert.notEqual(selected, first);
  assert.equal(selected.counts.reserves, 1);
  assert.equal(E.commandUnits(s, 0, [a.id], 'stop'), 1);
  assert.equal(E.frontlineReport(s, 0).counts.defenders, 0);
  const b = unit(s, 0, 'infantry', -500, 100, true);
  assert.equal(E.frontlineReport(s, 0).counts.reserves, 1);
  assert.equal(E.guardGround(s, 0, [b.id], { x: -450, z: 120 }), 1);
  assert.equal(E.frontlineReport(s, 0).counts.reserves, 0);
  assert.equal(s.time, 0);
  assert.deepEqual(s.frontlineMemory[0].seen, []);
  const stable = E.frontlineReport(s, 0);
  for (let i = 0; i < 100; i++) assert.equal(E.frontlineReport(s, 0), stable);
});

test('the solo bot only opts its existing defenders in and preserves production, income and an advancing attack reserve', () => {
  const s = fresh();
  delete s.mode;
  s.ai.nextArmy = 0;
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextResearch = 1e9;
  s.time = E.difficultyOf(s).armyFrom + 1;
  const troops = [];
  for (let i = 0; i < 8; i++)
    troops.push(unit(s, 1, i < 3 ? 'machinegunner' : 'infantry', 500 + i * 8, 80));
  const before = E.economy(s, 1).bonus;
  updateArmyAI(s, { random: E.random });
  const automatic = troops.filter((u) => u.autoDefense);
  assert.ok(automatic.length > 0 && automatic.length <= 3);
  assert.ok(automatic.every((u) => u.aiDefender && u.guard));
  const attackers = troops.filter((u) => u.order?.mode === 'attackmove');
  assert.ok(attackers.length >= 2);
  const x = attackers[0].x;
  E.advance(s, 2);
  assert.ok(attackers[0].x < x);
  assert.equal(E.economy(s, 1).bonus, before);
});

test('a critically injured bot defense volunteer actually retreats while pinned and non-detail guards keep their posts', () => {
  const s = fresh();
  delete s.mode;
  s.ai.nextArmy = 0;
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextResearch = 1e9;
  s.time = E.difficultyOf(s).armyFrom + 1;
  s.sides[1].credits = 0;
  const troops = [0, 1, 2].map((i) => unit(s, 1, 'machinegunner', 500 + i * 10, 80, true));
  for (const u of troops) u.hp = u.maxHp * 0.2;
  troops[0].aiDefender = troops[1].aiDefender = true;
  troops[2].aiDefender = false;
  troops[1].autoDefense = false;
  const pinnedPosts = troops.slice(1).map((u) => ({ ...u.guard }));
  updateArmyAI(s, { random: E.random });
  const retreating = troops[0],
    x = retreating.x;
  assert.equal(retreating.order.mode, 'retreat');
  assert.equal(retreating.autoDefense, false);
  assert.equal(retreating.guard, null);
  assert.ok(retreating.path.length > 0);
  assert.deepEqual(
    troops.slice(1).map((u) => u.guard),
    pinnedPosts,
  );
  E.advance(s, 2);
  assert.ok(retreating.x > x, 'the injured detail physically walks towards its own headquarters');
});

test('new persistence fields reject invalid types, unknown sectors, forged memory and excess fortification work', () => {
  const { s } = battle();
  E.step(s, 0.05);
  const raw = JSON.parse(E.save(s));
  for (const corrupt of [
    (v) => {
      v.groundUnits[0].autoDefense = 'true';
    },
    (v) => {
      v.groundUnits[0].defenseReadyAt = -1;
    },
    (v) => {
      v.groundUnits.find((u) => u.defenseTask).defenseTask.sectorId = 'constructor';
    },
    (v) => {
      v.groundUnits.find((u) => u.defenseTask).defenseTask.home.x = 10000;
    },
    (v) => {
      v.frontlineMemory[0].seen[0].strength = 1e9;
    },
    (v) => {
      v.frontlineMemory[0].seen[0].time = v.time + 1;
    },
    (v) => {
      v.frontlineMemory[0].seen[0].id = v.groundUnits[0].id;
    },
    (v) => {
      v.frontlineMemory[0].nextThink = 1e9;
    },
    (v) => {
      delete v.frontlineMemory;
    },
  ]) {
    const bad = structuredClone(raw);
    corrupt(bad);
    assert.throws(() => E.load(JSON.stringify(bad)));
  }
});

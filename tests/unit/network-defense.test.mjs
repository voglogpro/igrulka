import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { PROTOCOL_VERSION, executeCommand } from '../../src/network/commands.js';
import { playerView } from '../../src/network/perspective.js';

function fresh() {
  const s = E.createGame(863);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 10000;
    f.materials = 1000;
    f.rearAuto = false;
  }
  return s;
}
function unit(s, side, x, z) {
  const u = E.makeGround(s, side, 'infantry', x, z);
  u.holdFire = true;
  u.guard = { x, z };
  u.order = { x, z, mode: 'guard' };
  s.groundUnits.push(u);
  return u;
}

test('current protocol auto-defense validates either owner, complete ownership and boolean before mutating any selection', () => {
  assert.equal(PROTOCOL_VERSION, 16);
  const s = fresh(),
    troops = [unit(s, 0, -850, -270), unit(s, 1, 850, -270)];
  for (const side of [0, 1]) {
    const own = troops[side],
      enemy = troops[1 - side],
      before = E.save(s);
    for (const args of [
      { ids: [enemy.id], enabled: true },
      { ids: [own.id, enemy.id], enabled: true },
      { ids: [own.id, own.id], enabled: true },
      { ids: [], enabled: true },
      { ids: { 0: own.id, length: 1 }, enabled: true },
      { ids: [own.id], enabled: 'true' },
      { ids: [String(own.id)], enabled: true },
      { ids: [own.id], enabled: 1 },
      { ids: [own.id] },
      { ids: [NaN], enabled: false },
    ]) {
      assert.equal(typeof executeCommand(s, side, 'auto-defense', args), 'string');
      assert.equal(E.save(s), before);
    }
    assert.equal(
      executeCommand(s, side, 'auto-defense', { ids: [own.id], enabled: true, side: 1 - side }),
      1,
    );
    assert.equal(own.autoDefense, true);
    const projected = playerView(s, side);
    assert.equal(projected.groundUnits.find((u) => u.id === own.id).autoDefense, true);
    assert.equal(E.frontlineReport(projected, 0).counts.reserves, 1);
    assert.deepEqual(E.frontlineReport(projected, 0).polyline, E.frontlineReport(s, side).polyline);
    assert.equal(executeCommand(s, side, 'auto-defense', { ids: [own.id], enabled: false }), 1);
    assert.equal(own.autoDefense, false);
  }
});

test('either perspective retains its own observed memory, never the enemy memory or future unit plans', () => {
  const s = fresh(),
    troops = [unit(s, 0, -850, E.CORRIDORS[0]), unit(s, 1, -800, E.CORRIDORS[0])];
  unit(s, 0, 400, E.CORRIDORS[0]);
  unit(s, 1, 450, E.CORRIDORS[0]);
  for (const u of troops) {
    u.autoDefense = true;
    u.defenseReadyAt = 99;
    u.defenseTask = {
      sectorId: 'north',
      home: { x: u.x, z: u.z + 90 },
      assignedAt: 0,
      until: 20,
      returning: false,
    };
    u.futureDefenseSecret = { x: u.x, z: 888 };
  }
  E.step(s, 0.05);
  assert.ok(s.frontlineMemory.every((v) => v.seen.length > 0));
  s.frontlineMemory.forEach((memory, side) => {
    memory.nextReinforce = s.time + 2 + side;
  });
  for (const memory of s.frontlineMemory) {
    memory.privateDefensePlan = ['secret'];
    memory.seen[0].futurePlan = 'hidden';
  }
  s.frontlineReports = [{ enemySecret: 'not state' }, { enemySecret: 'not state' }];
  const before = structuredClone(s);
  for (const side of [0, 1]) {
    const view = playerView(s, side),
      own = view.groundUnits.find((u) => u.id === troops[side].id);
    const enemy = view.groundUnits.find((u) => u.id === troops[1 - side].id);
    assert.ok(enemy, 'visible enemy remains rendered');
    assert.deepEqual(own.defenseTask, troops[side].defenseTask);
    assert.equal(own.side, 0);
    assert.equal(enemy.side, 1);
    for (const key of [
      'autoDefense',
      'defenseTask',
      'defenseReadyAt',
      'guard',
      'futureDefenseSecret',
    ])
      assert.equal(Object.hasOwn(enemy, key), false, key);
    const memory = view.frontlineMemory[0];
    assert.equal(memory.nextReinforce, s.frontlineMemory[side].nextReinforce);
    assert.deepEqual(
      memory.seen,
      s.frontlineMemory[side].seen.map(({ id, x, z, strength, time }) => ({
        id,
        x,
        z,
        strength,
        time,
      })),
    );
    assert.deepEqual(view.frontlineMemory[1], { nextThink: 0, seen: [] });
    assert.equal(memory.privateDefensePlan, undefined);
    assert.equal(memory.seen[0].futurePlan, undefined);
    assert.equal(view.frontlineReports, undefined);
    assert.ok(E.frontlineReport(view, 0).sectors.some((v) => v.enemy > 0));
  }
  assert.deepEqual(s, before, 'projection is read-only');
});

test('far fortifications remain visible while enemy structures expose only physical appearance', () => {
  for (const side of [0, 1]) {
    const s = fresh(),
      sign = side ? -1 : 1;
    unit(s, side, sign * -450, -270);
    const make = (owner, x, z) => ({
      id: s.nextId++,
      side: owner,
      x,
      z,
      yaw: 0.2,
      progress: 1,
      fortificationWork: 90,
      futureUpgradeSecret: { materials: 999 },
    });
    const own = make(side, sign * -700, 450),
      visible = make(1 - side, sign * -400, -270),
      hidden = make(1 - side, sign * 650, 450);
    s.trenches.push(own, visible, hidden);
    const view = playerView(s, side);
    assert.ok(view.trenches.some((t) => t.id === own.id));
    assert.equal(
      view.trenches.some((t) => t.id === hidden.id),
      true,
    );
    const seen = view.trenches.find((t) => t.id === visible.id);
    assert.equal(seen.side, 1);
    assert.equal(seen.x, visible.x);
    assert.equal(seen.z, visible.z);
    assert.equal(E.fortificationStatus(seen).level, 3);
    assert.equal(seen.futureUpgradeSecret, undefined);
    assert.deepEqual(
      Object.keys(seen).sort(),
      ['id', 'side', 'x', 'z', 'yaw', 'progress', 'fortificationWork'].sort(),
    );
  }
});

test('enemy fortification and reserve events never disclose planning while own notifications survive side reversal', () => {
  const s = fresh();
  for (const side of [0, 1])
    for (const type of ['fortification', 'defenseRedeployed', 'defenseReturned'])
      s.events.push({
        id: s.nextId++,
        time: 0,
        side,
        type,
        x: side ? 450 : -450,
        z: -270,
        sectorId: 'north',
        level: 3,
        futurePlan: { x: 1150 },
      });
  for (const side of [0, 1]) {
    const view = playerView(s, side);
    assert.equal(view.events.length, 3);
    assert.ok(view.events.every((e) => e.side === 0));
    assert.deepEqual(
      view.events.map((e) => e.type).sort(),
      ['fortification', 'defenseRedeployed', 'defenseReturned'].sort(),
    );
  }
});

test('real server-side stepping upgrades the own fortification, and a gateway stop cancels auto without a deferred reassignment', () => {
  for (const side of [0, 1]) {
    const s = fresh();
    s.districts.find((d) => d.id === 'north-depot').owner = side;
    const point = E.frontlineReport(s, side).posts.find(
      (p) => p.corridorId === 'north' && p.slot === 2,
    );
    const u = unit(s, side, point.x, point.z);
    u.defensePost = { corridorId: 'north', slot: 2, row: 0 };
    assert.equal(executeCommand(s, side, 'auto-defense', { ids: [u.id], enabled: true }), 1);
    E.advance(s, 45);
    const view = playerView(s, side),
      own = view.groundUnits.find((v) => v.id === u.id);
    assert.equal(own.autoDefense, true);
    assert.equal(E.fortificationStatus(view.trenches.find((t) => t.id === own.trenchId)).level, 2);
    assert.equal(executeCommand(s, side, 'stance', { ids: [u.id], command: 'stop' }), 1);
    E.advance(s, 3);
    const stopped = playerView(s, side).groundUnits.find((v) => v.id === u.id);
    assert.equal(stopped.autoDefense, false);
    assert.equal(stopped.defenseTask, null);
    assert.equal(stopped.guard, null);
  }
});

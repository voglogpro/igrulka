import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { playerView } from '../../src/network/perspective.js';
import { executeCommand } from '../../src/network/commands.js';

function fresh() {
  const s = E.createGame(822);
  s.mode = 'multiplayer';
  return s;
}
function soldier(s, side, point = E.DISTRICTS[0], key = 'infantry') {
  const u = E.makeGround(s, side, key, point.x, point.z);
  u.holdFire = true;
  s.groundUnits.push(u);
  return u;
}
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
function owned(s, side = 0, index = 0) {
  Object.assign(s.districts[index], { owner: side, control: side ? -1 : 1 });
  return s.districts[index];
}

test('district sites are neutral, mirrored, accessible and give no initial free income', () => {
  const s = fresh();
  assert.equal(s.districts.length, 2);
  for (let i = 0; i < 2; i++) {
    const a = E.DISTRICTS[i],
      b = E.DISTRICTS[1 - i];
    near(a.x, -b.x);
    near(a.z, -b.z);
    assert.equal(a.type, b.type);
    assert.equal(E.walkable(s, a.x, a.z, 4), true);
    assert.equal(s.districts[i].owner, null);
  }
  assert.deepEqual(E.districtIncome(s, 0), {
    income: 0,
    materials: 0,
    science: 0,
    outputBonus: 0,
    owned: 0,
    active: 0,
  });
  assert.equal(E.economy(s, 0).net, E.economy(s, 1).net);
});

test('a real infantry capture takes time and creates exactly one ownership event and income', () => {
  const s = fresh(),
    d = s.districts[0];
  soldier(s, 0);
  E.advance(s, 10);
  assert.equal(d.owner, null);
  near(d.control, 10 / E.DISTRICT_RULES.captureSeconds);
  assert.equal(E.districtIncome(s, 0).materials, 0);
  E.advance(s, 12.1);
  assert.equal(d.owner, 0);
  assert.equal(d.control, 1);
  assert.equal(s.events.filter((e) => e.type === 'districtCaptured').length, 1);
  assert.equal(s.stats.districtsCaptured, 1);
  near(E.districtIncome(s, 0).materials, E.DISTRICTS[0].materials);
  const before = s.sides[0].materials;
  E.advance(s, 10);
  near(s.sides[0].materials - before, E.DISTRICTS[0].materials * 10);
  assert.equal(s.events.filter((e) => e.type === 'districtCaptured').length, 1);
});

test('vehicles and their passengers cannot capture but hostile armour blocks district output', () => {
  const s = fresh(),
    apc = soldier(s, 0, E.DISTRICTS[0], 'apc');
  const p = soldier(s, 0);
  p.carrierId = apc.id;
  E.advance(s, 24);
  assert.equal(s.districts[0].owner, null);
  assert.equal(s.districts[0].control, 0);
  owned(s, 1);
  E.advance(s, 1);
  assert.equal(s.districts[0].owner, 1);
  assert.equal(s.districts[0].control, -1);
  assert.equal(s.districts[0].blocked, true);
  assert.equal(E.districtIncome(s, 1).active, 0);
});

test('both sides contest and freeze progress regardless of the larger force', () => {
  const s = fresh();
  soldier(s, 0);
  E.advance(s, 5);
  const control = s.districts[0].control;
  soldier(s, 0, { x: E.DISTRICTS[0].x + 12, z: E.DISTRICTS[0].z });
  soldier(s, 1, { x: E.DISTRICTS[0].x - 12, z: E.DISTRICTS[0].z });
  E.advance(s, 8);
  assert.equal(s.districts[0].contested, true);
  assert.equal(s.districts[0].capturing, null);
  near(s.districts[0].control, control);
});

test('reinforcements accelerate capture with a bounded three-unit contribution', () => {
  const a = fresh(),
    b = fresh();
  for (let i = 0; i < 3; i++) soldier(a, 0);
  for (let i = 0; i < 5; i++) soldier(b, 0);
  E.advance(a, 10);
  E.advance(b, 10);
  near(a.districts[0].control, b.districts[0].control);
  assert.ok(a.districts[0].control > 10 / E.DISTRICT_RULES.captureSeconds);
  E.advance(a, 5);
  assert.equal(a.districts[0].owner, 0);
});

test('suppressed, retreating, dead or unfinished infantry cannot gain control', () => {
  for (const condition of ['suppressed', 'retreat', 'dead', 'unfinished']) {
    const s = fresh(),
      u = soldier(s, 0);
    if (condition === 'suppressed') u.suppression = 1.5;
    if (condition === 'retreat') u.order = { mode: 'retreat', x: u.x, z: u.z };
    if (condition === 'dead') u.hp = 0;
    if (condition === 'unfinished') u.progress = 0.5;
    E.advance(s, 3);
    assert.equal(s.districts[0].control, 0, condition);
  }
});

test('enemy infantry neutralizes before claiming, while former ownership cannot keep paying', () => {
  const s = fresh(),
    d = owned(s, 0);
  soldier(s, 1);
  E.advance(s, 1);
  assert.equal(d.owner, 0);
  assert.equal(d.blocked, true);
  assert.equal(E.districtIncome(s, 0).active, 0);
  E.advance(s, 11.2);
  assert.equal(d.owner, null);
  assert.ok(d.control <= 0);
  assert.equal(s.events.filter((e) => e.type === 'districtLost').length, 1);
  E.advance(s, 22.2);
  assert.equal(d.owner, 1);
  assert.equal(E.districtIncome(s, 1).active, 1);
});

test('abandoned partial neutral capture decays, while established ownership persists and recovers', () => {
  const s = fresh(),
    u = soldier(s, 0);
  E.advance(s, 5);
  u.x = -600;
  u.z = -300;
  E.advance(s, 10);
  near(s.districts[0].control, 0);
  const d = owned(s, 0);
  d.control = 0.2;
  E.advance(s, 25);
  assert.equal(d.owner, 0);
  near(d.control, 1);
});

test('capture orders send real units to separate nearby posts and eventually take the site', () => {
  const s = fresh(),
    a = soldier(s, 0, { x: -500, z: E.CORRIDORS[0] });
  const b = soldier(s, 0, { x: -510, z: E.CORRIDORS[0] - 20 });
  assert.equal(E.captureDistrict(s, 0, [a.id, b.id], E.DISTRICTS[0].id), 2);
  assert.notDeepEqual(a.guard, b.guard);
  assert.ok(a.path.length);
  assert.ok(
    Math.hypot(a.guard.x - E.DISTRICTS[0].x, a.guard.z - E.DISTRICTS[0].z) < E.DISTRICTS[0].radius,
  );
  E.advance(s, 100);
  assert.equal(s.districts[0].owner, 0);
  assert.equal(typeof E.captureDistrict(s, 0, [a.id], 'constructor'), 'string');
  const vehicle = soldier(s, 0, E.DISTRICTS[1], 'leopard');
  assert.match(E.captureDistrict(s, 0, [vehicle.id], E.DISTRICTS[1].id), /пехота/);
});

test('real blasts disable district infrastructure and destroy it only once', () => {
  const s = fresh(),
    d = owned(s);
  const point = E.DISTRICTS[0];
  E.applyBlast(s, point.x + 500, point.z, 10000, 20);
  assert.equal(d.hp, point.hp);
  E.applyBlast(s, point.x, point.z, 10000, 20);
  assert.equal(d.hp, 0);
  assert.equal(d.owner, 0);
  assert.equal(E.districtIncome(s, 0).active, 0);
  assert.equal(s.stats.districtsDestroyed, 1);
  E.applyBlast(s, point.x, point.z, 10000, 20);
  assert.equal(s.stats.districtsDestroyed, 1);
});

test('repair consumes real resources, pauses under enemy presence and stops at full health', () => {
  const s = fresh(),
    d = owned(s);
  d.hp = 0;
  const enemy = soldier(s, 1, E.DISTRICTS[0], 'leopard');
  assert.equal(E.setDistrictRepair(s, 0, d.id, true), true);
  E.advance(s, 1);
  assert.equal(d.hp, 0);
  enemy.x = 600;
  enemy.z = 300;
  s.sides[0].credits = 1000;
  s.sides[0].materials = 100;
  const before = { ...s.sides[0] };
  E.advance(s, 1);
  near(d.hp, E.DISTRICT_RULES.repairPerSecond);
  assert.ok(s.sides[0].credits < before.credits);
  assert.ok(s.sides[0].materials < before.materials);
  E.advance(s, 30);
  near(d.hp, E.DISTRICTS[0].hp);
  assert.equal(d.repairing, false);
  assert.match(E.setDistrictRepair(s, 1, d.id, true), /захватите/);
});

test('repair cannot overdraw an empty stockpile and destruction cancels it', () => {
  const s = fresh(),
    d = owned(s);
  d.hp = 10;
  d.repairing = true;
  s.sides[0].materials = 0;
  E.advance(s, 1);
  assert.ok(d.hp >= 10);
  assert.ok(Number.isFinite(s.sides[0].materials) && s.sides[0].materials >= 0);
  E.applyBlast(s, E.DISTRICTS[0].x, E.DISTRICTS[0].z, 10000, 10);
  assert.equal(d.repairing, false);
  assert.equal(d.hp, 0);
});

test('only solo AI receives the same 25 percent bonus on district revenues', () => {
  const s = fresh();
  owned(s, 0, 0);
  owned(s, 1, 1);
  near(E.economy(s, 0).districts.income, E.economy(s, 1).districts.income);
  delete s.mode;
  near(E.economy(s, 1).districts.materials, E.economy(s, 0).districts.materials * 1.25);
});

test('version eight imports neutral sites without altering troops, stockpiles or elapsed time', () => {
  const s = fresh();
  // A legacy river-map position within the unchanged town area, not a new sea corridor.
  soldier(s, 0, { x: -800, z: 200 });
  s.version = 8;
  delete s.districts;
  s.time = 97;
  const restored = E.load(E.save(s));
  assert.equal(restored.version, E.VERSION);
  assert.equal(restored.time, 97);
  assert.deepEqual(restored.sides, s.sides);
  assert.deepEqual(
    restored.groundUnits,
    s.groundUnits.map((u) => ({ ...u, x: u.x - 400 })),
  );
  assert.equal(restored.districts.length, 2);
  assert.ok(restored.districts.every((d) => d.owner == null));
});

test('current district state survives save/load, rejects corruption and retains an in-progress claim', () => {
  const s = fresh();
  soldier(s, 0);
  E.advance(s, 5);
  const restored = E.load(E.save(s));
  assert.deepEqual(restored.districts, s.districts);
  E.advance(restored, 18);
  assert.equal(restored.districts[0].owner, 0);
  for (const change of [
    (s) => {
      delete s.districts;
    },
    (s) => {
      s.districts[0].hp = -1;
    },
    (s) => {
      s.districts[0].control = 2;
    },
    (s) => {
      s.districts[0].id = '__proto__';
    },
    (s) => {
      s.districts[0].owner = 2;
    },
    (s) => {
      s.districts[0].contested = 'yes';
    },
    (s) => {
      s.districts[1].id = s.districts[0].id;
    },
  ]) {
    const broken = fresh();
    change(broken);
    assert.throws(() => E.load(E.save(broken)), /район/);
  }
});

test('imported district metadata cannot override configured income, shape, names or coordinates', () => {
  const s = fresh(),
    d = owned(s);
  Object.assign(d, {
    materials: -1000000,
    income: 1000000,
    science: -1000,
    x: 80000,
    radius: -1,
    name: 'bad',
    maxHp: 1,
  });
  const restored = E.load(E.save(s));
  assert.equal(restored.districts[0].income, undefined);
  const status = E.districtStatus(restored, d.id),
    config = E.DISTRICTS[0];
  for (const key of ['income', 'materials', 'science', 'x', 'radius', 'name'])
    assert.equal(status[key], config[key]);
  E.step(restored, 0.05);
  near(restored.sides[0].materials, 200 + config.materials * 0.05);
  near(restored.sides[0].credits, 3200 + (1.8 * (1 + config.outputBonus) + config.income) * 0.05);
  assert.doesNotThrow(() => E.load(E.save(restored)));
});

test('side one perspective flips control and ownership without changing the site or authority', () => {
  const s = fresh();
  const d = owned(s, 1);
  d.capturing = 0;
  d.control = -0.6;
  d.blocked = true;
  const view = playerView(s, 1);
  assert.equal(view.districts[0].id, d.id);
  assert.equal(view.districts[0].owner, 0);
  assert.equal(view.districts[0].capturing, 1);
  near(view.districts[0].control, 0.6);
  assert.equal(d.owner, 1);
  assert.equal(d.control, -0.6);
});

test('the command gateway binds district capture and repair to the real player side', () => {
  const s = fresh(),
    u = soldier(s, 1, { x: 900, z: 250 });
  assert.equal(executeCommand(s, 1, 'district', { ids: [u.id], id: 'south-depot' }), 1);
  assert.equal(
    typeof executeCommand(s, 0, 'district', { ids: [u.id], id: 'south-depot' }),
    'string',
  );
  assert.equal(
    typeof executeCommand(s, 1, 'district', { ids: [u.id], id: 'constructor' }),
    'string',
  );
  assert.match(
    executeCommand(s, 0, 'district-repair', { id: 'south-depot', enabled: true }),
    /захватите/,
  );
});

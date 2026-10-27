import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { corridorGeometry, defensePostPoint } from '../../src/game/defense/geometry.js';
import { updateFortification } from '../../src/game/defense/fortifications.js';
import { damageGround } from '../../src/game/units/ground/combat.js';
import { trenchLinks, invalidateTrenchLinks } from '../../src/game/defense/trench-links.js';
import { persistentDefensePoint } from '../../src/game/defense/positions.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fresh() {
  const s = E.createGame(8112);
  s.mode = 'multiplayer';
  s.rules.oil = false;
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 1e6;
    f.materials = 1e5;
  }
  // Keep territorial geometry fixed; neutral warehouse capture is covered by
  // defense-corridors, not this regression of persistent front positions.
  for (const d of s.districts) {
    d.owner = 0;
    d.control = 1;
  }
  return s;
}
function troop(s, key, x = -1100, z = -100, side = 0) {
  const u = E.makeGround(s, side, key, x, z);
  u.holdFire = true;
  s.groundUnits.push(u);
  return u;
}
function post(s, key, ref) {
  const p = defensePostPoint(corridorGeometry(s, 0), ref, 1);
  const u = troop(s, key, p.x, p.z);
  u.guard = { ...p };
  u.order = { ...p, mode: 'guard' };
  u.stance = { mode: 'defend', post: 'auto' };
  u.autoDefense = true;
  u.defensePost = { ...ref };
  return u;
}
function distribution(units) {
  return ['north', 'south'].map(
    (id) => units.filter((u) => u.defensePost?.corridorId === id).length,
  );
}

test('forty automatic machinegunners receive twenty posts on each front with bounded route waves', () => {
  const s = fresh();
  const units = Array.from({ length: 40 }, (_, i) =>
    troop(s, 'machinegunner', -1100 + (i % 10) * 7, -100),
  );
  assert.equal(
    E.applyStance(
      s,
      0,
      units.map((u) => u.id),
      { mode: 'defend', post: 'auto' },
    ),
    40,
  );
  assert.ok(
    units.every((u) => !u.guard && !u.path.length),
    'no temporary forty-unit north march',
  );
  assert.ok(E.load(E.save(s)).groundUnits.every((u) => u.autoDefense && !u.guard));
  let assigned = 0;
  for (let i = 0; i < 440; i++) {
    E.step(s, 0.05);
    const next = units.filter((u) => u.defensePost).length;
    assert.ok(next - assigned <= E.FRONTLINE.maxNewAssignments);
    assigned = next;
  }
  assert.deepEqual(distribution(units), [20, 20]);
  assert.equal(new Set(units.map((u) => `${u.guard.x}:${u.guard.z}`)).size, 40);
  assert.deepEqual(distribution(E.load(E.save(s)).groundUnits), [20, 20]);
});

test('ID-grouped platoons already at both fronts keep their local soldiers instead of exchanging corridors', () => {
  const s = fresh(),
    units = [],
    origins = new Map();
  for (const line of corridorGeometry(s, 0))
    for (let i = 0; i < 20; i++) {
      const u = troop(
        s,
        'machinegunner',
        line.x - 100 - (i % 4) * 10,
        line.z + (Math.floor(i / 4) - 2) * 14,
      );
      units.push(u);
      origins.set(u.id, line.id);
    }
  assert.equal(
    E.applyStance(
      s,
      0,
      units.map((u) => u.id),
      { mode: 'defend', post: 'auto' },
    ),
    40,
  );
  let assigned = 0;
  for (let i = 0; i < 440; i++) {
    E.step(s, 0.05);
    const count = units.filter((u) => u.defensePost).length;
    assert.ok(count - assigned <= E.FRONTLINE.maxNewAssignments);
    assigned = count;
    for (const u of units)
      if (u.defensePost) assert.equal(u.defensePost.corridorId, origins.get(u.id));
  }
  assert.deepEqual(distribution(units), [20, 20]);
  E.advance(s, 50);
  assert.equal(s.trenches.filter((t) => t.progress >= 1).length, 40);
});

test('mixed roles balance independently and existing all-north spare rows repair gradually', () => {
  const s = fresh();
  const keys = ['machinegunner', 'infantry', 'atrifle', 'leopard'];
  const units = keys.flatMap((key) => Array.from({ length: 8 }, () => troop(s, key)));
  E.applyStance(
    s,
    0,
    units.map((u) => u.id),
    { mode: 'defend', post: 'auto' },
  );
  E.advance(s, 18);
  for (const key of keys)
    assert.deepEqual(distribution(units.filter((u) => u.key === key)), [4, 4]);
  const old = fresh(),
    lines = corridorGeometry(old, 0);
  const legacy = Array.from({ length: 40 }, (_, i) =>
    post(old, 'machinegunner', {
      corridorId: 'north',
      row: 2 * Math.floor(i / lines[0].slots.length),
      slot: i % lines[0].slots.length,
    }),
  );
  const pinned = troop(old, 'infantry', -1000, -300);
  pinned.guard = { x: pinned.x, z: pinned.z };
  pinned.order = { ...pinned.guard, mode: 'guard' };
  const oldPinned = { ...pinned.guard };
  E.advance(old, 25);
  assert.deepEqual(distribution(legacy), [20, 20]);
  assert.deepEqual(pinned.guard, oldPinned);
  assert.equal(pinned.autoDefense, false);
});

test('a blocked preferred front falls back to the other reachable corridor and pending manual stop wins', () => {
  const s = fresh();
  // A continuous wall separates the entire northern strip from both banks.
  for (let x = -E.FIELD.x - 20; x <= E.FIELD.x + 20; x += 18)
    s.buildings.push({
      id: s.nextId++,
      side: 1,
      key: 'radar',
      x,
      z: -1080,
      hp: 100,
      maxHp: 100,
      progress: 1,
    });
  s.networkRevision++;
  const a = troop(s, 'machinegunner'),
    b = troop(s, 'machinegunner');
  const stopped = troop(s, 'machinegunner');
  assert.equal(E.applyStance(s, 0, [a.id, b.id, stopped.id], { mode: 'defend', post: 'auto' }), 3);
  assert.equal(E.commandUnits(s, 0, [stopped.id], 'stop'), 1);
  E.step(s, 0.05);
  assert.deepEqual([a.defensePost?.corridorId, b.defensePost?.corridorId], ['south', 'south']);
  assert.equal(stopped.autoDefense, false);
  assert.equal(stopped.guard, null);
  assert.equal(stopped.defensePost, null);
});

test('a casualty is replaced through the same persistent trenches without digging a duplicate line', () => {
  const s = fresh();
  const units = Array.from({ length: 20 }, () => troop(s, 'machinegunner'));
  E.applyStance(
    s,
    0,
    units.map((u) => u.id),
    { mode: 'defend', post: 'auto' },
  );
  E.advance(s, 230);
  const fallen = units.find(
    (u) => u.defensePost?.corridorId === 'north' && u.defensePost.row === 0,
  );
  assert.ok(fallen && !fallen.path.length);
  const trench = s.trenches.find((t) => t.id === fallen.trenchId);
  assert.ok(trench?.progress === 1);
  const old = { id: trench.id, work: trench.fortificationWork || 0, count: s.trenches.length };
  damageGround(s, fallen, 10000, undefined, 'blast');
  const replacement = troop(s, 'machinegunner');
  E.applyStance(s, 0, [replacement.id], { mode: 'defend', post: 'auto' });
  E.advance(s, 230);
  assert.equal(s.trenches.length, old.count);
  assert.ok(
    s.groundUnits.some((u) => u.hp > 0 && u.trenchId === old.id && distance(u, trench) < 4),
  );
  assert.ok(trench.fortificationWork >= old.work);
  assert.equal(
    E.load(E.save(s)).trenches.find((t) => t.id === old.id).fortificationWork,
    trench.fortificationWork,
  );
});

test('an empty enemy trench is captured with its work intact; an occupied trench cannot be duplicated', () => {
  const s = fresh(),
    u = troop(s, 'infantry', -1300, -300);
  u.guard = { x: u.x, z: u.z };
  u.order = { ...u.guard, mode: 'guard' };
  const t = { id: s.nextId++, side: 1, x: u.x, z: u.z, progress: 1, fortificationWork: 90 };
  s.trenches.push(t);
  const enemy = troop(s, 'infantry', u.x + 2, u.z, 1);
  updateFortification(s, u, 0.05);
  assert.equal(t.side, 1);
  assert.equal(s.trenches.length, 1);
  damageGround(s, enemy, 10000, undefined, 'blast');
  updateFortification(s, u, 0.05);
  assert.equal(t.side, 0);
  assert.equal(u.trenchId, t.id);
  assert.equal(t.fortificationWork, 90);
  assert.equal(t.progress, 1);
  assert.equal(s.trenches.length, 1);
  assert.ok(s.events.some((e) => e.type === 'trenchCaptured' && e.trenchId === t.id));
});

test('distant position planning uses observed memory rather than the actual location of concealed enemies', () => {
  const s = fresh();
  const u = troop(s, 'infantry', -1000, 0);
  const point = { x: -1650, z: 200 };
  const t = { id: s.nextId++, side: 1, x: point.x + 3, z: point.z, progress: 1 };
  s.trenches.push(t);
  const hidden = troop(s, 'infantry', t.x, t.z, 1);
  hidden.camouflaged = true;
  assert.equal(E.groundVisible(s, 0, hidden), false);
  assert.deepEqual(persistentDefensePoint(s, u, point), { x: t.x, z: t.z });
  s.frontlineMemory[0].seen.push({ id: hidden.id, x: t.x, z: t.z, time: s.time, strength: 1 });
  assert.deepEqual(persistentDefensePoint(s, u, point), point);
});

test('completed adjacent trenches form actual continuous cover, with bounded persistent links', () => {
  const s = fresh();
  const a = { id: s.nextId++, side: 0, x: -900, z: -220, progress: 1, fortificationWork: 30 };
  const b = { id: s.nextId++, side: 0, x: -900, z: -140, progress: 1, fortificationWork: 90 };
  s.trenches.push(a, b);
  const links = trenchLinks(s);
  assert.equal(links.length, 1);
  assert.equal(links[0].a, a);
  assert.equal(links[0].b, b);
  const point = { key: 'infantry', x: -900, z: -180 };
  assert.equal(E.coverInfo(s, point).cover, 0.78);
  s.time += 1;
  assert.equal(trenchLinks(s), links, 'unit movement/time does not rebuild static earthworks');
  b.side = 1;
  invalidateTrenchLinks(s);
  assert.equal(trenchLinks(s)[0].side, null);
  assert.equal(E.coverInfo(s, { ...point }).cover, 0.78);
  s.buildings.push({
    id: s.nextId++,
    side: 1,
    key: 'radar',
    x: -900,
    z: -180,
    hp: 100,
    maxHp: 100,
    progress: 1,
  });
  s.networkRevision++;
  assert.equal(trenchLinks(s).length, 0, 'the connecting ditch cannot pass through a building');
  const wet = fresh();
  wet.trenches.push({ ...a, x: 0, z: 0 }, { ...b, x: 0, z: 80 });
  assert.equal(trenchLinks(wet).length, 0, 'no earthworks across water');
});

function preparedBattle() {
  const s = fresh(),
    units = [];
  for (const row of [0, 2, 4])
    for (const line of corridorGeometry(s, 0))
      for (const slot of line.slots)
        units.push(post(s, 'infantry', { corridorId: line.id, slot: slot.slot, row }));
  return { s, units };
}

test('a quiet opposite front lends rear reserves, keeps its primary line, and troops physically return home', () => {
  const { s, units } = preparedBattle();
  for (const u of units)
    if (u.defensePost.corridorId === 'north' && u.defensePost.row > 0) u.suppression = 1;
  const primary = units
    .filter((u) => u.defensePost.row === 0)
    .map((u) => ({ u, guard: { ...u.guard } }));
  const target = corridorGeometry(s, 0)[0].slots[2];
  const enemies = Array.from({ length: 5 }, (_, i) =>
    troop(s, 'leopard', target.x + 65 + i * 8, target.z + i * 2, 1),
  );
  E.step(s, 0.05);
  const sent = units.find(
    (u) => u.defenseTask?.sectorId === 'north' && u.defensePost.corridorId === 'south',
  );
  assert.ok(sent, 'a quiet rear unit must be permitted to use a real cross-corridor path');
  assert.ok(sent.path.length > 0 && distance(sent, sent.guard) > 1000);
  assert.ok(E.load(E.save(s)).groundUnits.find((u) => u.id === sent.id).defenseTask);
  const home = { ...sent.defenseTask.home };
  E.advance(s, 4);
  for (const { u, guard } of primary) assert.deepEqual(u.guard, guard);
  for (const enemy of enemies) damageGround(s, enemy, 10000, undefined, 'blast');
  E.advance(s, 100);
  assert.equal(sent.defenseTask, null);
  assert.ok(distance(sent, home) <= 4);
  assert.deepEqual(sent.guard, home);
});

test('a newly observed rear breakthrough is not dropped behind the first 120 enemy IDs', () => {
  const { s } = preparedBattle();
  for (let i = 0; i < 130; i++) troop(s, 'leopard', 800 + i, -1360, 1);
  const intruder = troop(s, 'leopard', -1050, 0, 1);
  E.step(s, 0.05);
  assert.equal(s.frontlineMemory[0].seen.length, E.FRONTLINE.maxSeen);
  assert.ok(s.frontlineMemory[0].seen.some((v) => v.id === intruder.id));
  assert.ok(E.frontlineReport(s, 0).posts.some((p) => p.breakthrough > 0));
});

test('unposted automatic overflow remains a usable last-priority rear reserve and returns without a fake post', () => {
  const s = fresh();
  const posted = [];
  for (let row = 0; row < E.FRONTLINE.maxRows; row += 2)
    for (const line of corridorGeometry(s, 0))
      for (const slot of line.slots) {
        const u = post(s, 'infantry', { corridorId: line.id, slot: slot.slot, row });
        if (row > 0) u.suppression = 1;
        posted.push(u);
      }
  const overflow = Array.from({ length: 6 }, () => troop(s, 'infantry'));
  E.applyStance(
    s,
    0,
    overflow.map((u) => u.id),
    { mode: 'defend', post: 'auto' },
  );
  const slot = corridorGeometry(s, 0)[0].slots[2];
  const enemies = Array.from({ length: 5 }, (_, i) =>
    troop(s, 'leopard', slot.x + 65 + i * 8, slot.z, 1),
  );
  E.step(s, 0.05);
  const sent = overflow.find((u) => u.defenseTask);
  assert.ok(sent, 'full planned rows must not make the unposted reserve unusable');
  assert.equal(sent.defensePost, null);
  const home = { ...sent.defenseTask.home };
  assert.ok(Number.isFinite(home.x) && Number.isFinite(home.z));
  assert.equal(E.load(E.save(s)).groundUnits.find((u) => u.id === sent.id).defensePost, null);
  for (const enemy of enemies) damageGround(s, enemy, 10000, undefined, 'blast');
  E.advance(s, 100);
  assert.equal(sent.defenseTask, null);
  assert.ok(distance(sent, home) <= 4);
  assert.equal(sent.defensePost, null);
  assert.equal(posted.length, 120);
});

test('observed armour behind the firing line draws reserves to the breakthrough rather than the obsolete front', () => {
  const { s, units } = preparedBattle();
  const enemy = troop(s, 'leopard', -1050, 0, 1);
  E.step(s, 0.05);
  const report = E.frontlineReport(s, 0);
  assert.ok(report.posts.some((p) => p.breakthrough > 0 && p.threatPoint?.x === enemy.x));
  const sent = units.find((u) => u.defenseTask);
  assert.ok(sent);
  assert.ok(distance(sent.guard, enemy) < 140);
  const order = { x: sent.x - 40, z: sent.z, mode: 'move' };
  assert.equal(E.orderGround(s, 0, [sent.id], order), 1);
  assert.equal(sent.autoDefense, false);
  assert.equal(sent.defenseTask, null);
  const hidden = preparedBattle();
  const scout = troop(hidden.s, 'infantry', -1650, 0, 1);
  scout.camouflaged = true;
  hidden.s.trenches.push({ id: hidden.s.nextId++, side: 1, x: scout.x, z: scout.z, progress: 1 });
  assert.equal(E.groundVisible(hidden.s, 0, scout), false);
  E.step(hidden.s, 0.05);
  assert.ok(E.frontlineReport(hidden.s, 0).posts.every((p) => !p.breakthrough));
  assert.ok(hidden.units.every((u) => !u.defenseTask));
});

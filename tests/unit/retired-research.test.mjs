import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { TECH, weaponStats, defenseStats, canEngageAir } from '../../src/game/config.js';
import {
  research,
  researchProjects,
  researchStatus,
  updateResearch,
} from '../../src/game/research/research.js';
import { restoreRetiredResearch } from '../../src/game/persistence/retired-research.js';
import { restoreEconomy } from '../../src/game/persistence/economy.js';
import { addRoad } from '../../src/game/city/roads.js';
import { purchaseFactor } from '../../src/game/city/pricing.js';
import { produce } from '../../src/game/units/aviation/production.js';
import { launch } from '../../src/game/units/aviation/launch.js';
import { fireDefenses } from '../../src/game/combat/air-defense.js';
import { damageGround } from '../../src/game/units/ground/combat.js';
import { ai } from '../../src/game/ai/city-ai.js';
import { updateArmyAI } from '../../src/game/ai/army-ai.js';

function fresh() {
  const s = E.createGame(132);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  s.rules.oil = false;
  for (const f of s.sides)
    Object.assign(f, {
      credits: 100000,
      materials: 10000,
      science: 0,
      tech: [],
      research: null,
      researchQueue: [],
      purchases: { building: {} },
    });
  return s;
}
function building(s, key, side = 0, dx = 80, z = -10) {
  const hq = s.buildings.find((b) => b.side === side && b.key === 'hq');
  const b = {
    id: s.nextId++,
    side,
    key,
    x: hq.x + dx,
    z,
    hp: E.BUILDINGS[key].hp,
    maxHp: E.BUILDINGS[key].hp,
    progress: 1,
    queue: [],
    armyQueue: [],
  };
  s.buildings.push(b);
  addRoad(s, side, hq.x, 0, b.x, b.z, { camp: true });
  return b;
}

test('retired research commands cannot charge, advance, unlock or emit completion events', () => {
  const s = fresh(),
    f = s.sides[0];
  f.research = { key: 'heavy', progress: 0.9 };
  const before = structuredClone(f);
  assert.equal(typeof research(s, 0, 'heavy'), 'string');
  updateResearch(s, 0, { productivity: 1 }, 1000);
  assert.deepEqual(f, before);
  assert.deepEqual(researchProjects(s, 0), []);
  assert.deepEqual(researchStatus(s, 0), { slots: 0, projects: [], activeCount: 0 });
  assert.equal(
    s.events.some((event) => event.type === 'research'),
    false,
  );
});

test('all weapons and noncivil ground types are available at ordinary prices without granting tech buffs', () => {
  const s = fresh();
  const b = building(s, 'barracks'),
    v = building(s, 'vehiclebase', 0, -80);
  building(s, 'factory', 0, 160);
  for (const [key, d] of Object.entries(E.GROUND_UNITS)) {
    if (d.civil) continue;
    const site = d.infantry ? b : v,
      before = s.sides[0].credits;
    assert.equal(E.recruit(s, 0, key, site.id), true, key);
    assert.equal(before - s.sides[0].credits, d.cost);
    site.armyQueue = [];
    assert.equal(E.makeGround(s, 0, key, -900, 300).maxHp, d.hp);
  }
  for (const [key, d] of Object.entries(E.WEAPONS)) {
    const before = s.sides[0].credits;
    assert.equal(produce(s, 0, key), true, key);
    assert.equal(before - s.sides[0].credits, d.cost);
  }
  assert.deepEqual(s.sides[0].tech, []);
});

test('legacy technology lists have no economic, weapon, magazine, armour or accuracy modifiers', () => {
  const s = fresh(),
    baseline = structuredClone(s);
  for (const f of s.sides) f.tech = Object.keys(TECH);
  for (const key of Object.keys(E.WEAPONS))
    assert.deepEqual(weaponStats(s.sides[0], key), weaponStats(baseline.sides[0], key));
  for (const key of ['infantry', 'mog', 'shilka', 'sam']) {
    const b = { key, level: 1, xp: 180 };
    assert.deepEqual(defenseStats(s.sides[0], b), defenseStats(baseline.sides[0], b));
  }
  assert.deepEqual(E.economy(s, 0), E.economy(baseline, 0));
  const a = E.makeGround(s, 0, 'infantry', -900, 300),
    b = E.makeGround(baseline, 0, 'infantry', -900, 300);
  damageGround(s, a, 10);
  damageGround(baseline, b, 10);
  assert.equal(a.hp, b.hp);
  assert.equal(
    defenseStats(s.sides[0], { key: 'sam', level: 1 }).damage,
    E.BUILDINGS.sam.damage,
    'all installations use the same base characteristics',
  );
});

test('drones launch from a completed base and missiles use their stocked silo without research', () => {
  const s = fresh(),
    factory = building(s, 'factory'),
    silo = building(s, 'silo', 0, 200);
  for (const key of Object.keys(E.WEAPONS)) {
    const source = ['drone', 'heavy'].includes(key) ? factory : silo;
    s.sides[0].inventory[key] = 1;
    E.initLaunchStore(source);
    s.sides[0].inventory[key] -= E.acceptLaunchDelivery(source, key, 1);
    assert.equal(launch(s, 0, key, { x: 900, z: 1360 }), 1);
    assert.equal(s.units.at(-1).sourceId, source.id);
    assert.equal(s.units.at(-1).maxHp, E.WEAPONS[key].hp);
    assert.equal(s.sides[0].inventory[key], 0);
  }
});

test('SAM acquires an observed ballistic missile and fires a base-damage interceptor without research', () => {
  const s = fresh(),
    sam = building(s, 'sam');
  s.units.push({
    id: s.nextId++,
    side: 1,
    key: 'ballistic',
    hp: 200,
    maxHp: 200,
    x: sam.x + 80,
    z: sam.z,
    y: 60,
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 100,
    total: 1000,
    travelled: 200,
    launched: true,
    delay: 0,
  });
  assert.equal(canEngageAir('sam', 'ballistic'), true);
  assert.equal(canEngageAir('shilka', 'ballistic'), false);
  for (let i = 0; i < 200 && !s.projectiles.length; i++) {
    s.time += 0.05;
    fireDefenses(s, [E.economy(s, 0), E.economy(s, 1)], 0.05);
  }
  const p = s.projectiles.find((p) => p.kind === 'interceptor');
  assert.ok(p, 'real battery emits an interceptor');
  assert.equal(p.targetId, s.units[0].id);
  assert.equal(p.damage, E.BUILDINGS.sam.damage);
});

test('v14 retirement refunds only paid projects and live labs at historical prices once, preserving other city objects', () => {
  const s = fresh(),
    f = s.sides[0];
  f.research = { key: 'heavy', progress: 0.6 };
  f.researchQueue = [{ key: 'autocannon', progress: 0.3 }];
  const labs = [building(s, 'lab'), building(s, 'lab', 0, -80), building(s, 'lab', 0, 160)];
  labs[1].progress = 0.3;
  labs[2].hp = 0;
  f.purchases.building.lab = 3;
  const other = building(s, 'housing', 0, -160);
  const main = addRoad(s, 0, other.x, other.z + 20, other.x + 100, other.z + 20);
  const otherCopy = structuredClone(other),
    roadCopy = structuredClone(main);
  const before = { credits: f.credits, materials: f.materials };
  restoreEconomy(s, 14);
  restoreRetiredResearch(s, 14);
  assert.equal(
    f.credits - before.credits,
    TECH.heavy.cost +
      TECH.autocannon.cost +
      Math.round(E.BUILDINGS.lab.cost * purchaseFactor(0)) +
      Math.round(E.BUILDINGS.lab.cost * purchaseFactor(1)),
  );
  assert.equal(
    f.materials - before.materials,
    Math.round(E.BUILDINGS.lab.metal * purchaseFactor(0)) +
      Math.round(E.BUILDINGS.lab.metal * purchaseFactor(1)),
  );
  assert.ok(labs.slice(0, 2).every((b) => b.demolished && b.hp === 0));
  assert.equal(
    labs[2].demolished,
    undefined,
    'destroyed lab is not compensated or silently deleted',
  );
  assert.deepEqual(other, otherCopy);
  assert.deepEqual(main, roadCopy);
  const settled = { credits: f.credits, materials: f.materials };
  restoreRetiredResearch(s, 15);
  assert.deepEqual({ credits: f.credits, materials: f.materials }, settled);
  assert.deepEqual(f.tech, []);
  assert.equal(f.science, 0);
});

test('pre-price-history labs receive original base price and baked tech HP keeps the health fraction', () => {
  const s = fresh(),
    f = s.sides[0],
    lab = building(s, 'lab');
  f.tech = ['composite', 'airframes', 'propulsion', 'payload'];
  const unit = E.makeGround(s, 0, 'leopard', -900, 300);
  unit.maxHp = Math.round(E.GROUND_UNITS.leopard.hp * 1.25);
  unit.hp = unit.maxHp * 0.4;
  unit.xp = 180;
  s.groundUnits.push(unit);
  const d = E.WEAPONS.heavy;
  s.units.push({
    side: 0,
    key: 'heavy',
    maxHp: d.hp * 1.3,
    hp: d.hp * 1.3 * 0.5,
    speed: d.speed * 1.2,
    damage: d.damage * 1.2,
  });
  const before = f.credits;
  restoreRetiredResearch(s, 13);
  assert.equal(f.credits - before, E.BUILDINGS.lab.cost);
  assert.equal(lab.demolished, true);
  assert.equal(unit.maxHp, E.GROUND_UNITS.leopard.hp);
  assert.ok(Math.abs(unit.hp - unit.maxHp * 0.4) < 1e-8);
  assert.equal(unit.xp, 180);
  assert.equal(s.units[0].hp, d.hp * 0.5);
  assert.equal(s.units[0].maxHp, d.hp);
  assert.equal(s.units[0].speed, d.speed);
  assert.equal(s.units[0].damage, d.damage);
});

test('new labs cannot be built; current saves cannot import active research or live retired labs', () => {
  const s = fresh();
  const before = s.sides[0].credits;
  assert.equal(typeof E.build(s, 0, 'lab', -900, -10), 'string');
  assert.equal(s.sides[0].credits, before);
  building(s, 'lab');
  assert.throws(() => restoreRetiredResearch(s, 15));
  for (const b of s.buildings)
    if (b.key === 'lab') {
      b.hp = 0;
      b.demolished = true;
    }
  s.sides[0].research = { key: 'heavy', progress: 0.1 };
  assert.throws(() => restoreRetiredResearch(s, 15));
});

test('legacy enlarged magazines and active AA damage lose their research bonus without refilling rounds', () => {
  const s = fresh(),
    f = s.sides[0],
    sam = building(s, 'sam');
  f.tech = ['magazines', 'abm'];
  sam.ammo = 6;
  sam.reloadLeft = 3;
  const soldier = E.makeGround(s, 0, 'infantry', -900, 300);
  soldier.groundAmmo = 45;
  soldier.groundReload = 1.5;
  s.groundUnits.push(soldier);
  s.projectiles.push({
    sourceId: sam.id,
    side: 0,
    kind: 'interceptor',
    abm: true,
    damage: E.BUILDINGS.sam.damage * 1.15,
  });
  restoreRetiredResearch(s, 14);
  assert.equal(sam.ammo, E.BUILDINGS.sam.magazine);
  assert.equal(sam.reloadLeft, 4);
  assert.equal(soldier.groundAmmo, E.GROUND_UNITS.infantry.groundMagazine);
  assert.equal(soldier.groundReload, 2);
  assert.equal(s.projectiles[0].damage, E.BUILDINGS.sam.damage);
});

test('legacy paid levels and earned experience survive research retirement without cash refunds', () => {
  const s = fresh(),
    f = s.sides[0],
    sam = building(s, 'sam');
  sam.level = 2;
  const u = E.makeGround(s, 0, 'shilka', -900, 300);
  u.level = 1;
  u.xp = 180;
  s.groundUnits.push(u);
  const ruin = building(s, 'gun', 0, -80);
  ruin.hp = 0;
  ruin.level = 2;
  const before = { credits: f.credits, materials: f.materials };
  restoreRetiredResearch(s, 14);
  assert.equal(f.credits, before.credits);
  assert.equal(f.materials, before.materials);
  assert.equal(u.level, 1);
  assert.equal(sam.level, 2);
  assert.equal(ruin.level, 2);
  assert.equal(u.xp, 180);
  const settled = f.credits;
  restoreRetiredResearch(s, 15);
  assert.equal(f.credits, settled);
  assert.equal(typeof E.upgradeDefense(s, 0, sam.id), 'string');
  assert.equal(f.credits, settled);
  u.level = 3;
  assert.throws(() => restoreRetiredResearch(s, 15));
});

test('city AI never builds labs or buys research and production reserves ordinary building prices', () => {
  const s = fresh();
  s.mode = 'singleplayer';
  s.time = 1000;
  s.ai.nextAttack = Infinity;
  s.ai.nextBuild = Infinity;
  building(s, 'factory', 1);
  ai(s);
  assert.deepEqual(s.sides[1].tech, []);
  assert.equal(s.sides[1].research, null);
  assert.equal(
    s.buildings.some((b) => b.key === 'lab'),
    false,
  );
  assert.equal(s.buildings.find((b) => b.side === 1 && b.key === 'factory').queue.length, 1);
  const barracks = building(s, 'barracks', 1, -80);
  for (let i = 0; i < 4; i++) {
    s.time = (s.ai.nextArmy || s.time) + 1;
    updateArmyAI(s, { random: () => 0.99 });
  }
  assert.ok(barracks.armyQueue.every((q) => E.GROUND_UNITS[q.key].infantry));
});

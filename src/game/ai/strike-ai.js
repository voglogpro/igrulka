import { WEAPONS, GROUND_UNITS, SEA, CORRIDORS, weaponFamily, isMissile } from '../config.js';
import { hostile, hqOf, pairedEnemy, frontIds, frontDirection } from '../factions.js';
import { random } from '../shared/random.js';
import { produce } from '../units/aviation/production.js';
import { launch, launchStatus } from '../units/aviation/launch.js';
import { weaponStock } from '../units/aviation/launch-supply.js';
import { knownTargets } from '../visibility.js';
import { componentCost, hasComponents } from '../city/electronics.js';
import { hasOil } from '../city/oil.js';
import { passable } from '../city/road-network.js';
import { groundVisible } from '../units/infantry/cover.js';
import { staticObjectsInBounds } from '../shared/static-spatial.js';
import { aiState } from './state.js';

// The bot's air campaign follows its budget and the enemy's defences, never its difficulty:
// difficulty only changes resource income. Prices, production and launches are the ordinary
// paid rules; the bot only decides what to buy, when to fire and at what.
export const STRIKE = Object.freeze({
  cadence: 8,
  baseStock: 4,
  maxStock: 24,
  // One more craft in the target stock for every this many spare credits.
  creditsPerCraft: 700,
  queuePerFactory: 3,
  // Drones cover an active assault against targets this far ahead of the leading soldiers,
  // and never aim closer than this to their own troops.
  coverRange: 420,
  safeDistance: 70,
  coverDrones: 3,
  salvoMin: 2,
  salvoMax: 6,
});

const VALUE = {
  hq: 4,
  power: 3,
  factory: 3,
  launcher: 3,
  silo: 3,
  radar: 3,
  sam: 3,
  ammofactory: 2,
};

function enemyDefences(s, side) {
  let sam = 0,
    gun = 0;
  for (const b of s.buildings)
    if (hostile(s, b.side, side) && b.hp > 0 && !b.demolished && b.progress >= 1) {
      if (b.key === 'sam') sam++;
      else if (b.key === 'gun') gun++;
    }
  return { sam, gun };
}

const totalStock = (s, side) =>
  Object.keys(WEAPONS).reduce((n, key) => n + weaponStock(s, side, key), 0);

// Spare money above the infrastructure and army reserves sets the size of the arsenal.
export function strikeStockTarget(s, side, reserve) {
  const spare = Math.max(0, s.sides[side].credits - reserve);
  return Math.min(STRIKE.maxStock, STRIKE.baseStock + Math.floor(spare / STRIKE.creditsPerCraft));
}

// A mix against the defences actually standing: cheap drones saturate missile batteries,
// ballistic missiles open them, cruise missiles and heavy drones hit undefended economy.
function weaponWeights(s, side) {
  const { sam, gun } = enemyDefences(s, side);
  return {
    drone: 3 + sam * 2 + gun * 0.5,
    heavy: 2,
    cruise: sam ? 1 : 3,
    // Low-signature missiles slip under standing batteries.
    stealth: sam ? 1 + sam * 0.5 : 0.5,
    ballistic: weaponStock(s, side, 'ballistic') >= 2 ? 0 : sam ? 1 + sam : 0.5,
    tactical: weaponStock(s, side, 'tactical') >= 2 ? 0 : sam ? 1 : 0.7,
    // Cluster warheads answer dug-in troops.
    cluster:
      weaponStock(s, side, 'cluster') >= 2
        ? 0
        : s.trenches.some((t) => hostile(s, side, t.side) && t.progress >= 1)
          ? 1.2
          : 0.2,
  };
}

export function updateStrikeProduction(s, side, reserve) {
  const f = s.sides[side],
    factories = s.buildings.filter(
      (b) => b.side === side && b.key === 'factory' && b.hp > 0 && b.progress >= 1,
    );
  if (!factories.length) return null;
  const queued = factories.reduce((n, b) => n + (b.queue?.length || 0), 0);
  if (queued >= factories.length * STRIKE.queuePerFactory) return null;
  if (totalStock(s, side) + queued >= strikeStockTarget(s, side, reserve)) return null;
  const affordable = (key) =>
    f.credits >= reserve + WEAPONS[key].cost &&
    f.materials >= WEAPONS[key].metal &&
    hasOil(s, side, WEAPONS[key].oil) &&
    hasComponents(s, side, componentCost(s, WEAPONS[key]));
  const weights = Object.entries(weaponWeights(s, side)).filter(
    ([key, weight]) => weight > 0 && affordable(key),
  );
  if (!weights.length) return null;
  let roll = random(s) * weights.reduce((n, [, weight]) => n + weight, 0);
  let key = weights.at(-1)[0];
  for (const [candidate, weight] of weights) {
    if ((roll -= weight) < 0) {
      key = candidate;
      break;
    }
  }
  return produce(s, side, key) === true ? key : null;
}

function ownTroops(s, side) {
  return s.groundUnits.filter((u) => u.side === side && u.hp > 0 && !u.carrierId);
}

// Drone cover for an active assault: the densest observed enemy group or a public enemy trench
// ahead of the leading soldiers, safely clear of the bot's own troops.
export function assaultCoverTarget(s, side) {
  const assault = s.groundUnits.filter(
    (u) => u.side === side && u.hp > 0 && u.defenseAttack?.phase === 'active',
  );
  if (!assault.length) return null;
  const direction = frontDirection(s, side),
    own = ownTroops(s, side),
    candidates = [];
  const lead = assault.reduce((best, u) => (u.x * direction > best.x * direction ? u : best));
  const ahead = (p) => (p.x - lead.x) * direction > -40;
  const near = (p) => assault.some((u) => Math.hypot(u.x - p.x, u.z - p.z) <= STRIKE.coverRange);
  const safe = (p) => own.every((u) => Math.hypot(u.x - p.x, u.z - p.z) >= STRIKE.safeDistance);
  const enemies = s.groundUnits.filter(
    (u) => hostile(s, side, u.side) && u.hp > 0 && !u.carrierId && groundVisible(s, side, u),
  );
  for (const e of enemies) {
    if (!ahead(e) || !near(e) || !safe(e)) continue;
    let weight = 0;
    for (const other of enemies)
      if (Math.hypot(other.x - e.x, other.z - e.z) <= 25)
        weight += GROUND_UNITS[other.key]?.groundArmor ? 2 : 1;
    candidates.push({ x: e.x, z: e.z, weight });
  }
  const r = STRIKE.coverRange;
  for (const t of staticObjectsInBounds(
    s,
    'trenches',
    lead.x - r,
    lead.z - r,
    lead.x + r,
    lead.z + r,
  ))
    if (hostile(s, side, t.side) && t.progress > 0 && ahead(t) && near(t) && safe(t))
      candidates.push({ x: t.x, z: t.z, weight: 0.5 });
  candidates.sort((a, b) => b.weight - a.weight || a.x - b.x || a.z - b.z);
  return candidates[0] || null;
}

function strategicTarget(s, side, key, defences) {
  const hq = hqOf(s, side),
    enemies = knownTargets(s, side),
    local = enemies.filter((b) => b.side === pairedEnemy(s, side)),
    front = local.length ? local : enemies;
  // Missiles open the enemy air defence first; drones then keep hitting the economy behind it.
  if (defences.sam && isMissile(key) && key !== 'cluster') {
    const sams = front.filter((b) => b.key === 'sam' || b.key === 'radar');
    if (sams.length) return sams[Math.floor(random(s) * sams.length)];
  }
  let targets = front.filter((b) => b.key !== 'road');
  if (random(s) < 0.2) {
    const roads = front.filter((r) => r.key === 'road' && passable(r));
    if (roads.length) targets = roads;
  }
  const weighted = targets.flatMap((b) => Array(VALUE[b.key] || 1).fill(b));
  return (
    weighted[Math.floor(random(s) * weighted.length)] ||
    hqOf(s, pairedEnemy(s, side)) ||
    (hq ? { x: -hq.x, z: hq.z } : null)
  );
}

function aimAt(s, side, key, target) {
  const hq = hqOf(s, side);
  const flank = weaponFamily(key) !== 'ballistic' && random(s) < 0.45;
  if (!flank || !hq) return target.id ?? { x: target.x, z: target.z };
  const fronts = frontIds(s, side),
    id = fronts.length === 1 ? fronts[0] : random(s) < 0.5 ? 'north' : 'south',
    z = CORRIDORS[id === 'north' ? 0 : 1];
  return {
    x: target.x,
    z: target.z,
    waypoints: [
      { x: SEA.halfX + 90, z },
      { x: -SEA.halfX - 90, z },
    ],
  };
}

// Fixed-cadence decisions: cover an active assault with drones, otherwise hold the stock until a
// salvo large enough to saturate the defences is ready and launch it together.
export function updateStrikes(s, side, reserve) {
  const memory = aiState(s, side);
  if (s.time < memory.nextStrike) return 0;
  memory.nextStrike = s.time + STRIKE.cadence;
  let launched = 0;
  const cover = assaultCoverTarget(s, side);
  if (cover && !launchStatus(s, side, 'drone', cover)) {
    const n = launch(s, side, 'drone', { x: cover.x, z: cover.z }, STRIKE.coverDrones);
    if (typeof n === 'number') launched += n;
  }
  const defences = enemyDefences(s, side),
    salvo = Math.min(STRIKE.salvoMax, Math.max(STRIKE.salvoMin, 2 + defences.sam)),
    stock = totalStock(s, side);
  if (stock < salvo && stock < strikeStockTarget(s, side, reserve)) return launched;
  for (const key of ['ballistic', 'tactical', 'stealth', 'cruise', 'heavy', 'drone']) {
    const target = strategicTarget(s, side, key, defences);
    if (!target) break;
    const aim = aimAt(s, side, key, target);
    if (launchStatus(s, side, key, aim)) continue;
    const n = launch(s, side, key, aim, STRIKE.salvoMax);
    if (typeof n === 'number') launched += n;
  }
  return launched;
}

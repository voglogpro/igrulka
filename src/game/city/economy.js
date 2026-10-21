import { ROAD_REQUIRED } from './rules.js';
import { buildingConnected } from './road-network.js';
import { BUILDINGS, GROUND_UNITS } from '../config.js';
export function supplyFactor(s, b) {
  return ROAD_REQUIRED.has(b.key) && !buildingConnected(s, b, BUILDINGS[b.key].size) ? 0.2 : 1;
}

export function economy(s, owner) {
  const faction = s.sides[owner],
    alive = s.buildings.filter((b) => b.side === owner && b.hp > 0 && b.progress >= 1);
  let power = 10,
    demand = 0,
    upkeep = 0,
    income = 1.8,
    materials = 0,
    science = 0,
    connected = 0,
    isolated = 0;
  const efficient = faction.tech.includes('efficiency') ? 1.2 : 1;
  for (const b of alive) {
    const d = BUILDINGS[b.key];
    if (!d) continue;
    const health = 0.5 + (0.5 * b.hp) / b.maxHp,
      road = supplyFactor(s, b);
    if (ROAD_REQUIRED.has(b.key)) {
      if (road === 1) connected++;
      else isolated++;
    }
    if (d.power < 0) power -= d.power * health * road;
    else demand += d.power;
    upkeep += d.upkeep;
  }
  const supply = demand ? Math.min(1, power / demand) : 1,
    productivity = 0.25 + 0.75 * supply;
  for (const b of alive) {
    const d = BUILDINGS[b.key];
    if (!d) continue;
    const f = productivity * (0.5 + (0.5 * b.hp) / b.maxHp) * supplyFactor(s, b);
    income += (d.income || 0) * f * efficient;
    materials += (d.materials || 0) * f * efficient;
    science += (d.science || 0) * f;
  }
  const armyUpkeep = (s.groundUnits || [])
    .filter((u) => u.side === owner && u.hp > 0)
    .reduce((n, u) => n + GROUND_UNITS[u.key].upkeep, 0);
  upkeep += armyUpkeep;
  const bonus = owner === 1 && s.mode !== 'multiplayer' ? 1.25 : 1;
  return {
    gross: income * bonus,
    upkeep,
    net: income * bonus - upkeep,
    materials: materials * bonus,
    science: science * bonus,
    power,
    demand,
    supply,
    productivity,
    bonus,
    connected,
    isolated,
    armyUpkeep,
    population: alive.filter((b) => b.key === 'housing').length * 120,
  };
}

export function buildingOutput(s, b) {
  const d = BUILDINGS[b.key],
    e = economy(s, b.side);
  if (!d) return null;
  const road = supplyFactor(s, b),
    health = 0.5 + (0.5 * b.hp) / b.maxHp,
    factor = b.hp > 0 && b.progress >= 1 ? road * health * e.productivity : 0,
    bonus = e.bonus,
    efficient = s.sides[b.side].tech.includes('efficiency') ? 1.2 : 1;
  return {
    road,
    health,
    power: e.productivity,
    factor,
    income: (d.income || 0) * factor * efficient * bonus,
    materials: (d.materials || 0) * factor * efficient * bonus,
    science: (d.science || 0) * factor * bonus,
    upkeep: d.upkeep,
    powerUse: d.power,
  };
}

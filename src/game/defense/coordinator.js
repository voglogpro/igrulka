import { sideIds } from '../factions.js';
import { FRONTLINE as C } from './config.js';
import {
  createFrontlineMemory,
  observedFrontline,
  calculateFrontline,
  cacheFrontline,
  military,
} from './frontline.js';
import { updateDefenseFormation } from './formation.js';
import { updateDefenseReserves } from './reserves.js';
import { updateDepotMissions } from './missions.js';

export function updateDefense(s) {
  if (s.result) return;
  s.frontlineMemory ||= createFrontlineMemory(s.sides.length);
  for (const side of sideIds(s)) {
    const memory = (s.frontlineMemory[side] ||= { nextThink: 0, nextReinforce: 0, seen: [] });
    if (memory.nextThink > s.time) continue;
    memory.nextThink = s.time + C.cadence;
    const observed = observedFrontline(s, side, memory.seen);
    memory.seen = observed.seen;
    const own = s.groundUnits.filter((u) => u.side === side && military(u));
    updateDefenseFormation(s, side, own);
    const report = calculateFrontline(s, side, memory.seen, observed.visible);
    updateDefenseReserves(s, side, own, report, memory);
    updateDepotMissions(s, side, own, report, memory);
    cacheFrontline(s, side, calculateFrontline(s, side, memory.seen, observed.visible));
  }
}

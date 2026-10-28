import { economy } from './city/economy.js';
import { updateRoadRecovery } from './city/road-recovery.js';
import { updateArmyComposition } from './units/ground/composition.js';
import { updateLaunchSupply } from './units/aviation/launch-supply.js';
import { updateAmmoProduction } from './city/ammo-production.js';
import { updateAmmoLogistics } from './city/ammo-logistics.js';
import { event } from './shared/events.js';
import { updateConstruction } from './city/update.js';
import { updateGround } from './units/ground/index.js';
import { random } from './shared/random.js';
import { moveUnits, impacts } from './units/aviation/flight.js';
import { fireDefenses } from './combat/air-defense.js';
import { moveProjectiles } from './combat/projectiles.js';
import { ai } from './ai/city-ai.js';
import { updateDistricts } from './territory/districts.js';
import { updateFactoryPlans } from './units/aviation/factory-plans.js';
import { updateWeather } from './weather.js';
import { updateServices } from './city/service.js';
import { updateOil } from './city/oil.js';
import { updateTraining } from './units/ground/training.js';
import { updatePorts } from './city/ports.js';
import { updateDefense } from './defense/coordinator.js';
import { sideIds, aiSides, teamOf } from './factions.js';
import { updateSettlements } from './territory/settlements.js';
import { updateFieldSupply } from './units/ground/field-supply.js';
import { beginTrenchLinkBatch, endTrenchLinkBatch } from './defense/trench-links.js';
export function step(s, dt) {
  if (s.result || !Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(0.1, dt);
  s.time += dt;
  updateWeather(s, dt);
  const rates = sideIds(s).map((side) => economy(s, side, dt));
  for (const owner of sideIds(s)) {
    const f = s.sides[owner],
      e = rates[owner];
    f.credits = Math.max(0, f.credits + e.net * dt);
    f.materials += e.materials * dt;
  }
  updateRoadRecovery(s, dt);
  updateFactoryPlans(s);
  updateConstruction(s, rates, dt);
  updateLaunchSupply(s);
  updateAmmoProduction(s);
  updateAmmoLogistics(s, dt);
  updateServices(s, dt);
  updateOil(s, rates, dt);
  updateTraining(s, dt);
  updatePorts(s, dt);
  updateFieldSupply(s);
  updateDefense(s);
  updateArmyComposition(s);
  beginTrenchLinkBatch(s);
  try {
    updateGround(s, rates, dt, { event, random });
  } finally {
    endTrenchLinkBatch(s);
  }
  moveUnits(s, dt);
  fireDefenses(s, rates, dt);
  moveProjectiles(s, dt);
  impacts(s);
  s.units = s.units.filter((u) => u.hp > 0 || u.status === 'falling');
  s.projectiles = s.projectiles.filter((p) => !p.dead);
  updateDistricts(s, dt);
  updateSettlements(s, dt);
  for (const owner of aiSides(s)) ai(s, owner);
  for (const team of [0, 1])
    if (!s.buildings.some((b) => teamOf(s, b.side) === team && b.key === 'hq' && b.hp > 0)) {
      s.winnerTeam = 1 - team;
      s.result = team === 0 ? 'defeat' : 'victory';
      event(s, 'result', { result: s.result });
      break;
    }
}

export function advance(s, seconds) {
  for (let t = 0; t < seconds - 1e-8; t += 0.05) step(s, Math.min(0.05, seconds - t));
  return s;
}

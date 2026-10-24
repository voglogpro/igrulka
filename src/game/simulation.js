import { economy, supplyFactor } from './city/economy.js';
import { TECH } from './config.js';
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
export function step(s, dt) {
  if (s.result || !Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(0.1, dt);
  s.time += dt;
  updateWeather(s, dt);
  const rates = [economy(s, 0), economy(s, 1)];
  for (let owner = 0; owner < 2; owner++) {
    const f = s.sides[owner],
      e = rates[owner];
    f.credits = Math.max(0, f.credits + e.net * dt);
    f.materials += e.materials * dt;
    f.science += e.science * dt;
    if (f.research) {
      const labs = s.buildings.filter(
        (b) => b.side === owner && b.key === 'lab' && b.hp > 0 && b.progress >= 1,
      );
      if (labs.length)
        f.research.progress +=
          (dt * e.productivity * Math.max(...labs.map((b) => supplyFactor(s, b)))) /
          TECH[f.research.key].time;
      if (f.research.progress >= 1) {
        const key = f.research.key;
        f.tech.push(key);
        f.research = null;
        event(s, 'research', { side: owner, key });
      }
    }
  }
  updateFactoryPlans(s);
  updateConstruction(s, rates, dt);
  updateServices(s, dt);
  updateGround(s, rates, dt, { event, random });
  moveUnits(s, dt);
  fireDefenses(s, rates, dt);
  moveProjectiles(s, dt);
  impacts(s);
  s.units = s.units.filter((u) => u.hp > 0 || u.status === 'falling');
  s.projectiles = s.projectiles.filter((p) => !p.dead);
  updateDistricts(s, dt);
  if (s.mode !== 'multiplayer') ai(s);
  for (let owner = 0; owner < 2; owner++)
    if (!s.buildings.some((b) => b.side === owner && b.key === 'hq' && b.hp > 0)) {
      s.result = owner === 0 ? 'defeat' : 'victory';
      event(s, 'result', { result: s.result });
      break;
    }
}

export function advance(s, seconds) {
  for (let t = 0; t < seconds - 1e-8; t += 0.05) step(s, Math.min(0.05, seconds - t));
  return s;
}

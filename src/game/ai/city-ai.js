import { BUILDINGS, WEAPONS } from '../config.js';
import { upgradeDefense } from '../combat/upgrades.js';
import { demolish, repair, canPlace, build } from '../city/construction.js';
import { passable, overlappingRoad } from '../city/road-network.js';
import { economy } from '../city/economy.js';
import { buildRoad } from '../city/roads.js';
import { research, researchProjects, researchStatus } from '../research/research.js';
import { purchaseQuote } from '../city/pricing.js';
import { difficultyOf } from './difficulty.config.js';
import { random } from '../shared/random.js';
import { produce } from '../units/aviation/production.js';
import { knownTargets } from '../visibility.js';
import { launch } from '../units/aviation/launch.js';
import { oilPlan } from './oil-ai.js';
export function ai(s) {
  const side = 1,
    f = s.sides[1],
    hq = s.buildings.find((b) => b.side === 1 && b.key === 'hq'),
    active = (key) => s.buildings.filter((b) => b.side === 1 && b.key === key && b.hp > 0),
    ready = (key) => active(key).filter((b) => b.progress >= 1);
  if (s.time >= s.ai.nextBuild) {
    s.ai.nextBuild = s.time + 7;
    if (f.tech.includes('targeting') && f.credits > 1400 && f.materials > 100) {
      const gun = s.buildings.find(
        (b) =>
          b.side === 1 &&
          b.hp > 0 &&
          b.progress >= 1 &&
          BUILDINGS[b.key]?.range &&
          (b.level || 0) < 2,
      );
      if (gun) upgradeDefense(s, 1, gun.id);
    }
    const ruin = s.buildings.find(
      (b) => b.side === 1 && b.hp <= 0 && !b.demolished && b.key !== 'hq',
    );
    if (ruin) demolish(s, ruin.id, 1);
    for (const r of s.roads)
      if (r.side === 1 && !r.removed && !passable(r) && !r.repairing) {
        repair(s, r.id, 1);
        break;
      }
    const e = economy(s, 1),
      planned = s.buildings
        .filter((b) => b.side === 1 && b.hp > 0 && b.progress < 1)
        .reduce((n, b) => n - (BUILDINGS[b.key]?.power || 0), 0);
    // Oil comes before everything except power: without it no machine leaves the factory.
    const oilBusy = e.power - e.demand + planned >= 7 && oilPlan(s, 1, hq, active);
    let key = oilBusy
      ? null
      : e.power - e.demand + planned < 7
        ? 'power'
        : active('housing').length < 3
          ? 'housing'
          : active('industry').length < 2
            ? 'industry'
            : !active('factory').length
              ? 'factory'
              : !active('launcher').length
                ? 'launcher'
                : active('gun').length < 3
                  ? 'gun'
                  : !active('lab').length
                    ? 'lab'
                    : null;
    if (!key && !oilBusy) {
      const goals = [
        ['housing', Math.min(9, 3 + Math.floor(s.time / 130))],
        ['industry', Math.min(5, 2 + Math.floor(s.time / 250))],
        ['radar', s.time > 220 ? 1 : 0],
        ['sam', f.tech.includes('missileDefense') ? 2 : 0],
        ['launcher', s.time > 600 ? 2 : 1],
        ['factory', s.time > 580 ? 2 : 1],
        ['barracks', s.time > 240 ? 1 : 0],
        ['training', s.time > 640 ? 1 : 0],
        ['market', s.time > 420 ? 1 : 0],
        ['lab', s.time > 700 ? 2 : 1],
        ['gun', Math.min(6, 3 + Math.floor(s.time / 240))],
      ];
      key = goals.find(([k, n]) => active(k).length < n)?.[0] || null;
    }
    s.ai.plannedBuild = key;
    if (key) {
      let placed = false,
        hasSite = false;
      const xs = [-110, -55, 55, 110, -165, 0, 165],
        zs = [-80, -10, 90, 20, 190, 120, -180, -110, 290, 220];
      for (const dz of zs) {
        for (const dx of xs) {
          const x = hq.x + dx,
            z = hq.z + dz;
          if (canPlace(s, key, x, z, 1)) continue;
          hasSite = true;
          const b = build(s, 1, key, x, z);
          if (typeof b !== 'string') {
            placed = true;
            s.ai.plannedBuild = null;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed && !hasSite && f.credits > 350) {
        const plans = [
            [-90, -45, -200, -45],
            [90, -45, 200, -45],
            [-200, -45, -200, 255],
            [-200, 55, 200, 55],
            [-200, 155, 200, 155],
            [-200, -45, -200, -245],
            [-200, -145, 200, -145],
            [-200, 255, 200, 255],
          ],
          index = s.ai.roadPlan || 0;
        if (index < plans.length) {
          const [ax, az, bx, bz] = plans[index],
            r = buildRoad(s, 1, hq.x + ax, az, hq.x + bx, bz);
          if (typeof r !== 'string' || overlappingRoad(s, hq.x + ax, az, hq.x + bx, bz))
            s.ai.roadPlan = index + 1;
        }
      }
    }
  }
  if (s.time >= s.ai.nextResearch) {
    s.ai.nextResearch = s.time + difficultyOf(s).researchEvery;
    const running = new Set(researchProjects(s, side).map((project) => project.key));
    let available = Math.max(0, researchStatus(s, side).slots - running.size);
    for (const key of [
      'autocannon',
      'heavy',
      'missileDefense',
      'efficiency',
      'cruise',
      'targeting',
      'mobileAA',
      'fpvTeams',
      'abm',
      'lightArmor',
      'armor',
      'bodyArmor',
      'propulsion',
      'cooling',
      'airframes',
      'magazines',
      'ballistic',
      'payload',
      'composite',
      'artillery',
      'heavyArmor',
      'rocketArtillery',
    ])
      if (available > 0 && !f.tech.includes(key) && !running.has(key)) {
        if (research(s, side, key) === true) {
          running.add(key);
          available--;
        }
      }
  }
  if (ready('factory').length && ready('launcher').length) {
    const queued = ready('factory').reduce((n, b) => n + (b.queue?.length || 0), 0),
      stock = Object.values(f.inventory).reduce((a, b) => a + b, 0),
      reserve = purchaseQuote(s, side, 'building', s.ai.plannedBuild)?.cost ?? 150;
    if (queued < 3 && stock < 7 && f.credits > reserve + 90 && f.materials > 30) {
      let key =
        f.tech.includes('cruise') && random(s) > 0.5
          ? 'cruise'
          : f.tech.includes('heavy') && random(s) > 0.5
            ? 'heavy'
            : 'drone';
      if (f.tech.includes('ballistic') && random(s) > 0.75) key = 'ballistic';
      produce(s, 1, key);
    }
  }
  if (s.time >= s.ai.nextAttack) {
    s.ai.nextAttack =
      s.time + difficultyOf(s).attackEvery + random(s) * difficultyOf(s).attackJitter;
    let targets = knownTargets(s, 1).filter((b) => b.key !== 'road');
    if (random(s) < 0.28) {
      const roads = knownTargets(s, 1).filter((r) => r.key === 'road' && passable(r));
      if (roads.length) targets = roads;
    }
    const weighted = targets.flatMap((b) =>
        Array(['hq', 'power', 'factory', 'launcher'].includes(b.key) ? 3 : 1).fill(b),
      ),
      target = weighted[Math.floor(random(s) * weighted.length)] || { x: -615, z: 0 };
    if (target)
      for (const key of Object.keys(WEAPONS))
        if (f.inventory[key]) {
          const flank = ['drone', 'heavy', 'cruise'].includes(key) && random(s) < 0.45,
            z = random(s) < 0.5 ? -350 : 350,
            aim = flank
              ? {
                  x: target.x,
                  z: target.z,
                  waypoints: [
                    { x: 300, z },
                    { x: -200, z },
                  ],
                }
              : (target.id ?? target);
          const r = launch(s, 1, key, aim, 6);
          if (typeof r === 'number') break;
        }
  }
}

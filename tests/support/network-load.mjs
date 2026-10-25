import * as E from '../../src/game/index.js';
import { flightRoute } from '../../src/game/units/aviation/routes.js';
import { addRoad } from '../../src/game/city/roads.js';
export const NETWORK_GROUND_PER_CITY = 120;

export function loadFixture(airCount = 100, { airHp = null } = {}) {
  const s = E.createGame(8102, { mode: 'coop' });
  s.rules.oil = false;
  s.time = 30;
  for (const ai of [s.ai, ...Object.values(s.aiBySide || {})]) {
    ai.nextBuild = 1e9;
    ai.nextAttack = 1e9;
    ai.nextArmy = 1e9;
  }
  const roster = ['infantry', 'infantry', 'infantry', 'leopard', 'shilka', 'atgm'];
  for (let side = 0; side < 4; side++) {
    const sign = side % 2 ? 1 : -1,
      hq = s.buildings.find((b) => b.side === side),
      z = side < 2 ? -1360 : 1360;
    s.sides[side].credits = 100000;
    s.sides[side].materials = 5000;
    for (let i = 0; i < NETWORK_GROUND_PER_CITY; i++) {
      const key = roster[i % roster.length],
        u = E.makeGround(
          s,
          side,
          key,
          sign * (150 + Math.floor(i / 20) * 26),
          z + ((i % 20) - 9.5) * 16,
        );
      // A legal-size navigation path, queued manual route and guard/stance state.
      u.path = Array.from({ length: 64 }, (_, j) => ({ x: u.x - sign * j * 2, z: u.z }));
      u.order = { mode: 'attackmove', x: u.path.at(-1).x, z: u.z };
      u.routeQueue = Array.from({ length: 12 }, (_, j) => ({
        mode: 'move',
        x: u.x - sign * (j + 1) * 4,
        z: u.z,
      }));
      u.routeState = { status: 'moving', x: u.path.at(-1).x, z: u.z, retryAt: 30 };
      s.groundUnits.push(u);
    }
    for (let i = 0; i < 5; i++) {
      const key = ['barracks', 'vehiclebase', 'factory', 'silo', 'power'][i],
        d = E.BUILDINGS[key];
      const b = {
        id: s.nextId++,
        side,
        key,
        x: hq.x + (i - 1) * 55,
        z: hq.z + 90,
        hp: d.hp,
        maxHp: d.hp,
        progress: 1,
        rotation: 0,
        cooldown: 0,
        queue: [],
        armyQueue: [],
      };
      // Keep the historical 480-troop measurement stable independently of army caps.
      if (i === 2) b.queue = Array.from({ length: 4 }, () => ({ key: 'drone', progress: 0 }));
      s.buildings.push(b);
      addRoad(s, side, hq.x, hq.z - 45, b.x, b.z + 20);
    }
  }
  for (let i = 0; i < airCount; i++) {
    const side = i % 4,
      origin = s.buildings.find((b) => b.side === side && b.key === 'factory'),
      enemy = s.buildings.find((b) => b.side === (side ^ 1) && b.key === 'hq');
    const aim = {
      x: enemy.x,
      z: enemy.z,
      waypoints: Array.from({ length: 10 }, (_, j) => ({
        x: origin.x + ((enemy.x - origin.x) * (j + 1)) / 11,
        z: origin.z + (j % 2 ? 120 : -120),
      })),
    };
    // Opposing flights already entered AA range. Default HP is the normal game
    // value; an explicit airHp is available solely for labelled endurance stress.
    const launch = {
      x: (side % 2 ? 1 : -1) * 30,
      z: (side < 2 ? -1360 : 1360) + ((i % 12) - 6) * 18,
    };
    const d = E.WEAPONS.drone,
      route = flightRoute(launch, aim, 'drone');
    s.units.push({
      id: s.nextId++,
      side,
      key: 'drone',
      sourceId: origin.id,
      localLaunch: true,
      status: 'flying',
      route,
      speed: d.speed,
      damage: d.damage,
      x: launch.x,
      z: launch.z,
      y: 80,
      prevX: launch.x,
      prevY: 80,
      prevZ: launch.z,
      vx: side % 2 ? -d.speed : d.speed,
      vy: 0,
      vz: 0,
      startX: launch.x,
      startZ: launch.z,
      targetId: enemy.id,
      targetKind: 'building',
      tx: enemy.x,
      tz: enemy.z,
      hp: airHp ?? d.hp,
      maxHp: airHp ?? d.hp,
      travelled: 0,
      total: route.at(-1).d,
      delay: 0,
      launched: true,
      phase: i * 0.1,
    });
  }
  return s;
}

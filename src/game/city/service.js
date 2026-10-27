import { BUILDINGS } from '../config.js';
import { passable, dirtyNetwork, projectPoint } from './road-network.js';
import { serviceFieldRoute, serviceParking, servicePathClear } from './service-field-routes.js';
import { weatherSpeed } from '../weather.js';
import { moveCivicVehicle } from '../units/ground/movement.js';

const settings = () => BUILDINGS.service.service;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ready = (b) => b && b.hp > 0 && !b.demolished && b.progress >= 1;
const active = (s, b) => ready(b) && b.serviceEnabled !== false;
const targetOf = (s, v) =>
  v.target?.kind === 'building'
    ? s.buildings.find((b) => b.id === v.target.id)
    : s.roads.find((r) => r.id === v.target?.id);
function eligible(t, side, kind) {
  return (
    t &&
    t.side === side &&
    Number.isFinite(t.hp) &&
    t.maxHp - t.hp > 1e-8 &&
    !t.repairing &&
    (kind === 'building' ? ready(t) : !t.removed && !t.connectorTo)
  );
}
function jobs(s, side) {
  return [
    ...s.roads.filter((t) => eligible(t, side, 'road')).map((t) => ({ kind: 'road', id: t.id })),
    ...s.buildings
      .filter((t) => eligible(t, side, 'building'))
      .map((t) => ({ kind: 'building', id: t.id })),
  ];
}
function go(v, s, route, state, target = null) {
  v.path = route.path;
  v.roadIds = [];
  v.revision = s.networkRevision;
  v.state = state;
  v.target = target;
}
function routeToJob(s, v, target) {
  const t =
    target.kind === 'building'
      ? s.buildings.find((b) => b.id === target.id)
      : s.roads.find((r) => r.id === target.id);
  return eligible(t, v.side, target.kind) ? serviceFieldRoute(s, v, t, target.kind) : null;
}
function sendHome(s, v, b) {
  const home = serviceParking(s, b, v.id % settings().vehicles);
  const route =
    home &&
    serviceFieldRoute(
      s,
      v,
      {
        ax: home.x,
        az: home.z,
        bx: home.x,
        bz: home.z,
      },
      'road',
    );
  v.target = null;
  if (route) go(v, s, route, route.path.length ? 'returning' : 'idle');
  else {
    v.path = [];
    v.state = 'blocked';
  }
}
function think(s, v, b) {
  const changed = v.revision !== s.networkRevision;
  v.revision = s.networkRevision;
  const available = jobs(s, v.side);
  if (v.state === 'idle' && !v.target && !available.length) return;
  const routeClear = !changed || servicePathClear(s, v, v.path);
  if (
    routeClear &&
    active(s, b) &&
    v.target &&
    eligible(targetOf(s, v), v.side, v.target.kind) &&
    ['outbound', 'repairing'].includes(v.state)
  )
    return;
  if (routeClear && v.state === 'returning' && v.path.length) return;
  if (!active(s, b)) {
    sendHome(s, v, b);
    return;
  }
  if (v.target) {
    const route = routeToJob(s, v, v.target);
    if (route) {
      go(v, s, route, route.path.length ? 'outbound' : 'repairing', v.target);
      return;
    }
    v.target = null;
  }
  if (v.state === 'returning' && v.path.length) {
    sendHome(s, v, b);
    return;
  }
  const reserved = new Set(
    (s.serviceVehicles || [])
      .filter((other) => other !== v && other.target)
      .map((other) => other.target.kind + ':' + other.target.id),
  );
  const candidates = available
    .filter((target) => !reserved.has(target.kind + ':' + target.id))
    .map((target) => {
      const t =
        target.kind === 'road'
          ? s.roads.find((r) => r.id === target.id)
          : s.buildings.find((b) => b.id === target.id);
      const point = target.kind === 'road' ? projectPoint(v.x, v.z, t) : t;
      return {
        target,
        score: distance(v, point) + (target.kind === 'road' && !passable(t) ? 0 : 100),
      };
    })
    .sort((a, b) => a.score - b.score || a.target.id - b.target.id);
  // Bound expensive route searches. Rotate failed candidates so an unreachable neighbour
  // cannot permanently starve a reachable repair elsewhere.
  let best = null;
  for (let i = 0; i < Math.min(6, candidates.length); i++) {
    const index = ((v.dispatchCursor || 0) + i) % candidates.length;
    const candidate = candidates[index],
      route = routeToJob(s, v, candidate.target);
    if (route) {
      best = { target: candidate.target, route };
      v.dispatchCursor = 0;
      break;
    }
  }
  if (best) go(v, s, best.route, best.route.path.length ? 'outbound' : 'repairing', best.target);
  else if (candidates.length) {
    v.dispatchCursor = ((v.dispatchCursor || 0) + 6) % candidates.length;
    v.path = [];
    v.state = 'blocked';
  } else sendHome(s, v, b);
}
function repairTick(s, v, dt) {
  const t = targetOf(s, v),
    cfg = settings();
  if (!eligible(t, v.side, v.target?.kind)) return false;
  const reach =
    v.target.kind === 'road'
      ? projectPoint(v.x, v.z, t).distance
      : Math.max(0, distance(v, t) - (BUILDINGS[t.key]?.size || 30) * 0.5 - 5);
  if (reach > 6) return false;
  const f = s.sides[v.side];
  const rate = v.target.kind === 'road' ? cfg.roadRepair : cfg.buildingRepair;
  const amount = Math.min(
    t.maxHp - t.hp,
    rate * dt,
    f.credits / cfg.creditsPerHp,
    f.materials / cfg.materialsPerHp,
  );
  if (!(amount > 1e-9)) return true;
  const before = v.target.kind === 'road' && passable(t);
  t.hp += amount;
  if (t.maxHp - t.hp < 1e-8) t.hp = t.maxHp;
  f.credits = Math.max(0, f.credits - amount * cfg.creditsPerHp);
  f.materials = Math.max(0, f.materials - amount * cfg.materialsPerHp);
  if (v.target.kind === 'road') {
    if (t.hp >= t.maxHp * 0.85) t.blocked = false;
    if (before !== passable(t)) dirtyNetwork(s);
  }
  return t.hp < t.maxHp - 1e-8;
}
function move(s, v, dt, speed) {
  moveCivicVehicle(s, v, dt, speed);
  if (!v.path.length) v.state = v.target ? 'repairing' : 'idle';
}

export function setServiceEnabled(s, side, id, enabled) {
  const b = s.buildings.find((b) => b.id === id && b.side === side && b.key === 'service');
  if (s.result || !ready(b) || typeof enabled !== 'boolean') return 'Ремонтная станция недоступна';
  b.serviceEnabled = enabled;
  for (const v of s.serviceVehicles || []) if (v.stationId === id) v.thinkAt = 0;
  return true;
}

export function serviceStatus(s, side, id) {
  const b = s.buildings.find((b) => b.id === id && b.side === side && b.key === 'service');
  if (!b) return null;
  const fleet = (s.serviceVehicles || []).filter((v) => v.stationId === id),
    f = s.sides[side];
  const report = {
    status: 'idle',
    enabled: b.serviceEnabled !== false,
    vehicles: fleet.length,
    busy: fleet.filter((v) => v.target).length,
    repairing: fleet.filter((v) => v.state === 'repairing').length,
    blocked: fleet.filter((v) => v.state === 'blocked').length,
    targets: jobs(s, side).length,
  };
  report.status = !ready(b)
    ? b.hp <= 0 || b.demolished
      ? 'ruined'
      : 'building'
    : !report.enabled
      ? 'disabled'
      : report.busy && f.credits < settings().creditsPerHp * 0.05
        ? 'credits'
        : report.busy && f.materials < settings().materialsPerHp * 0.05
          ? 'materials'
          : report.blocked
            ? 'blocked'
            : report.busy
              ? 'active'
              : 'idle';
  return report;
}

export function updateServices(s, dt) {
  if (s.result || !(dt > 0) || !Number.isFinite(dt)) return;
  s.serviceVehicles ||= [];
  const stations = s.buildings.filter((b) => b.key === 'service' && ready(b));
  s.serviceVehicles = s.serviceVehicles.filter((v) =>
    stations.some((b) => b.id === v.stationId && b.side === v.side),
  );
  const cfg = settings();
  for (const b of stations) {
    if (!active(s, b)) continue;
    const count = s.serviceVehicles.filter((v) => v.stationId === b.id).length;
    const available = Math.min(
      cfg.vehicles - count,
      cfg.sideLimit - s.serviceVehicles.filter((v) => v.side === b.side).length,
    );
    if (available <= 0) continue;
    const home = serviceParking(s, b);
    if (!home) continue;
    for (let i = 0; i < available; i++) {
      const id = s.nextId++,
        parked = serviceParking(s, b, id % cfg.vehicles) || home;
      s.serviceVehicles.push({
        id,
        side: b.side,
        stationId: b.id,
        x: parked.x,
        z: parked.z,
        yaw: b.rotation || 0,
        state: 'idle',
        target: null,
        path: [],
        roadIds: [],
        revision: s.networkRevision,
        thinkAt: s.time,
        dispatchCursor: 0,
      });
    }
  }
  for (const v of s.serviceVehicles) {
    const b = stations.find((b) => b.id === v.stationId);
    const target = targetOf(s, v);
    const invalid = v.target && !eligible(target, v.side, v.target.kind);
    if (
      v.revision !== s.networkRevision ||
      v.thinkAt <= s.time ||
      invalid ||
      (v.target && !active(s, b))
    ) {
      // Cache invalidation (including load) must not shift the saved dispatch cadence.
      if (v.thinkAt <= s.time || invalid || (v.target && !active(s, b)))
        v.thinkAt = s.time + cfg.cadence;
      think(s, v, b);
    }
    if (v.state === 'outbound' || v.state === 'returning')
      move(s, v, dt, cfg.speed * weatherSpeed(s));
    else if (v.state === 'repairing' && active(s, b) && !repairTick(s, v, dt)) {
      v.target = null;
      sendHome(s, v, b);
    }
  }
}

import { BUILDINGS } from '../config.js';
import { passable, dirtyNetwork, projectPoint, roadsTouch } from './road-network.js';
import {
  serviceRoadGraph,
  serviceAccess,
  serviceRoutes,
  serviceJunction,
} from './service-roads.js';
import { weatherSpeed } from '../weather.js';

const settings = () => BUILDINGS.service.service;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ready = (b) => b && b.hp > 0 && !b.demolished && b.progress >= 1;
const active = (s, b) =>
  ready(b) && b.serviceEnabled !== false && !!dock(serviceRoadGraph(s, b.side), b);
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
function dock(graph, b, slot = 0) {
  const road = graph.roadById.get(b.roadLink);
  const base = road
    ? { ...projectPoint(b.x, b.z, road), road }
    : serviceAccess(graph, b, BUILDINGS.service.size * 0.5 + 11)[0];
  if (!base) return null;
  const dx = base.road.bx - base.road.ax,
    dz = base.road.bz - base.road.az;
  const length = Math.hypot(dx, dz);
  const t = Math.max(0, Math.min(1, base.t + ((base.t > 0.5 ? -1 : 1) * slot * 6) / (length || 1)));
  return { x: base.road.ax + dx * t, z: base.road.az + dz * t, road: base.road };
}
function workAccess(graph, t, kind, origin) {
  if (kind === 'building') {
    const road = graph.roadById.get(t.roadLink);
    if (road) return [{ ...projectPoint(t.x, t.z, road), road }];
    return serviceAccess(graph, t, (BUILDINGS[t.key]?.size || 30) * 0.5 + 11);
  }
  const own = graph.roadById.get(t.id);
  if (own) return [{ ...projectPoint(origin.x, origin.z, own), road: own }];
  return graph.roads
    .filter((r) => roadsTouch(r, t))
    .map((road) => {
      const p = serviceJunction(road, t);
      return { ...projectPoint(p.x, p.z, road), road };
    });
}
function go(v, graph, route, state, target = null) {
  v.path = route.path;
  v.roadIds = [
    ...new Set(route.path.map((p) => serviceAccess(graph, p, 2)[0]?.road.id).filter(Boolean)),
  ];
  v.revision = graph.revision;
  v.state = state;
  v.target = target;
}
function routeToJob(s, v, graph, route, target) {
  const t =
    target.kind === 'building'
      ? s.buildings.find((b) => b.id === target.id)
      : s.roads.find((r) => r.id === target.id);
  if (!eligible(t, v.side, target.kind)) return null;
  let best = null;
  for (const p of workAccess(graph, t, target.kind, v)) {
    const candidate = route(p, p.road.id);
    if (candidate && (!best || candidate.cost < best.cost)) best = candidate;
  }
  return best;
}
function sendHome(v, graph, b, route) {
  const home = dock(graph, b, v.id % settings().vehicles),
    path = home && route(home, home.road.id);
  v.target = null;
  if (path) go(v, graph, path, path.path.length ? 'returning' : 'idle');
  else {
    v.path = [];
    v.state = 'blocked';
  }
}
function think(s, v, b) {
  const graph = serviceRoadGraph(s, v.side),
    changed = v.revision !== graph.revision;
  v.revision = graph.revision;
  const available = jobs(s, v.side);
  if (v.state === 'idle' && !v.target && !available.length) return;
  if (
    !changed &&
    active(s, b) &&
    v.target &&
    eligible(targetOf(s, v), v.side, v.target.kind) &&
    ['outbound', 'repairing'].includes(v.state)
  )
    return;
  if (!changed && v.state === 'returning' && v.path.length) return;
  const route = serviceRoutes(graph, v);
  if (!active(s, b)) {
    sendHome(v, graph, b, route);
    return;
  }
  if (v.target) {
    const path = routeToJob(s, v, graph, route, v.target);
    if (path) {
      go(v, graph, path, path.path.length ? 'outbound' : 'repairing', v.target);
      return;
    }
    v.target = null;
  }
  // A vehicle completes its return before reserving another job.
  if (v.state === 'returning' && v.path.length) {
    if (changed) sendHome(v, graph, b, route);
    return;
  }
  const reserved = new Set(
    (s.serviceVehicles || [])
      .filter((other) => other !== v && other.target)
      .map((other) => `${other.target.kind}:${other.target.id}`),
  );
  let best = null;
  for (const target of available) {
    if (reserved.has(`${target.kind}:${target.id}`)) continue;
    const path = routeToJob(s, v, graph, route, target);
    if (path) {
      // A cut street is the useful first repair: it can reconnect the rest of the city.
      const t = target.kind === 'road' && s.roads.find((r) => r.id === target.id);
      const score = path.cost + (t && !passable(t) ? 0 : 100);
      if (!best || score < best.score || (score === best.score && target.id < best.target.id))
        best = { target, path, score };
    }
  }
  if (best) go(v, graph, best.path, best.path.path.length ? 'outbound' : 'repairing', best.target);
  else sendHome(v, graph, b, route);
}
function repairTick(s, v, dt) {
  const t = targetOf(s, v),
    cfg = settings();
  if (!eligible(t, v.side, v.target?.kind)) return false;
  const reach =
    v.target.kind === 'road'
      ? projectPoint(v.x, v.z, t).distance
      : Math.max(0, distance(v, t) - (BUILDINGS[t.key]?.size || 30) * 0.5 - 5);
  if (
    reach > 6 ||
    !serviceRoadGraph(s, v.side).roads.some((r) => projectPoint(v.x, v.z, r).distance <= 6)
  )
    return false;
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
function move(v, travel) {
  while (travel > 0 && v.path.length) {
    const p = v.path[0],
      length = distance(v, p);
    if (length > 1e-8) {
      const step = Math.min(travel, length);
      v.yaw = Math.atan2(p.x - v.x, p.z - v.z);
      v.x += ((p.x - v.x) * step) / length;
      v.z += ((p.z - v.z) * step) / length;
      travel -= step;
    }
    if (length <= travel + 1e-8 || distance(v, p) < 1e-8) v.path.shift();
    else break;
  }
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
      : !dock(serviceRoadGraph(s, side), b)
        ? 'road'
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
    const graph = serviceRoadGraph(s, b.side),
      home = dock(graph, b);
    if (!home) continue;
    for (let i = 0; i < available; i++) {
      const id = s.nextId++,
        parked = dock(graph, b, id % cfg.vehicles);
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
    // A disconnected station cannot send a crew along stale geometry or work remotely.
    if (!dock(serviceRoadGraph(s, b.side), b)) {
      v.state = 'blocked';
      v.path = [];
      continue;
    }
    if (v.state === 'outbound' || v.state === 'returning')
      move(v, cfg.speed * weatherSpeed(s) * dt);
    else if (v.state === 'repairing' && active(s, b) && !repairTick(s, v, dt)) {
      v.target = null;
      const graph = serviceRoadGraph(s, v.side);
      sendHome(v, graph, b, serviceRoutes(graph, v));
    }
  }
}

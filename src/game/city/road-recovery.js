import { validSide } from '../factions.js';
import { roadPreview } from './roads.js';
import { dirtyNetwork, passable, projectPoint, ROAD_HP } from './road-network.js';

export const HEADQUARTERS_INCOME = 1.8;
const geometry = new WeakMap();
const liveHQ = (s, side) =>
  s.buildings.find((b) => b.side === side && b.key === 'hq' && b.hp > 0 && b.progress >= 1);
const roadOf = (s, side, id) =>
  s.roads.find((r) => r.id === id && r.side === side && !r.connectorTo);
const lengthOf = (r) => Math.hypot(r.bx - r.ax, r.bz - r.az);
const costOf = (r) =>
  r.removed
    ? Math.ceil(lengthOf(r) * 0.8)
    : Math.ceil(Math.max(0, (r.maxHp || ROAD_HP) - r.hp) * 0.55);
const maximumCost = (r) =>
  Math.max(Math.ceil(lengthOf(r) * 0.8), Math.ceil((r.maxHp || ROAD_HP) * 0.55));

function geometryCache(s) {
  let cached = geometry.get(s);
  if (
    !cached ||
    cached.revision !== s.networkRevision ||
    cached.roads !== s.roads ||
    cached.count !== s.roads.length ||
    cached.buildings !== s.buildings ||
    cached.buildingCount !== s.buildings.length
  ) {
    cached = {
      revision: s.networkRevision,
      roads: s.roads,
      count: s.roads.length,
      buildings: s.buildings,
      buildingCount: s.buildings.length,
      entries: new Map(),
    };
    geometry.set(s, cached);
  }
  return cached;
}

// A replacement may consist of several ordinary paid road segments. Partial
// overlap is a blocker, not permission to restore overlapping road geometry.
function replaced(s, r) {
  const length = lengthOf(r),
    ux = (r.bx - r.ax) / length,
    uz = (r.bz - r.az) / length;
  const intervals = [];
  for (const other of s.roads) {
    if (other === r || other.side !== r.side || !passable(other)) continue;
    if (
      Math.abs((other.ax - r.ax) * uz - (other.az - r.az) * ux) > 0.5 ||
      Math.abs((other.bx - r.ax) * uz - (other.bz - r.az) * ux) > 0.5
    )
      continue;
    const a = (other.ax - r.ax) * ux + (other.az - r.az) * uz;
    const b = (other.bx - r.ax) * ux + (other.bz - r.az) * uz;
    const from = Math.max(0, Math.min(a, b)),
      to = Math.min(length, Math.max(a, b));
    if (to > from) intervals.push([from, to]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let end = 0;
  for (const [from, to] of intervals) {
    if (from > end + 0.5) return false;
    end = Math.max(end, to);
    if (end >= length - 0.5) return true;
  }
  return false;
}

function geometryStatus(s, r) {
  const cache = geometryCache(s);
  let result = cache.entries.get(r.id);
  const pose = [r.ax, r.az, r.bx, r.bz].join(',');
  if (!result || result.pose !== pose) {
    const check = roadPreview(s, r.side, r.ax, r.az, r.bx, r.bz, {
      ignoreCredits: true,
      ignoreRoadId: r.id,
    });
    result = { pose, reason: check.error || '', replaced: !!check.error && replaced(s, r) };
    cache.entries.set(r.id, result);
  }
  return result;
}

function activeQuote(s, side) {
  const contract = s.sides[side].roadRecovery;
  if (!contract) return null;
  const r = roadOf(s, side, contract.id);
  if (!r)
    return {
      contract,
      status: 'unavailable',
      reason: 'Участок больше не принадлежит городу',
      cost: 0,
      remaining: 0,
    };
  const cost = costOf(r),
    remaining = Math.max(0, cost - contract.paid);
  if (!r.removed && passable(r) && cost === 0)
    return { contract, r, cost, remaining, status: 'complete', reason: 'Дорога уже восстановлена' };
  const check = geometryStatus(s, r);
  if (check.replaced)
    return {
      contract,
      r,
      cost,
      remaining,
      status: 'complete',
      reason: 'Участок уже заменён новой дорогой',
    };
  if (!liveHQ(s, side))
    return { contract, r, cost, remaining, status: 'blocked', reason: 'Нужен действующий штаб' };
  if (check.reason)
    return { contract, r, cost, remaining, status: 'blocked', reason: check.reason };
  if (r.repairing)
    return { contract, r, cost, remaining, status: 'blocked', reason: 'Участок уже ремонтируется' };
  if (!contract.enabled)
    return { contract, r, cost, remaining, status: 'paused', reason: 'Подряд приостановлен' };
  return {
    contract,
    r,
    cost,
    remaining,
    status: 'funding',
    reason: 'Доход штаба направлен на восстановление дороги',
  };
}

export function roadRecoveryFundingRate(s, side, dt = 0) {
  if (s.result || !validSide(s, side)) return 0;
  const quote = activeQuote(s, side);
  if (quote?.status !== 'funding') return 0;
  return dt > 0
    ? Math.min(HEADQUARTERS_INCOME, quote.remaining / dt)
    : quote.remaining > 0
      ? HEADQUARTERS_INCOME
      : 0;
}

export function roadRecoveryStatus(s, side) {
  if (!validSide(s, side)) return null;
  const hq = liveHQ(s, side),
    quote = activeQuote(s, side),
    candidates = [];
  // Keep the best eight in one bounded pass, rather than previewing every road
  // or constructing a second road graph on every inspector refresh.
  for (const r of s.roads) {
    if (r.side !== side || r.connectorTo || passable(r)) continue;
    const entry = {
      id: r.id,
      cost: costOf(r),
      ax: r.ax,
      az: r.az,
      bx: r.bx,
      bz: r.bz,
      distance: hq ? projectPoint(hq.x, hq.z, r).distance : 0,
    };
    let index = candidates.findIndex(
      (v) => entry.distance < v.distance || (entry.distance === v.distance && entry.id < v.id),
    );
    if (index < 0) index = candidates.length;
    if (index < 8) candidates.splice(index, 0, entry);
    if (candidates.length > 8) candidates.pop();
  }
  if (quote?.r && !candidates.some((c) => c.id === quote.r.id)) {
    if (candidates.length === 8) candidates.pop();
    const r = quote.r;
    candidates.push({
      id: r.id,
      cost: quote.cost,
      ax: r.ax,
      az: r.az,
      bx: r.bx,
      bz: r.bz,
      distance: hq ? projectPoint(hq.x, hq.z, r).distance : 0,
    });
  }
  const rate = roadRecoveryFundingRate(s, side);
  return {
    id: quote?.contract.id ?? null,
    enabled: quote?.contract.enabled ?? false,
    paid: quote?.contract.paid ?? 0,
    cost: quote?.cost ?? 0,
    remaining: quote?.remaining ?? 0,
    rate,
    eta: rate > 0 ? quote.remaining / rate : null,
    status: quote?.status ?? (candidates.length ? 'available' : 'idle'),
    reason:
      quote?.reason ??
      (!hq
        ? 'Нужен действующий штаб'
        : candidates.length
          ? 'Выберите свой утраченный участок'
          : 'Дорожное снабжение не требует восстановления'),
    candidates,
    recommendedId: candidates[0]?.id ?? null,
  };
}

export function startRoadRecovery(s, side, id) {
  if (s.result || !validSide(s, side) || !Number.isSafeInteger(id) || !liveHQ(s, side))
    return 'Подряд недоступен';
  const r = roadOf(s, side, id);
  if (!r || (!r.removed && passable(r))) return 'Выберите свой утраченный участок дороги';
  const current = s.sides[side].roadRecovery;
  if (current && current.id !== id && current.paid > 0)
    return 'Завершите текущий подряд или отмените его без возврата оплаты';
  const check = geometryStatus(s, r);
  if (check.replaced) return 'Участок уже заменён новой дорогой';
  if (check.reason) return check.reason;
  if (r.repairing) return 'Участок уже ремонтируется';
  s.sides[side].roadRecovery = { id, paid: current?.id === id ? current.paid : 0, enabled: true };
  return true;
}

export function setRoadRecoveryEnabled(s, side, enabled) {
  if (
    s.result ||
    !validSide(s, side) ||
    typeof enabled !== 'boolean' ||
    !s.sides[side].roadRecovery
  )
    return 'Подряд недоступен';
  s.sides[side].roadRecovery.enabled = enabled;
  return true;
}

export function cancelRoadRecovery(s, side) {
  if (s.result || !validSide(s, side) || !s.sides[side].roadRecovery)
    return 'Нет подряда для отмены';
  s.sides[side].roadRecovery = null;
  return true;
}

export function updateRoadRecovery(s, dt) {
  if (s.result || !Number.isFinite(dt) || dt <= 0) return;
  for (let side = 0; side < s.sides.length; side++) {
    const quote = activeQuote(s, side);
    if (!quote) continue;
    if (quote.status === 'complete' || quote.status === 'unavailable') {
      s.sides[side].roadRecovery = null;
      continue;
    }
    if (quote.status !== 'funding') continue;
    quote.contract.paid += roadRecoveryFundingRate(s, side, dt) * dt;
    if (quote.contract.paid + 1e-8 < quote.cost) continue;
    quote.r.removed = false;
    quote.r.blocked = false;
    quote.r.hp = quote.r.maxHp || ROAD_HP;
    quote.r.repairing = false;
    s.sides[side].roadRecovery = null;
    dirtyNetwork(s);
  }
}

export function restoreRoadRecovery(s, sourceVersion = s.version) {
  for (let side = 0; side < s.sides.length; side++) {
    const f = s.sides[side],
      contract = f.roadRecovery;
    if (sourceVersion < 22) {
      f.roadRecovery = null;
      continue;
    }
    if (contract == null) {
      f.roadRecovery = null;
      continue;
    }
    const r = roadOf(s, side, contract.id);
    if (
      typeof contract !== 'object' ||
      Array.isArray(contract) ||
      !r ||
      !Number.isSafeInteger(contract.id) ||
      !Number.isFinite(contract.paid) ||
      contract.paid < 0 ||
      contract.paid > maximumCost(r) + 1e-8 ||
      typeof contract.enabled !== 'boolean' ||
      Object.keys(contract).some((key) => !['id', 'paid', 'enabled'].includes(key))
    )
      throw Error('Повреждён подряд восстановления дороги');
  }
}

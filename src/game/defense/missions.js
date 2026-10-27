import { GROUND_UNITS } from '../config.js';
import { COVER_PATCHES, coverInfo } from '../units/infantry/cover.js';
import { walkable } from '../units/ground/navigation.js';
import { corridorGeometry, defensePostPoint } from './geometry.js';
import { assignDefensePost, defenseAvailable, occupiedDefenseCarriers } from './formation.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const supported = (u) => ['sniper', 'assault', 'infantry'].includes(u.key);

function watchPoint(s, u, line, direction) {
  const edge = line.id === 'north' ? -1 : 1;
  const nominal = { x: direction * 260, z: line.depot.z + edge * 130 };
  const candidates = COVER_PATCHES.filter(
    (p) => Math.abs(p.x - nominal.x) < 300 && Math.abs(p.z - nominal.z) < 180,
  ).map((p) => ({ x: p.x, z: p.z, score: distance(p, nominal) - (p.forest ? 30 : 0) }));
  candidates.push({ ...nominal, score: 200 });
  return (
    candidates
      .sort((a, b) => a.score - b.score || a.x - b.x || a.z - b.z)
      .find(
        (p) =>
          walkable(s, p.x, p.z, GROUND_UNITS[u.key].size * 0.42) &&
          coverInfo(s, { ...u, x: p.x, z: p.z }).concealment >= 0.35,
      ) || null
  );
}

// A small reconnaissance/ambush section uses the same physical guard, supply
// and cover systems as the rest of the army. It never learns hidden targets.
export function updateDepotMissions(s, side, own, report, memory) {
  const direction = side % 2 === 0 ? 1 : -1,
    lines = corridorGeometry(s, side);
  let paths = 0;
  for (const u of own) {
    const m = u.defenseMission;
    if (!m) continue;
    if (!u.autoDefense || !u.guard || u.boardingId || u.delivery || u.routeState) {
      u.defenseMission = null;
      continue;
    }
    if (u.supplyTrip || u.order?.mode === 'cover' || s.time < m.nextThinkAt) continue;
    m.nextThinkAt = s.time + 3;
    const line = lines.find((l) => l.id === m.sectorId),
      sector = report.sectors.find((v) => v.id === m.sectorId);
    const ammo = (u.groundAmmo || 0) + (u.ammoReserve || 0);
    const danger = memory.seen.some(
      (v) => s.time - v.time < 8 && v.strength >= 2.5 && distance(v, u) < 150,
    );
    if (
      s.time >= m.until ||
      !line?.secured ||
      sector?.pressure > 1.5 ||
      u.hp / u.maxHp < 0.55 ||
      !ammo ||
      danger
    )
      m.phase = 'return';
    if (m.phase === 'return') {
      const home = u.defensePost
        ? defensePostPoint(lines, u.defensePost, direction) || m.home
        : m.home;
      if (distance(u, home) < 5 && !u.path?.length) {
        u.defenseMission = null;
        u.defenseReadyAt = s.time + 35;
        continue;
      }
      if (paths < 2 && (distance(u.guard, home) > 5 || !u.path?.length)) {
        paths++;
        if (assignDefensePost(s, u, home)) {
          m.home = { ...u.guard };
          m.point = { ...u.guard };
        }
      }
      continue;
    }
    if (m.phase === 'flank' && !u.path?.length && distance(u, u.guard) < 6 && paths < 2) {
      const point = watchPoint(s, u, line, direction);
      if (!point) {
        m.phase = 'return';
        m.nextThinkAt = s.time;
        continue;
      }
      if (point) {
        paths++;
        if (assignDefensePost(s, u, point)) {
          m.phase = 'watch';
          m.point = { ...u.guard };
        }
      }
    }
  }
  if (paths >= 2 || own.filter((u) => u.defenseMission).length >= 4) return;
  const occupied = occupiedDefenseCarriers(s);
  for (const line of lines) {
    const sector = report.sectors.find((v) => v.id === line.id);
    const local = own.filter((u) => u.autoDefense && u.defensePost?.corridorId === line.id);
    if (
      !line.secured ||
      !line.depot ||
      local.length < 12 ||
      sector?.pressure > 0.7 ||
      sector?.enemy > 0 ||
      local.some((u) => u.defenseMission)
    )
      continue;
    const candidates = local
      .filter(
        (u) =>
          supported(u) &&
          defenseAvailable(s, u, occupied) &&
          !u.defenseTask &&
          !u.defenseCapture &&
          !u.holdFire &&
          !u.camouflaged &&
          !u.guardTargetId &&
          !u.enemyId &&
          u.hp / u.maxHp > 0.8 &&
          (u.suppression || 0) < 0.15 &&
          (u.defenseReadyAt || 0) <= s.time &&
          (u.key === 'sniper' || u.defensePost.row >= 4) &&
          (u.groundAmmo || 0) + (u.ammoReserve || 0) > 0,
      )
      .sort(
        (a, b) =>
          Number(b.key === 'sniper') - Number(a.key === 'sniper') ||
          Number(b.key === 'assault') - Number(a.key === 'assault') ||
          a.id - b.id,
      );
    if (candidates.length < 2 || !candidates.some((u) => u.key === 'sniper' || u.key === 'assault'))
      continue;
    for (const u of candidates.slice(0, 2)) {
      if (paths >= 2) return;
      const edge = line.id === 'north' ? -1 : 1;
      const home = { ...u.guard };
      if (!watchPoint(s, u, line, direction)) continue;
      const point = {
        x: -direction * 60,
        z: line.depot.z + edge * (150 + (u.key === 'sniper' ? 0 : 20)),
      };
      if (!walkable(s, point.x, point.z, GROUND_UNITS[u.key].size * 0.42)) continue;
      paths++;
      if (!assignDefensePost(s, u, point)) continue;
      u.defenseMission = {
        kind: 'raid',
        phase: 'flank',
        sectorId: line.id,
        home,
        point: { ...u.guard },
        startedAt: s.time,
        until: s.time + 150,
        nextThinkAt: s.time + 3,
      };
    }
  }
}

import { GROUND_UNITS, isInfantry } from '../config.js';
import { DISTRICTS } from '../territory/districts.config.js';
import { assignGuardPost } from '../units/ground/guard.js';
import { FRONTLINE as C } from './config.js';
import { corridorGeometry, defensePostPoint, spreadOrder } from './geometry.js';
import { persistentDefensePoint } from './positions.js';
import { allied } from '../factions.js';
import { layerRanks } from './layers.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function occupiedDefenseCarriers(s) {
  const occupied = new Set();
  for (const u of s.groundUnits) {
    if (u.carrierId != null) occupied.add(u.carrierId);
    if (u.boardingId != null) occupied.add(u.boardingId);
  }
  return occupied;
}
export function defenseAvailable(s, u, occupied = null) {
  return (
    u.autoDefense &&
    (u.guard || (!u.order && !u.path?.length)) &&
    u.hp > 0 &&
    !u.downed &&
    !u.carrierId &&
    !u.boardingId &&
    !u.delivery &&
    !u.supplyTrip &&
    !u.routeState &&
    !u.defenseMission &&
    u.order?.mode !== 'cover' &&
    !GROUND_UNITS[u.key]?.support &&
    !u.civil &&
    !(occupied
      ? occupied.has(u.id)
      : s.groundUnits.some((v) => v.carrierId === u.id || v.boardingId === u.id))
  );
}
export function assignDefensePost(s, u, point, snap = false) {
  const stance = u.stance ?? null;
  const destination = persistentDefensePoint(s, u, point);
  if (!assignGuardPost(s, u, destination, snap, { preserveDefense: true })) return false;
  u.stance = stance;
  return true;
}

function assignedCorridor(u, lines) {
  if (lines.some((line) => line.id === u.defensePost?.corridorId)) return u.defensePost.corridorId;
  if (!u.guard) return null;
  let closest = null;
  for (const line of lines)
    if (
      !closest ||
      (Math.abs(line.z - u.guard.z) - Math.abs(closest.z - u.guard.z) ||
        line.id.localeCompare(closest.id)) < 0
    )
      closest = line;
  return closest?.id ?? null;
}

function corridorCounts(own, lines, key = null) {
  const result = new Map(lines.map((line) => [line.id, 0]));
  for (const u of own) {
    if (!u.autoDefense || u.hp <= 0 || (u.defenseTask && !u.defensePost) || (key && u.key !== key))
      continue;
    const id = assignedCorridor(u, lines);
    if (id) result.set(id, result.get(id) + 1);
  }
  return result;
}

function nearestPendingForFront(s, seed, pending, own, lines) {
  const roles = corridorCounts(own, lines, seed.key),
    totals = corridorCounts(own, lines);
  const preferred = lines
    .slice()
    .sort(
      (a, b) =>
        roles.get(a.id) - roles.get(b.id) ||
        totals.get(a.id) - totals.get(b.id) ||
        distance(seed, a) - distance(seed, b) ||
        a.id.localeCompare(b.id),
    )[0];
  let chosen = null,
    best = Infinity;
  // Keep the role/front quotas, but fill that quota with the same-role soldier
  // already nearest to it. ID-grouped selections must not swap two whole
  // platoons between the north and south just to alternate assignments.
  for (const u of pending) {
    if (u.key !== seed.key || u.defensePost || u.defenseTask || (u.defenseReadyAt || 0) > s.time)
      continue;
    const range = distance(u, preferred);
    if (range < best || (range === best && u.id < chosen?.id)) {
      chosen = u;
      best = range;
    }
  }
  return chosen;
}

function postCandidates(u, own, volunteers, lines, direction, corridorId = null) {
  const occupied = new Set(),
    rows = new Map();
  for (const v of own) {
    const ref = v.id === u.id ? null : v.defensePost;
    if (!ref) continue;
    occupied.add(`${ref.corridorId}:${ref.row}:${ref.slot}`);
    const row = `${ref.corridorId}:${ref.row}`;
    rows.set(row, (rows.get(row) || 0) + 1);
  }
  const roleCounts = corridorCounts(own, lines, u.key),
    totalCounts = corridorCounts(own, lines);
  const ranks = new Map(lines.map((line) => [line.id, layerRanks(u, line, volunteers)]));
  const orders = new Map(
    lines.map((line) => [line.id, spreadOrder(line.slots.length, volunteers.length < 4)]),
  );
  const pool = [];
  for (let row = isInfantry(u.key) ? 0 : 1; row < C.maxRows; row += 2)
    for (const line of lines) {
      if (corridorId && line.id !== corridorId) continue;
      const order = orders.get(line.id);
      for (let rank = 0; rank < order.length; rank++) {
        const slot = order[rank];
        if (occupied.has(`${line.id}:${row}:${slot}`)) continue;
        const reference = { corridorId: line.id, slot, row };
        const point = defensePostPoint(lines, reference, direction);
        pool.push({
          reference,
          point,
          rank,
          count: rows.get(`${line.id}:${row}`) || 0,
          roleCount: roleCounts.get(line.id),
          totalCount: totalCounts.get(line.id),
          layerRank: ranks.get(line.id).get(row),
          coreDistance: line.depot && row > 0 && row < 4 ? Math.abs(point.z - line.depot.z) : 0,
          distance: distance(point, u),
        });
      }
    }
  return pool.sort(
    (a, b) =>
      a.roleCount - b.roleCount ||
      a.totalCount - b.totalCount ||
      a.layerRank - b.layerRank ||
      a.coreDistance - b.coreDistance ||
      a.count - b.count ||
      a.rank - b.rank ||
      a.distance - b.distance ||
      a.reference.corridorId.localeCompare(b.reference.corridorId),
  );
}

// One bounded planning pulse, never a per-frame all-army repath.
export function updateDefenseFormation(s, side, own) {
  const direction = side % 2 === 0 ? 1 : -1,
    lines = corridorGeometry(s, side),
    occupiedCarriers = occupiedDefenseCarriers(s);
  let attempts = 0,
    issued = 0;
  for (const u of own) {
    if (!u.autoDefense) {
      u.defensePost = null;
      u.defenseCapture = null;
      continue;
    }
    if (!defenseAvailable(s, u, occupiedCarriers) || u.defenseTask) continue;
    if (u.defenseCapture) {
      const site = s.districts.find((v) => v.id === u.defenseCapture.districtId);
      if (site && !allied(s, site.owner, side)) continue;
      const line = lines.find((v) => v.id === u.defensePost?.corridorId);
      // A capturing section becomes the inner garrison instead of abandoning
      // the circle immediately after the flag changes.
      if (line && isInfantry(u.key)) {
        const used = new Set(
          own
            .filter(
              (v) =>
                v.id !== u.id && v.defensePost?.corridorId === line.id && v.defensePost.row === 2,
            )
            .map((v) => v.defensePost.slot),
        );
        const slot = line.slots
          .filter((v) => !used.has(v.slot))
          .sort(
            (a, b) => Math.abs(a.z - u.guard.z) - Math.abs(b.z - u.guard.z) || a.slot - b.slot,
          )[0];
        if (slot) u.defensePost = { corridorId: line.id, row: 2, slot: slot.slot };
      }
      u.defenseCapture = null;
    }
    if (!u.defensePost) continue;
    const point = defensePostPoint(lines, u.defensePost, direction);
    if (
      point &&
      distance(point, u.guard) > 24 &&
      attempts < C.maxPathAttempts &&
      issued < C.maxNewAssignments
    ) {
      attempts++;
      if (assignDefensePost(s, u, point)) issued++;
    }
  }
  const volunteers = own.filter((u) => defenseAvailable(s, u, occupiedCarriers));
  const assignFromPool = (u, corridorId = null) => {
    const perCorridor = new Map();
    for (const candidate of postCandidates(u, own, volunteers, lines, direction, corridorId)) {
      if (attempts >= C.maxPathAttempts || issued >= C.maxNewAssignments) break;
      const id = candidate.reference.corridorId;
      // A blocked preferred crossing must not consume every route attempt and
      // permanently starve an accessible secondary front.
      if ((perCorridor.get(id) || 0) >= 2) continue;
      if (
        own.some(
          (v) =>
            v.id !== u.id &&
            v.guard &&
            distance(v.guard, candidate.point) <
              (GROUND_UNITS[u.key].size + GROUND_UNITS[v.key].size) * 0.5 + 7,
        )
      )
        continue;
      attempts++;
      perCorridor.set(id, (perCorridor.get(id) || 0) + 1);
      if (!assignDefensePost(s, u, candidate.point)) continue;
      u.defensePost = candidate.reference;
      issued++;
      return true;
    }
    return false;
  };
  // Existing armies need an inner garrison too, not only newly recruited
  // soldiers. Borrow one quiet outer post at a time, retaining four approaches.
  for (const line of lines) {
    if (!line.secured || issued >= C.maxNewAssignments || attempts >= C.maxPathAttempts) continue;
    const local = volunteers.filter(
      (u) =>
        u.defensePost?.corridorId === line.id &&
        isInfantry(u.key) &&
        !u.defenseTask &&
        !u.defenseCapture,
    );
    if (
      local.length < 6 ||
      local.filter((u) => u.defensePost.row === 2).length >= 2 ||
      local.filter((u) => u.defensePost.row === 0).length <= 4
    )
      continue;
    const donor = local
      .filter(
        (u) =>
          u.defensePost.row === 0 &&
          !u.guardTargetId &&
          !u.enemyId &&
          (u.suppression || 0) < 0.3 &&
          !(s.frontlineMemory?.[side]?.seen || []).some(
            (v) => s.time - v.time < 8 && distance(v, u.guard) < 600,
          ),
      )
      .sort((a, b) => distance(a, line.depot) - distance(b, line.depot) || a.id - b.id)[0];
    if (donor) assignFromPool(donor, line.id);
  }
  // A lost primary position is filled from a spare row, never by moving its sole neighbour.
  // This keeps a casualty from creating a permanent hole after all initial assignments are done.
  for (const line of lines)
    for (const slot of line.slots) {
      if (issued >= C.maxNewAssignments || attempts >= C.maxPathAttempts) break;
      if (
        volunteers.some(
          (u) =>
            u.defensePost?.corridorId === line.id &&
            u.defensePost.slot === slot.slot &&
            u.defensePost.row === 0,
        )
      )
        continue;
      if (own.some((u) => u.guard && !u.autoDefense && distance(u.guard, slot) <= 12)) continue;
      const spare = volunteers
        .filter(
          (u) =>
            u.defensePost?.corridorId === line.id &&
            u.defensePost.row >= 4 &&
            isInfantry(u.key) &&
            u.key !== 'mog' &&
            !u.defenseTask &&
            !u.defenseCapture &&
            !u.guardTargetId,
        )
        .sort((a, b) => distance(a, slot) - distance(b, slot) || a.id - b.id)[0];
      if (!spare) continue;
      attempts++;
      if (assignDefensePost(s, spare, slot)) {
        spare.defensePost = { corridorId: line.id, slot: slot.slot, row: 0 };
        issued++;
      }
    }
  const pending = volunteers
    .filter((u) => !u.defensePost && !u.defenseTask && (u.defenseReadyAt || 0) <= s.time)
    .sort((a, b) => a.id - b.id);
  const pendingStart = pending.length
    ? (Math.floor(s.time / C.cadence) * C.maxPathAttempts) % pending.length
    : 0;
  for (let inspected = 0; inspected < Math.min(pending.length, C.maxPathAttempts); inspected++) {
    if (issued >= C.maxNewAssignments || attempts >= C.maxPathAttempts) break;
    const seed = pending[(pendingStart + inspected) % pending.length];
    if (seed.defensePost || seed.defenseTask) continue;
    const u = nearestPendingForFront(s, seed, pending, own, lines);
    if (!u) continue;
    const before = attempts;
    if (!assignFromPool(u) && attempts > before) u.defenseReadyAt = s.time + 5;
  }
  // Repair already-running saves too: move quiet spare rows a few at a time,
  // without shifting manual posts or hollowing out the primary firing line.
  for (const key of [...new Set(volunteers.map((u) => u.key))].sort()) {
    if (issued >= C.maxNewAssignments || attempts >= C.maxPathAttempts || lines.length < 2) break;
    const counts = corridorCounts(own, lines, key);
    const ordered = lines
      .slice()
      .sort((a, b) => counts.get(a.id) - counts.get(b.id) || a.id.localeCompare(b.id));
    const low = ordered[0],
      high = ordered.at(-1);
    if (counts.get(high.id) - counts.get(low.id) < 2) continue;
    const donor = volunteers
      .filter(
        (u) =>
          u.key === key &&
          u.defensePost?.corridorId === high.id &&
          u.defensePost.row > 0 &&
          !u.defenseTask &&
          !u.defenseCapture &&
          !u.guardTargetId &&
          !u.enemyId &&
          !(s.frontlineMemory?.[side]?.seen || []).some(
            (v) => s.time - v.time < 8 && distance(v, u.guard) < 600,
          ) &&
          (u.suppression || 0) < 0.3 &&
          (u.defenseReadyAt || 0) <= s.time,
      )
      .sort(
        (a, b) =>
          b.defensePost.row - a.defensePost.row ||
          distance(a, low) - distance(b, low) ||
          a.id - b.id,
      )[0];
    if (donor) assignFromPool(donor, low.id);
  }
  // Public depot ownership is the shared objective, including a hostile flag:
  // losing it triggers a real counterattack rather than permanent inactivity.
  const captureBudget = Math.min(C.captureLimit, Math.max(1, Math.floor(volunteers.length / 3)));
  let capturing = volunteers.filter((u) => u.defenseCapture).length;
  for (const line of lines) {
    if (
      capturing >= captureBudget ||
      attempts >= C.maxPathAttempts ||
      issued >= C.maxNewAssignments
    )
      break;
    const d = DISTRICTS.find((v) => v.id === line.districtId),
      site = s.districts.find((v) => v.id === line.districtId);
    if (!d || !site || allied(s, site.owner, side)) continue;
    let assigned = volunteers.filter((u) => u.defenseCapture?.districtId === d.id).length;
    const candidates = volunteers
      .filter(
        (u) =>
          u.defensePost?.corridorId === line.id &&
          !u.defenseTask &&
          !u.defenseCapture &&
          ['infantry', 'machinegunner', 'assault', 'engineer'].includes(u.key) &&
          !u.guardTargetId &&
          !u.enemyId &&
          (u.suppression || 0) < 0.45,
      )
      .sort(
        (a, b) =>
          Number(b.key === 'assault') - Number(a.key === 'assault') ||
          distance(a, d) - distance(b, d) ||
          a.id - b.id,
      );
    for (const u of candidates) {
      if (
        assigned >=
          Math.min(
            C.capturePerSite,
            Math.max(
              1,
              Math.floor(
                volunteers.filter((v) => v.defensePost?.corridorId === line.id).length / 4,
              ),
            ),
          ) ||
        capturing >= captureBudget ||
        attempts >= C.maxPathAttempts ||
        issued >= C.maxNewAssignments
      )
        break;
      attempts++;
      // Unique points stay inside the capture circle, not an overcrowded rally blob.
      const point = {
        x: d.x - direction * (18 + Math.floor(assigned / 2) * 14),
        z: d.z + (assigned % 2 ? 16 : -16),
      };
      if (!assignDefensePost(s, u, point)) continue;
      u.defenseCapture = { districtId: d.id, assignedAt: s.time };
      assigned++;
      capturing++;
      issued++;
    }
  }
}

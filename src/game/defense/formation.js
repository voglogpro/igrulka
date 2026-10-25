import { GROUND_UNITS, isInfantry } from '../config.js';
import { DISTRICTS } from '../territory/districts.config.js';
import { assignGuardPost } from '../units/ground/guard.js';
import { FRONTLINE as C } from './config.js';
import { corridorGeometry, defensePostPoint, spreadOrder } from './geometry.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function defenseAvailable(s, u) {
  return (
    u.autoDefense &&
    (u.guard || (!u.order && !u.path?.length)) &&
    u.hp > 0 &&
    !u.downed &&
    !u.carrierId &&
    !u.boardingId &&
    !u.delivery &&
    !u.routeState &&
    !GROUND_UNITS[u.key]?.support &&
    !u.civil &&
    !s.groundUnits.some((v) => v.carrierId === u.id || v.boardingId === u.id)
  );
}
export function assignDefensePost(s, u, point, snap = false) {
  const stance = u.stance ?? null;
  if (!assignGuardPost(s, u, point, snap, { preserveDefense: true })) return false;
  u.stance = stance;
  return true;
}

// One bounded planning pulse, never a per-frame all-army repath.
export function updateDefenseFormation(s, side, own) {
  const direction = side % 2 === 0 ? 1 : -1,
    lines = corridorGeometry(s, side);
  let attempts = 0,
    issued = 0;
  for (const u of own) {
    if (!u.autoDefense) {
      u.defensePost = null;
      u.defenseCapture = null;
      continue;
    }
    if (!defenseAvailable(s, u) || u.defenseTask) continue;
    if (u.defenseCapture) {
      const site = s.districts.find((v) => v.id === u.defenseCapture.districtId);
      if (site?.owner !== side && site?.owner == null && site?.hp > 0) continue;
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
  const volunteers = own.filter((u) => defenseAvailable(s, u));
  const refs = () => volunteers.filter((u) => u.defensePost).map((u) => u.defensePost);
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
            u.defensePost.row > 0 &&
            isInfantry(u.key) &&
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
  for (const u of volunteers
    .filter((u) => !u.defensePost && (u.defenseReadyAt || 0) <= s.time)
    .sort((a, b) => a.id - b.id)) {
    if (issued >= C.maxNewAssignments || attempts >= C.maxPathAttempts) break;
    const occupied = refs(),
      pool = [];
    const startRow = isInfantry(u.key) ? 0 : 1;
    for (let row = startRow; row < C.maxRows; row += 2)
      for (const line of lines) {
        const order = spreadOrder(line.slots.length, volunteers.length < 4);
        for (const slot of order) {
          if (occupied.some((v) => v.corridorId === line.id && v.row === row && v.slot === slot))
            continue;
          const reference = { corridorId: line.id, slot, row };
          const point = defensePostPoint(lines, reference, direction);
          pool.push({
            reference,
            point,
            rank: order.indexOf(slot),
            count: occupied.filter((v) => v.corridorId === line.id && v.row === row).length,
          });
        }
      }
    pool.sort(
      (a, b) =>
        a.reference.row - b.reference.row ||
        a.count - b.count ||
        a.rank - b.rank ||
        distance(a.point, u) - distance(b.point, u) ||
        a.reference.corridorId.localeCompare(b.reference.corridorId),
    );
    let accepted = false;
    for (const candidate of pool) {
      if (attempts >= C.maxPathAttempts) break;
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
      if (!assignDefensePost(s, u, candidate.point)) continue;
      u.defensePost = candidate.reference;
      issued++;
      accepted = true;
      break;
    }
    if (!accepted) u.defenseReadyAt = s.time + 5;
  }
  // Only the nearest home-side neutral resource anchors are economic objectives.
  // Public ownership is used; hidden enemy positions are never consulted here.
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
    if (!d || site?.owner != null || site?.hp <= 0) continue;
    let assigned = volunteers.filter((u) => u.defenseCapture?.districtId === d.id).length;
    const candidates = volunteers
      .filter(
        (u) =>
          u.defensePost?.corridorId === line.id &&
          !u.defenseTask &&
          !u.defenseCapture &&
          isInfantry(u.key) &&
          (u.suppression || 0) < 0.45,
      )
      .sort((a, b) => distance(a, d) - distance(b, d) || a.id - b.id);
    for (const u of candidates) {
      if (
        assigned >= C.capturePerSite ||
        capturing >= captureBudget ||
        attempts >= C.maxPathAttempts ||
        issued >= C.maxNewAssignments
      )
        break;
      attempts++;
      // Unique points stay inside the capture circle, not an overcrowded rally blob.
      const point = { x: d.x - direction * 18, z: d.z + (assigned ? 14 : -14) };
      if (!assignDefensePost(s, u, point)) continue;
      u.defenseCapture = { districtId: d.id, assignedAt: s.time };
      assigned++;
      capturing++;
      issued++;
    }
  }
}

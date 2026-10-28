// Game-space shelter dimensions shared by cover, assignment and the renderer.
// Long axis is local X, perpendicular to the soldier's forward local Z.
export const TRENCH_FOOTPRINT = Object.freeze({
  length: 18,
  halfCore: 6.8,
  halfWidth: 2.2,
  queryRadius: 9,
  slotOffsets: Object.freeze([-6, 0, 6]),
});

export function trenchDistance(t, x, z) {
  const yaw = t.yaw || 0,
    c = Math.cos(yaw),
    n = Math.sin(yaw),
    dx = x - t.x,
    dz = z - t.z,
    along = dx * c - dz * n,
    across = dx * n + dz * c;
  return Math.hypot(Math.max(0, Math.abs(along) - TRENCH_FOOTPRINT.halfCore), across);
}

export const trenchContains = (t, x, z, margin = 0) =>
  trenchDistance(t, x, z) < TRENCH_FOOTPRINT.halfWidth + margin;

export function trenchSlotPoint(t, index) {
  const along = TRENCH_FOOTPRINT.slotOffsets[index];
  if (along == null) return null;
  const yaw = t.yaw || 0;
  return { x: t.x + Math.cos(yaw) * along, z: t.z - Math.sin(yaw) * along };
}

const PIECE_LENGTH = 6;
// Distance from a post centre to its capsule boundary along this actual link.
export function trenchEndTrim(post, dx, dz) {
  const yaw = post.yaw || 0,
    along = Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)),
    across = Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw)),
    { halfCore, halfWidth } = TRENCH_FOOTPRINT;
  if (across > 0 && halfWidth * along <= halfCore * across) return halfWidth / across;
  return halfCore * along + Math.sqrt(Math.max(0, halfWidth ** 2 - halfCore ** 2 * across ** 2));
}

// Keep terrain-sized pieces hidden inside a visibly continuous long section.
function buildTrenchRenderPieces(a, b) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    length = Math.hypot(dx, dz);
  if (!(length > 0)) return [];
  const start = trenchEndTrim(a, dx / length, dz / length),
    end = length - trenchEndTrim(b, -dx / length, -dz / length),
    usable = end - start;
  if (!(usable > 0)) return [];
  let sections = Math.max(1, Math.ceil((usable + 2) / 22));
  if ((usable - 2 * (sections - 1)) / sections < 15 && sections > 1) sections--;
  const section = Math.min(20, (usable - 2 * (sections - 1)) / sections),
    gap = sections > 1 ? (usable - section * sections) / (sections - 1) : 0,
    margin = sections === 1 ? (usable - section) / 2 : 0,
    result = [];
  const append = (from, to, narrow) => {
    if (!(to > from)) return;
    const count = Math.ceil((to - from) / PIECE_LENGTH);
    for (let i = 0; i < count; i++)
      result.push({
        from: from + ((to - from) * i) / count,
        to: from + ((to - from) * (i + 1)) / count,
        narrow,
      });
  };
  append(start, start + margin, true);
  for (let i = 0; i < sections; i++) {
    const from = start + margin + i * (section + gap);
    append(from, from + section, section < 15);
    if (i < sections - 1) append(from + section, from + section + gap, true);
  }
  append(end - margin, end, true);
  return result;
}

const linkLayouts = new WeakMap();
// Endpoints stay public records. Pose snapshots invalidate without a per-query array or scan.
export function trenchRenderPieces(a, b) {
  let byEnd = linkLayouts.get(a);
  if (!byEnd) linkLayouts.set(a, (byEnd = new WeakMap()));
  let layout = byEnd.get(b);
  if (
    !layout ||
    layout.ax !== a.x ||
    layout.az !== a.z ||
    layout.ayaw !== (a.yaw || 0) ||
    layout.bx !== b.x ||
    layout.bz !== b.z ||
    layout.byaw !== (b.yaw || 0)
  ) {
    layout = {
      ax: a.x,
      az: a.z,
      ayaw: a.yaw || 0,
      bx: b.x,
      bz: b.z,
      byaw: b.yaw || 0,
      pieces: buildTrenchRenderPieces(a, b),
    };
    byEnd.set(b, layout);
  }
  return layout.pieces;
}

// Full firing sections and their low, narrow walkways share exactly the visible layout.
export function trenchLinkCoverFactor(a, b, x, z) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    length = Math.hypot(dx, dz);
  if (!(length > 0)) return 0;
  const along = ((x - a.x) * dx + (z - a.z) * dz) / length;
  const across = Math.abs((x - a.x) * dz - (z - a.z) * dx) / length;
  if (across >= TRENCH_FOOTPRINT.halfWidth) return 0;
  let factor = 0;
  for (const piece of trenchRenderPieces(a, b)) {
    if (along < piece.from || along > piece.to) continue;
    if (!piece.narrow) return 1;
    if (across < 0.99) factor = 0.45;
  }
  return factor;
}

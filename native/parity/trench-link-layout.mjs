import { trenchRenderPieces } from '../../src/game/defense/trench-footprint.js';

const layouts = new WeakMap();
const EMPTY = new Map();
const CELL = 32;
const EMPTY_IDS = Object.freeze([]);
const cellKey = (x, z) => x * 65536 + z;
function changed(source, snapshot) {
  if (source.size !== snapshot.size) return true;
  for (const [id, record] of source) if (snapshot.get(id) !== record) return true;
  return false;
}
const LINK_FIELDS = ['ax', 'az', 'bx', 'bz', 'ayaw', 'byaw', 'level', 'side'];
function sameLinkPose(a, b) {
  return !!a && !!b && LINK_FIELDS.every((field) => a[field] === b[field]);
}
function changedLinks(source, snapshot) {
  if (source.size !== snapshot.size) return true;
  for (const [id, record] of source) if (!sameLinkPose(record, snapshot.get(id))) return true;
  return false;
}
function addToBuckets(buckets, record, id) {
  const c = Math.abs(Math.cos(record.yaw || 0));
  const s = Math.abs(Math.sin(record.yaw || 0));
  const halfLength = 9 * (record.stretch || 1) * Math.cos(record.roll || 0);
  const halfWidth = 2.2 * (record.widthScale || 1);
  const ex = halfLength * c + halfWidth * s,
    ez = halfLength * s + halfWidth * c;
  for (let z = Math.floor((record.z - ez) / CELL); z <= Math.floor((record.z + ez) / CELL); z++)
    for (let x = Math.floor((record.x - ex) / CELL); x <= Math.floor((record.x + ex) / CELL); x++) {
      const key = cellKey(x, z);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(id);
    }
}
function sourceConnectors(world, records, previous = new Map()) {
  const result = [];
  const byLink = new Map();
  if (!records.size) return { result, byLink };
  const height =
    world.fortifications?.links?.height ||
    (typeof world.height === 'function' ? world.height.bind(world) : () => 0);
  for (const [linkId, record] of records) {
    const cached = previous.get(linkId);
    if (sameLinkPose(cached?.record, record)) {
      byLink.set(linkId, cached);
      result.push(...cached.pieces);
      continue;
    }
    const linkPieces = [];
    const dx = record.bx - record.ax,
      dz = record.bz - record.az;
    const length = Math.hypot(dx, dz);
    if (!(length > 0)) continue;
    const pieces = trenchRenderPieces(record.a, record.b);
    for (const [index, piece] of pieces.entries()) {
      const ax = record.ax + (dx * piece.from) / length;
      const az = record.az + (dz * piece.from) / length;
      const bx = record.ax + (dx * piece.to) / length;
      const bz = record.az + (dz * piece.to) / length;
      const ay = Math.max(0, height(ax, az)),
        by = Math.max(0, height(bx, bz));
      const flat = Math.hypot(bx - ax, bz - az);
      if (!(flat > 0)) continue;
      linkPieces.push({
        id: `trench-link:${linkId}:${index}`,
        linkId,
        ax,
        az,
        bx,
        bz,
        x: (ax + bx) / 2,
        z: (az + bz) / 2,
        y: (ay + by) / 2 + 0.09,
        yaw: -Math.atan2(bz - az, bx - ax),
        roll: Math.atan2(by - ay, flat),
        stretch: Math.hypot(flat, by - ay) / 18,
        level: record.level,
        side: record.side,
        progress: 1,
        connector: true,
        widthScale: piece.narrow ? 0.45 : 1,
        rampStart: index === 0,
        rampEnd: index === pieces.length - 1,
      });
    }
    byLink.set(linkId, { record, pieces: linkPieces });
    result.push(...linkPieces);
  }
  return { result, byLink };
}
// Refresh exactly once from the actual captured visual scene. Animation lookups
// consume the prepared indexes and never scan every trench/link for each member.
export function presentationTrenchLayout(world, refresh = false) {
  const models = world.fortifications?.models || EMPTY;
  const links = world.fortifications?.links?.records || EMPTY;
  let layout = layouts.get(world);
  if (!layout || layout.owner !== world.fortifications) {
    layout = {
      owner: world.fortifications,
      revision: 0,
      sectionsRevision: 0,
      linksRevision: 0,
      sectionRefs: new Map(),
      linkRefs: new Map(),
      sections: [],
      connectors: [],
      sectionBuckets: new Map(),
      linkBuckets: new Map(),
      connectorsById: new Map(),
      sourceLinkPieces: new Map(),
      sectionsById: new Map(),
      sectionShapes: new Map(),
      buckets: new Map(),
      minY: 0,
      maxY: 0,
      sectionMinY: 0,
      sectionMaxY: 0,
      linkMinY: 0,
      linkMaxY: 0,
      initialized: false,
    };
    layouts.set(world, layout);
    refresh = true;
  }
  if (!refresh) return layout;
  const sectionsChanged = !layout.initialized || changed(models, layout.sectionRefs);
  const linksChanged = !layout.initialized || changedLinks(links, layout.linkRefs);
  if (!sectionsChanged && !linksChanged) return layout;
  if (sectionsChanged) {
    layout.sectionsRevision++;
    layout.sectionRefs = new Map(models);
    layout.sections = Array.from(models, ([id, record]) => ({ id, ...record }));
    layout.sectionsById = new Map(layout.sections.map((record) => [record.id, record]));
    const shapes = new Map(
      Array.from(models, ([id, record]) => [
        id,
        [record.x, record.z, record.yaw, record.roll, record.stretch].join('/'),
      ]),
    );
    if (changed(shapes, layout.sectionShapes)) {
      layout.sectionShapes = shapes;
      layout.sectionBuckets.clear();
      for (const [id, record] of models) addToBuckets(layout.sectionBuckets, record, id);
      layout.rebuildBuckets = true;
    }
  }
  if (linksChanged) {
    layout.linksRevision++;
    layout.linkRefs = new Map(links);
    const generated = sourceConnectors(world, links, layout.sourceLinkPieces);
    layout.connectors = generated.result;
    layout.sourceLinkPieces = generated.byLink;
    layout.connectorsById = new Map(layout.connectors.map((record) => [record.id, record]));
    layout.linkBuckets.clear();
    for (const record of layout.connectors) addToBuckets(layout.linkBuckets, record, record.id);
    layout.rebuildBuckets = true;
  }
  if (layout.rebuildBuckets) {
    layout.buckets.clear();
    for (const [key, ids] of layout.sectionBuckets) layout.buckets.set(key, ids.slice());
    for (const [key, ids] of layout.linkBuckets) {
      if (!layout.buckets.has(key)) layout.buckets.set(key, []);
      layout.buckets.get(key).push(...ids);
    }
    layout.rebuildBuckets = false;
  }
  for (const [modified, records, prefix] of [
    [sectionsChanged, layout.sections, 'section'],
    [linksChanged, layout.connectors, 'link'],
  ]) {
    if (!modified) continue;
    let minY = Infinity,
      maxY = -Infinity;
    for (const record of records) {
      const rise = 9 * (record.stretch || 1) * Math.abs(Math.sin(record.roll || 0));
      minY = Math.min(minY, (record.y || 0) - rise - 2);
      maxY = Math.max(maxY, (record.y || 0) + rise + 2);
    }
    layout[prefix + 'MinY'] = minY;
    layout[prefix + 'MaxY'] = maxY;
  }
  layout.minY = Math.min(layout.sectionMinY, layout.linkMinY);
  layout.maxY = Math.max(layout.sectionMaxY, layout.linkMaxY);
  if (!Number.isFinite(layout.minY)) layout.minY = layout.maxY = 0;
  layout.initialized = true;
  layout.revision++;
  return layout;
}
export function drawingRecord(layout, id) {
  return (
    layout.sectionsById.get(id) ||
    layout.sectionsById.get(Number(id)) ||
    layout.connectorsById.get(id)
  );
}
export function drawingIdsAt(layout, x, z) {
  return layout.buckets.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY_IDS;
}
export function drawingRecordsAlongRay(layout, ray) {
  if (Math.abs(ray.direction.y) < 1e-5) return [];
  const near = Math.max(0, (layout.maxY - ray.origin.y) / ray.direction.y);
  const far = Math.max(0, (layout.minY - ray.origin.y) / ray.direction.y);
  const from = Math.min(near, far),
    to = Math.max(near, far);
  const horizontal = Math.hypot(ray.direction.x, ray.direction.z) * (to - from);
  const steps = Math.max(1, Math.ceil(horizontal / (CELL * 0.5)));
  const ids = new Set();
  for (let i = 0; i <= steps; i++) {
    const distance = from + ((to - from) * i) / steps;
    const cellX = Math.floor((ray.origin.x + ray.direction.x * distance) / CELL);
    const cellZ = Math.floor((ray.origin.z + ray.direction.z * distance) / CELL);
    // Neighbours cover a short corner crossing between consecutive ray samples.
    for (let z = cellZ - 1; z <= cellZ + 1; z++)
      for (let x = cellX - 1; x <= cellX + 1; x++) {
        const key = cellKey(x, z);
        for (const id of layout.sectionBuckets.get(key) || []) ids.add(id);
        for (const id of layout.linkBuckets.get(key) || []) ids.add(id);
      }
  }
  return Array.from(ids, (id) => drawingRecord(layout, id));
}

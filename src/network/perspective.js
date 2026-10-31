import { groundVisible } from '../game/units/infantry/cover.js';
import { unitVisible } from '../game/visibility.js';
import { sideIds, validSide, allied, teamOf } from '../game/factions.js';

function publicFields(item, fields) {
  const result = {};
  for (const key of fields) if (Object.hasOwn(item, key)) result[key] = item[key];
  return result;
}

const groundFields = [
  'id',
  'side',
  'key',
  'x',
  'y',
  'z',
  'prevX',
  'prevY',
  'prevZ',
  'hp',
  'maxHp',
  'progress',
  'yaw',
  'moving',
  'heat',
  'level',
  'setup',
  'suppression',
  'lastFire',
  'digging',
  'trenchId',
  'camouflaged',
  'targetX',
  'targetY',
  'targetZ',
  'groundAmmo',
  'groundReload',
  'downed',
];
const buildingFields = [
  'settlementId',
  'settlementSlot',
  'id',
  'side',
  'key',
  'x',
  'z',
  'hp',
  'maxHp',
  'progress',
  'rotation',
  'demolished',
  'fire',
  'level',
  'heat',
  'targetX',
  'targetY',
  'targetZ',
  'ammo',
  'groundAmmo',
  'groundReload',
  'reloadLeft',
  'repairing',
];
const aircraftFields = [
  'id',
  'side',
  'key',
  'subtype',
  'x',
  'y',
  'z',
  'prevX',
  'prevY',
  'prevZ',
  'hp',
  'maxHp',
  'delay',
  'status',
  'vx',
  'vy',
  'vz',
  'phase',
  'travelled',
  'spin',
  'fallAge',
  'missingWing',
  'launched',
];
const projectileFields = [
  'id',
  'side',
  'kind',
  'domain',
  'tracer',
  'x',
  'y',
  'z',
  'px',
  'py',
  'pz',
  'vx',
  'vy',
  'vz',
  'speed',
  'life',
  'maxLife',
  'tx',
  'tz',
  'flight',
  'originY',
  'gravity',
  'arc',
  'loft',
  'endY',
];

// Civil service traffic has public positions like buildings and roads. Tasks, route
// caches and station scheduling remain private even if new fleet fields are added.
const serviceFields = ['id', 'side', 'x', 'z', 'yaw', 'state', 'stationId'];
// Merchant ships are seen on the water; their cargo and trade decisions are private.
const shipFields = ['id', 'side', 'portId', 'x', 'z', 'yaw', 'state'];
const collisionHistory = new Set(['prevX', 'prevY', 'prevZ', 'px', 'py', 'pz']);
const transportGroundFields = groundFields.filter((key) => !collisionHistory.has(key));
const transportAircraftFields = aircraftFields.filter((key) => !collisionHistory.has(key));
const transportProjectileFields = [
  ...projectileFields.filter((key) => !collisionHistory.has(key)),
  'originX',
  'originZ',
  'shooterKey',
];
function withoutCollisionHistory(item) {
  for (const field of collisionHistory) {
    if (!Object.hasOwn(item, field)) continue;
    const value = { ...item };
    for (const key of collisionHistory) delete value[key];
    return value;
  }
  return item;
}

// The UI always calls its own faction 0. World coordinates and entity IDs stay unchanged.
function projectView(authority, side, compact, detached = true) {
  if (!validSide(authority, side)) throw Error('Некорректная сторона игрока');
  const owners = sideIds(authority),
    order = owners.length === 4 ? [side, side ^ 1, side ^ 2, side ^ 3] : [side, 1 - side],
    remap = (owner) => (validSide(authority, owner) ? order.indexOf(owner) : owner);
  // Select/redact first: enemy routes, queues, AI and discarded caches must not
  // be traversed just to throw them away. Detach the permitted tree once below,
  // before ownership remapping or any mutation of its nested records.
  let view = { ...authority };
  view.frontlineDirections = order.map((owner) => (owner % 2 ? -1 : 1));
  const allGround = new Set(authority.groundUnits.map((u) => u.id));
  const buildings = new Set(authority.buildings.map((b) => b.id));
  const visible = new Set(
    authority.groundUnits
      .filter((u) => allied(authority, side, u.side) || groundVisible(authority, side, u))
      .map((u) => u.id),
  );

  view.groundUnits = view.groundUnits
    .filter((u) => visible.has(u.id))
    .map((u) =>
      u.side === side
        ? compact
          ? withoutCollisionHistory(u)
          : u
        : publicFields(u, compact ? transportGroundFields : groundFields),
    );
  view.buildings = view.buildings.map((b) =>
    b.side === side ? b : publicFields(b, buildingFields),
  );
  view.trenches = (view.trenches || []).map((t) =>
    t.side === side
      ? t
      : publicFields(t, ['id', 'side', 'x', 'z', 'yaw', 'progress', 'fortificationWork']),
  );
  view.groundScars ||= [];
  view.frontlineMemory = owners.map((owner) => {
    const memory = authority.frontlineMemory?.[owner];
    return owner === side && memory
      ? {
          nextThink: memory.nextThink,
          nextReinforce: memory.nextReinforce,
          seen: memory.seen.map((v) => publicFields(v, ['id', 'x', 'z', 'strength', 'time'])),
        }
      : { nextThink: 0, seen: [] };
  });
  // Derived overlays are calculated from the permitted memory, never copied from imported state.
  delete view.frontlineReport;
  delete view.frontlineReports;
  view.units = view.units
    .filter((u) => u.side === side || (u.launched !== false && unitVisible(authority, side, u)))
    .map((u) => {
      if (u.side === side) return compact ? withoutCollisionHistory(u) : u;
      const publicUnit = publicFields(u, compact ? transportAircraftFields : aircraftFields);
      // The aircraft heading is visible, but its future target and route are private.
      publicUnit.tx = u.x + (u.vx || 0);
      publicUnit.tz = u.z + (u.vz || 0);
      return publicUnit;
    });
  view.serviceVehicles = (view.serviceVehicles || []).map((v) =>
    v.side === side ? v : publicFields(v, serviceFields),
  );
  view.ammoVehicles = (view.ammoVehicles || []).map((v) =>
    v.side === side
      ? v
      : publicFields(v, ['id', 'side', 'depotId', 'x', 'y', 'z', 'yaw', 'status', 'hp', 'maxHp']),
  );
  delete view.ammoLogisticsAt;
  delete view.fieldSupplyAt;
  delete view.fieldSupplyCursor;
  view.ammoCrates = (view.ammoCrates || []).map((c) =>
    c.side === side ? c : publicFields(c, ['id', 'side', 'key', 'x', 'z', 'hp', 'maxHp']),
  );
  view.ships = (view.ships || []).map((v) => (v.side === side ? v : publicFields(v, shipFields)));
  view.projectiles = view.projectiles
    .filter((p) => {
      if (p.side === side) return true;
      const source = p.sourceId ?? p.source;
      if (p.domain === 'ground') return visible.has(source);
      if (
        source != null &&
        !buildings.has(source) &&
        (!allGround.has(source) || !visible.has(source))
      )
        return false;
      return true;
    })
    .map((p) =>
      compact
        ? publicFields(p, transportProjectileFields)
        : p.side === side
          ? p
          : publicFields(p, projectileFields),
    );
  view.events = view.events
    .filter((e) => {
      if (e.side === side) return true;
      if (e.type === 'groundDestroyed') return e.visibleTo?.includes(side) === true;
      if (
        e.side !== side &&
        [
          'recruited',
          'produced',
          'research',
          'reload',
          'salvo',
          'fortification',
          'defenseRedeployed',
          'defenseReturned',
        ].includes(e.type)
      )
        return false;
      if (
        e.type === 'shot' &&
        e.side !== side &&
        (e.ground || (e.buildingId != null && !buildings.has(e.buildingId))) &&
        !visible.has(e.buildingId)
      )
        return false;
      return true;
    })
    .map((e) => ({ ...e }));
  for (const event of view.events) {
    delete event.visibleTo;
    // Impact debris direction would reveal where a hidden enemy shooter stands.
    if (event.type === 'hit' && event.side !== side) {
      delete event.fromX;
      delete event.fromZ;
    }
  }
  if (Array.isArray(view.contacts)) {
    view.contacts = owners.map((owner) =>
      owner === side
        ? (view.contacts[owner] || []).map((c) =>
            publicFields(c, ['x', 'z', 'radius', 'expires', 'time']),
          )
        : [],
    );
  }
  if (Array.isArray(view.groups))
    view.groups = owners.map((owner) => (owner === side ? view.groups[owner] : {}));
  if (Array.isArray(view.formations))
    view.formations = owners.map((owner) => (owner === side ? view.formations[owner] : 'line'));
  view.sides = owners.map((owner) => {
    if (owner === side) return authority.sides[owner];
    const opposingSide = authority.sides[owner];
    return {
      credits: 0,
      materials: 0,
      science: 0,
      tech: [],
      research: null,
      researchQueue: [],
      inventory: Object.fromEntries(
        Object.keys(opposingSide.inventory || {}).map((key) => [key, 0]),
      ),
      spentAmmo: 0,
      kills: opposingSide.kills,
      losses: opposingSide.losses,
    };
  });
  view.stats = { roadsCut: view.stats?.roadsCut || 0 };
  delete view.ai;
  delete view.aiBySide;
  delete view.ais;
  delete view.rng;
  delete view.seed;
  delete view.nextId;
  delete view.settlementClock;
  view.log = [];

  if (detached) view = structuredClone(view);
  else {
    // This view may only be synchronously consumed by an encoder which makes a
    // complete detached copy. Copy every record remapped below, while borrowing
    // untouched own paths, paid queues, side ledgers and other nested data.
    for (const key of [
      'districts',
      'settlements',
      'buildings',
      'roads',
      'units',
      'groundUnits',
      'serviceVehicles',
      'ammoVehicles',
      'ammoCrates',
      'ships',
      'warships',
      'projectiles',
      'trenches',
      'groundScars',
    ])
      if (Array.isArray(view[key])) view[key] = view[key].map((item) => ({ ...item }));
  }

  for (const d of [...(view.districts || []), ...(view.settlements || [])]) {
    if (d.owner != null) d.owner = remap(d.owner);
    if (d.capturing != null) d.capturing = remap(d.capturing);
    if (d.homeSide != null) d.homeSide = remap(d.homeSide);
  }
  if (side % 2) for (const d of view.districts || []) d.control = -d.control;
  for (const key of ['sides', 'groups', 'formations', 'contacts', 'frontlineMemory'])
    if (Array.isArray(view[key])) view[key] = order.map((owner) => view[key][owner]);
  for (const list of [
    'buildings',
    'roads',
    'units',
    'groundUnits',
    'serviceVehicles',
    'ammoVehicles',
    'ammoCrates',
    'ships',
    'warships',
    'projectiles',
    'trenches',
    'groundScars',
    'events',
  ])
    for (const item of view[list] || [])
      if (validSide(authority, item.side)) item.side = remap(item.side);
  if (view.result && teamOf(authority, side) !== 0)
    view.result = view.result === 'victory' ? 'defeat' : 'victory';
  if ([0, 1].includes(view.winnerTeam) && teamOf(authority, side) !== 0)
    view.winnerTeam = 1 - view.winnerTeam;
  for (const e of view.events)
    if (e.type === 'result' && e.result && teamOf(authority, side) !== 0)
      e.result = e.result === 'victory' ? 'defeat' : 'victory';
  return view;
}

// Full compatibility view for callers/tests that expect simulation-shaped records.
export const playerView = (authority, side) => projectView(authority, side, false);
// Opt-in transport view for delta-capable clients; no numerical quantization here.
export const compactPlayerView = (authority, side) => projectView(authority, side, true);
// Server-only borrowed view. Do not retain or send it raw; call encoder.encode
// immediately, synchronously, before authority advances or any await occurs.
export const snapshotPlayerView = (authority, side) => projectView(authority, side, true, false);

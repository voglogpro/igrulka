import { groundVisible } from '../game/units/infantry/cover.js';
import { unitVisible } from '../game/visibility.js';
import { fogVisible } from '../game/vision-grid.js';

const publicFields = (item, fields) =>
  Object.fromEntries(
    fields.filter((key) => Object.hasOwn(item, key)).map((key) => [key, item[key]]),
  );

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
const shipFields = ['id', 'side', 'portId', 'x', 'z', 'yaw', 'state', 'path'];

// The UI always calls its own faction 0. World coordinates and entity IDs stay unchanged.
export function playerView(authority, side) {
  if (side !== 0 && side !== 1) throw Error('Некорректная сторона игрока');
  const enemy = 1 - side;
  const view = structuredClone(authority);
  view.frontlineDirections = side === 0 ? [1, -1] : [-1, 1];
  const allGround = new Set(authority.groundUnits.map((u) => u.id));
  const buildings = new Set(authority.buildings.map((b) => b.id));
  const visible = new Set(
    authority.groundUnits
      .filter((u) => u.side === side || groundVisible(authority, side, u))
      .map((u) => u.id),
  );

  view.groundUnits = view.groundUnits
    .filter((u) => visible.has(u.id))
    .map((u) => (u.side === side ? u : publicFields(u, groundFields)));
  view.buildings = view.buildings.map((b) =>
    b.side === side ? b : publicFields(b, buildingFields),
  );
  view.trenches = (view.trenches || [])
    .filter((t) => t.side === side || fogVisible(authority, side, t.x, t.z))
    .map((t) =>
      t.side === side
        ? t
        : publicFields(t, ['id', 'side', 'x', 'z', 'yaw', 'progress', 'fortificationWork']),
    );
  view.frontlineMemory = [0, 1].map((owner) => {
    const memory = authority.frontlineMemory?.[owner];
    return owner === side && memory
      ? {
          nextThink: memory.nextThink,
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
      if (u.side === side) return u;
      const publicUnit = publicFields(u, aircraftFields);
      // The aircraft heading is visible, but its future target and route are private.
      publicUnit.tx = u.x + (u.vx || 0);
      publicUnit.tz = u.z + (u.vz || 0);
      return publicUnit;
    });
  view.serviceVehicles = (view.serviceVehicles || []).map((v) =>
    v.side === side ? v : publicFields(v, serviceFields),
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
    .map((p) => (p.side === side ? p : publicFields(p, projectileFields)));
  view.events = view.events.filter((e) => {
    if (e.side === side) return true;
    if (e.type === 'groundDestroyed') return e.visibleTo?.includes(side) === true;
    if (
      e.side === enemy &&
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
      e.side === enemy &&
      (e.ground || (e.buildingId != null && !buildings.has(e.buildingId))) &&
      !visible.has(e.buildingId)
    )
      return false;
    return true;
  });
  for (const event of view.events) {
    delete event.visibleTo;
    // Impact debris direction would reveal where a hidden enemy shooter stands.
    if (event.type === 'hit' && event.side === enemy) {
      delete event.fromX;
      delete event.fromZ;
    }
  }
  if (Array.isArray(view.contacts)) {
    view.contacts[side] = view.contacts[side].map((c) =>
      publicFields(c, ['x', 'z', 'radius', 'expires', 'time']),
    );
    view.contacts[enemy] = [];
  }
  if (Array.isArray(view.groups)) view.groups[enemy] = {};
  if (Array.isArray(view.formations)) view.formations[enemy] = 'line';
  const opposingSide = view.sides[enemy];
  view.sides[enemy] = {
    credits: 0,
    materials: 0,
    science: 0,
    tech: [],
    research: null,
    inventory: Object.fromEntries(Object.keys(opposingSide.inventory || {}).map((key) => [key, 0])),
    spentAmmo: 0,
    kills: opposingSide.kills,
    losses: opposingSide.losses,
  };
  view.stats = { roadsCut: view.stats?.roadsCut || 0 };
  delete view.ai;
  delete view.rng;
  delete view.seed;
  delete view.nextId;
  view.log = [];

  if (side === 0) return view;
  for (const d of view.districts || []) {
    if (d.owner != null) d.owner = 1 - d.owner;
    if (d.capturing != null) d.capturing = 1 - d.capturing;
    d.control = -d.control;
  }
  for (const key of ['sides', 'groups', 'formations', 'contacts', 'frontlineMemory'])
    if (Array.isArray(view[key])) view[key].reverse();
  for (const list of [
    'buildings',
    'roads',
    'units',
    'groundUnits',
    'serviceVehicles',
    'ships',
    'projectiles',
    'trenches',
    'events',
  ])
    for (const item of view[list] || [])
      if (item.side === 0 || item.side === 1) item.side = 1 - item.side;
  if (view.result) view.result = view.result === 'victory' ? 'defeat' : 'victory';
  for (const e of view.events)
    if (e.type === 'result' && e.result) e.result = e.result === 'victory' ? 'defeat' : 'victory';
  return view;
}

import { groundVisible } from '../game/units/infantry/cover.js';

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
];

// The UI always calls its own faction 0. World coordinates and entity IDs stay unchanged.
export function playerView(authority, side) {
  if (side !== 0 && side !== 1) throw Error('Некорректная сторона игрока');
  const enemy = 1 - side;
  const view = structuredClone(authority);
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
  view.units = view.units
    .filter(
      (u) =>
        u.side === side ||
        (u.delay <= 0 && u.launched !== false && (u.hp > 0 || u.status === 'falling')),
    )
    .map((u) => {
      if (u.side === side) return u;
      const publicUnit = publicFields(u, aircraftFields);
      // The aircraft heading is visible, but its future target and route are private.
      publicUnit.tx = u.x + (u.vx || 0);
      publicUnit.tz = u.z + (u.vz || 0);
      return publicUnit;
    });
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
      ['recruited', 'produced', 'research', 'reload', 'salvo'].includes(e.type)
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
  for (const event of view.events) delete event.visibleTo;
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
  for (const key of ['sides', 'groups', 'formations', 'contacts'])
    if (Array.isArray(view[key])) view[key].reverse();
  for (const list of [
    'buildings',
    'roads',
    'units',
    'groundUnits',
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

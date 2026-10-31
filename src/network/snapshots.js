// Optional transport encoding. Simulation, ownership filtering and saved games stay exact.
export const SNAPSHOT_ENCODING = 'delta-v1';
const collections = new Set([
  'buildings',
  'roads',
  'units',
  'groundUnits',
  'projectiles',
  'events',
  'serviceVehicles',
  'ammoVehicles',
  'ammoCrates',
  'ships',
  'warships',
  'trenches',
  'groundScars',
]);
const routes = new Set(['path', 'route', 'routeQueue']);
const positions = new Set([
  'x',
  'y',
  'z',
  'ax',
  'az',
  'bx',
  'bz',
  'vx',
  'vy',
  'vz',
  'tx',
  'tz',
  'targetX',
  'targetY',
  'targetZ',
  'originX',
  'originY',
  'originZ',
  'startX',
  'startZ',
  'endY',
  'mx',
  'my',
  'mz',
  'fromX',
  'fromZ',
]);
const safeKey = (key) => key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
const object = (value) => value !== null && typeof value === 'object';

function normalize(value, key = '', before = null) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const scale = positions.has(key) ? 100 : key === 'yaw' ? 10000 : 0;
    return scale ? Math.round(value * scale) / scale : value;
  }
  if (Array.isArray(value)) {
    const old = Array.isArray(before) ? before : [],
      indexed = collections.has(key) ? new Map(old.map((item) => [item.id, item])) : null;
    const offset = routes.has(key) ? Math.max(0, old.length - value.length) : 0;
    let result = null;
    for (let i = 0; i < value.length; i++) {
      const item =
        normalize(value[i], '', indexed ? indexed.get(value[i]?.id) : old[i + offset]) ?? null;
      if (!result && item !== old[i]) result = old.slice(0, i);
      if (result) result.push(item);
    }
    if (!result && old.length === value.length) return old;
    return result || old.slice(0, value.length);
  }
  if (!object(value)) return value;
  const prior = object(before) && !Array.isArray(before) ? before : {};
  let result = null;
  for (const field in value) {
    if (!Object.hasOwn(value, field) || !safeKey(field) || value[field] === undefined) continue;
    const item = normalize(value[field], field, prior[field]);
    if (!Object.hasOwn(prior, field) || item !== prior[field]) {
      result ||= { ...prior };
      result[field] = item;
    }
  }
  for (const field in prior)
    if (
      Object.hasOwn(prior, field) &&
      (!safeKey(field) || !Object.hasOwn(value, field) || value[field] === undefined)
    ) {
      result ||= { ...prior };
      delete result[field];
    }
  return result || prior;
}

function equal(a, b) {
  if (a === b) return true;
  if (!object(a) || !object(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}

function diffTree(a, b, path, set, remove) {
  if (a === b) return;
  if (
    !object(a) ||
    !object(b) ||
    Array.isArray(a) !== Array.isArray(b) ||
    (Array.isArray(a) && a.length !== b.length)
  ) {
    set.push([path, b]);
    return;
  }
  for (const key of Object.keys(a)) if (!Object.hasOwn(b, key)) remove.push([...path, key]);
  for (const key of Object.keys(b)) {
    const next = [...path, key];
    if (!Object.hasOwn(a, key)) set.push([next, b[key]]);
    else diffTree(a[key], b[key], next, set, remove);
  }
}

export function createSnapshotEncoder() {
  let previous = null,
    sequence = 0;
  const keys = [],
    indices = new Map();
  const index = (key) => {
    if (!indices.has(key)) {
      indices.set(key, keys.length);
      keys.push(key);
    }
    return indices.get(key);
  };
  function row(item, before = null, splices = []) {
    const tuple = [item.id];
    for (const key of Object.keys(item))
      if (key !== 'id' && (!before || !equal(before[key], item[key]))) {
        const old = before?.[key],
          next = item[key];
        let splice = false;
        if (routes.has(key) && Array.isArray(old) && Array.isArray(next)) {
          for (let drop = 0; drop <= old.length; drop++) {
            const count = old.length - drop;
            if (count > next.length || (count && !equal(old[drop], next[0]))) continue;
            if (old.slice(drop).every((point, i) => equal(point, next[i]))) {
              splices.push([item.id, index(key), drop, next.slice(count)]);
              splice = true;
              break;
            }
          }
        }
        if (!splice) tuple.push(index(key), item[key]);
      }
    return tuple;
  }
  return {
    reset() {
      previous = null;
      keys.length = 0;
      indices.clear();
    },
    encode(input) {
      const state = normalize(input, '', previous),
        base = previous ? sequence : 0;
      sequence++;
      if (!previous) {
        previous = state;
        return { sync: { encoding: SNAPSHOT_ENCODING, seq: sequence, base: 0, fields: [] }, state };
      }
      const fieldCount = keys.length,
        delta = { set: [], remove: [], entities: {} };
      for (const key of Object.keys(previous))
        if (!Object.hasOwn(state, key)) delta.remove.push([key]);
      for (const [key, value] of Object.entries(state)) {
        const before = previous[key];
        if (!collections.has(key) || !Array.isArray(value) || !Array.isArray(before)) {
          diffTree(before, value, [key], delta.set, delta.remove);
          continue;
        }
        const old = new Map(before.map((item) => [item.id, item])),
          current = new Set(value.map((item) => item.id)),
          change = { add: [], patch: [], remove: [], unset: [], splices: [] };
        for (const item of value) {
          const prior = old.get(item.id);
          if (!prior) change.add.push(row(item));
          else {
            const patch = row(item, prior, change.splices);
            if (patch.length > 1) change.patch.push(patch);
            const unset = Object.keys(prior).filter((field) => !Object.hasOwn(item, field));
            if (unset.length) change.unset.push([item.id, ...unset.map(index)]);
          }
        }
        for (const item of before) if (!current.has(item.id)) change.remove.push(item.id);
        if (
          change.add.length ||
          change.remove.length ||
          before.some((item, i) => value[i]?.id !== item.id)
        )
          change.order = value.map((item) => item.id);
        if (
          change.add.length ||
          change.patch.length ||
          change.remove.length ||
          change.unset.length ||
          change.splices.length ||
          change.order
        )
          delta.entities[key] = change;
      }
      previous = state;
      return {
        sync: { encoding: SNAPSHOT_ENCODING, seq: sequence, base, fields: keys.slice(fieldCount) },
        delta,
      };
    },
  };
}

// Immutable reconstruction lets interpolation retain its preceding sample unchanged.
function editPath(root, path, value, remove = false) {
  if (
    !Array.isArray(path) ||
    !path.length ||
    path.length > 40 ||
    path.some((key) => typeof key !== 'string' || !safeKey(key))
  )
    throw Error('Invalid snapshot path');
  const result = Array.isArray(root) ? [...root] : { ...root };
  let source = root,
    target = result;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i],
      child = source?.[key];
    target[key] = Array.isArray(child) ? [...child] : { ...child };
    target = target[key];
    source = child;
  }
  if (remove) delete target[path.at(-1)];
  else target[path.at(-1)] = value;
  return result;
}

export function createSnapshotDecoder() {
  let state = null,
    sequence = 0,
    keys = [];
  function applyRow(tuple, before = null) {
    if (!Array.isArray(tuple) || !Number.isSafeInteger(tuple[0]) || tuple.length % 2 !== 1)
      throw Error('Invalid snapshot entity');
    const item = { ...(before || {}), id: tuple[0] };
    for (let i = 1; i < tuple.length; i += 2) {
      const field = keys[tuple[i]];
      if (typeof field !== 'string') throw Error('Invalid snapshot field');
      item[field] = tuple[i + 1];
    }
    return item;
  }
  return {
    reset() {
      state = null;
      sequence = 0;
      keys = [];
    },
    decode(message) {
      const sync = message.sync;
      if (
        !sync ||
        sync.encoding !== SNAPSHOT_ENCODING ||
        !Number.isSafeInteger(sync.seq) ||
        sync.seq < 1 ||
        !Array.isArray(sync.fields) ||
        sync.fields.some((key) => typeof key !== 'string' || !safeKey(key))
      )
        throw Error('Invalid snapshot header');
      if (message.state && sync.base === 0) {
        state = message.state;
        sequence = sync.seq;
        keys = [...sync.fields];
        return state;
      }
      if (!state || sync.base !== sequence || sync.seq <= sequence || !message.delta)
        throw Error('Snapshot baseline missing');
      const oldKeys = keys;
      keys = [...keys, ...sync.fields];
      try {
        const delta = message.delta;
        let next = { ...state };
        for (const path of delta.remove) next = editPath(next, path, undefined, true);
        for (const [path, value] of delta.set) next = editPath(next, path, value);
        for (const [key, change] of Object.entries(delta.entities)) {
          if (!collections.has(key) || !Array.isArray(state[key]))
            throw Error('Invalid snapshot collection');
          const items = new Map(state[key].map((item) => [item.id, item]));
          for (const id of change.remove) items.delete(id);
          for (const tuple of change.add) {
            if (items.has(tuple[0])) throw Error('Duplicate snapshot entity');
            items.set(tuple[0], applyRow(tuple));
          }
          for (const tuple of change.patch) {
            if (!items.has(tuple[0])) throw Error('Unknown snapshot entity');
            items.set(tuple[0], applyRow(tuple, items.get(tuple[0])));
          }
          for (const [id, ...fields] of change.unset) {
            if (!items.has(id)) throw Error('Unknown snapshot entity');
            const item = { ...items.get(id) };
            for (const field of fields) {
              if (!keys[field]) throw Error('Invalid snapshot field');
              delete item[keys[field]];
            }
            items.set(id, item);
          }
          for (const [id, fieldIndex, drop, append] of change.splices || []) {
            const field = keys[fieldIndex],
              old = items.get(id)?.[field];
            if (
              !routes.has(field) ||
              !Array.isArray(old) ||
              !Number.isInteger(drop) ||
              drop < 0 ||
              drop > old.length ||
              !Array.isArray(append)
            )
              throw Error('Invalid snapshot route');
            items.set(id, { ...items.get(id), [field]: [...old.slice(drop), ...append] });
          }
          next[key] = change.order
            ? change.order.map((id) => {
                if (!items.has(id)) throw Error('Missing snapshot entity');
                return items.get(id);
              })
            : [...items.values()];
          if (
            next[key].length !== items.size ||
            new Set(next[key].map((item) => item.id)).size !== items.size
          )
            throw Error('Invalid snapshot order');
        }
        state = next;
        sequence = sync.seq;
        return state;
      } catch (error) {
        keys = oldKeys;
        throw error;
      }
    },
  };
}

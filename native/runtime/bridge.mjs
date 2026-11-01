import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as E from '../../src/game/index.js';
import { step } from '../../src/game/simulation.js';
import { save, load } from '../../src/game/persistence/saves.js';
import { executeCommand, PROTOCOL_VERSION } from '../../src/network/commands.js';
import { playerView } from '../../src/network/perspective.js';
import { COVER_PATCHES, seaDistance, ISLAND } from '../../src/game/map.js';
import { SETTLEMENTS } from '../../src/game/territory/settlements.config.js';
import { DISTRICTS } from '../../src/game/territory/districts.config.js';

export const BRIDGE_VERSION = 1;
const STEP = 0.05;
const MAX_LINE = 16 * 1024 * 1024;
const entity = (item) =>
  Object.fromEntries(
    Object.entries(item).filter(
      ([key]) => !['path', 'route', 'routeQueue', 'routeSearch', 'frontlineMemory'].includes(key),
    ),
  );
const json = (value) =>
  JSON.parse(JSON.stringify(value, (_, v) => (v instanceof Set ? [...v] : v)));

// Match the source scenery's seed/order without importing Three or consuming battle RNG.
function treeDescriptors() {
  let seed = 171;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const trees = [],
    counts = [0, 0];
  const plant = (x, z, kind) => {
    if (counts[kind] >= 6400 || seaDistance(x, z) < 14) return;
    const scale = 0.7 + rnd() * 0.8,
      yaw = rnd() * 6.28;
    rnd();
    rnd();
    rnd(); // Source leaf colour draws preserve subsequent positions.
    counts[kind]++;
    trees.push({ x, z, scale, yaw, kind });
  };
  for (const patch of COVER_PATCHES) {
    if (!patch.forest) continue;
    const count = patch.belt ? 8 : Math.round((patch.r * patch.r) / 60),
      fir = rnd() < 0.55;
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2,
        r = Math.sqrt(rnd()) * patch.r * 1.05;
      const mixed = rnd() < 0.2;
      plant(patch.x + Math.cos(a) * r, patch.z + Math.sin(a) * r, fir !== mixed ? 0 : 1);
    }
  }
  for (let i = 0; i < 14000; i++) {
    const x = (rnd() - 0.5) * (E.MAP.width + 2400);
    const z = (rnd() - 0.5) * (E.MAP.depth + 2200);
    const city = Math.min(Math.hypot(x + E.HQ_X, z), Math.hypot(x - E.HQ_X, z));
    if (city < 330 || (city < 520 && rnd() > 0.15) || (E.inField(x, z) && rnd() > 0.35)) continue;
    plant(x, z, rnd() < 0.6 ? 0 : 1);
  }
  return trees;
}

export function createWorldDescriptor() {
  const spacing = 40;
  const columns = E.MAP.width / spacing + 1;
  const rows = E.MAP.depth / spacing + 1;
  const values = [],
    water = [];
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < columns; x++) {
      const px = -E.MAP.width / 2 + x * spacing;
      const pz = -E.MAP.depth / 2 + z * spacing;
      const wet = seaDistance(px, pz) < 0;
      values.push(wet ? -3 : E.groundHeight(px, pz));
      water.push(wet ? 1 : 0);
    }
  return json({
    kind: 'world',
    bridgeVersion: BRIDGE_VERSION,
    gameVersion: '8.16.0',
    schema: E.VERSION,
    protocol: PROTOCOL_VERSION,
    map: E.MAP,
    field: E.FIELD,
    heightGrid: {
      columns,
      rows,
      step: spacing,
      originX: -E.MAP.width / 2,
      originZ: -E.MAP.depth / 2,
      values,
      water,
    },
    coverPatches: COVER_PATCHES,
    oilFields: E.OIL_FIELDS,
    depots: DISTRICTS,
    settlements: SETTLEMENTS,
    island: ISLAND,
    waterLevel: -1,
    trees: treeDescriptors(),
    catalogs: {
      buildings: E.BUILDINGS,
      weapons: E.WEAPONS,
      groundUnits: E.GROUND_UNITS,
      difficulty: E.DIFFICULTY,
    },
  });
}

export function projectNativeState(state, paused = false, seq = 0) {
  const view = playerView(state, 0);
  const result = {
    kind: 'state',
    bridgeVersion: BRIDGE_VERSION,
    seq,
    side: 0,
    time: view.time,
    paused,
    result: view.result ?? null,
    mode: view.mode ?? 'solo',
    weather: view.weather,
    sides: view.sides,
    economy: E.economy(state, 0),
    sideHQ: view.buildings.filter((b) => b.key === 'hq').map(entity),
    log: view.log,
    groups: view.groups,
    formations: view.formations,
  };
  for (const key of [
    'buildings',
    'roads',
    'groundUnits',
    'units',
    'projectiles',
    'serviceVehicles',
    'ammoVehicles',
    'ammoCrates',
    'ships',
    'warships',
    'trenches',
    'districts',
    'settlements',
    'contacts',
    'events',
    'groundScars',
  ])
    result[key] = (view[key] || []).map((v) => (v && !Array.isArray(v) ? entity(v) : v));
  return json(result);
}

export function createBridgeSession({ seed = 816, difficulty = 'normal', mode = 'solo' } = {}) {
  let state = E.createGame(seed, { difficulty, mode });
  let paused = false,
    seq = 0,
    closed = false;
  const snapshot = () => projectNativeState(state, paused, ++seq);
  return {
    snapshot,
    get state() {
      return state;
    },
    get closed() {
      return closed;
    },
    tick() {
      if (!paused && !closed) step(state, STEP);
    },
    handle(message) {
      const id = message?.id ?? null;
      try {
        if (!message || typeof message !== 'object' || Array.isArray(message))
          throw Error('Expected command object');
        let data;
        switch (message.cmd) {
          case 'new': {
            const seed = message.seed ?? 816;
            if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
              throw Error('seed must be uint32');
            const mode = message.mode ?? 'solo',
              difficulty = message.difficulty ?? 'normal';
            if (
              !['solo', 'siege', 'coop'].includes(mode) ||
              !Object.hasOwn(E.DIFFICULTY, difficulty)
            )
              throw Error('Invalid mode or difficulty');
            state = E.createGame(seed, { difficulty, mode });
            paused = false;
            break;
          }
          case 'action': {
            const result = executeCommand(state, 0, message.type, message.payload ?? {});
            if (typeof result === 'string') throw Error(result);
            data = result ?? null;
            break;
          }
          case 'pause':
            if (typeof message.paused !== 'boolean') throw Error('paused must be boolean');
            paused = message.paused;
            break;
          case 'save':
            data = save(state);
            break;
          case 'load': {
            if (typeof message.data !== 'string' || message.data.length > MAX_LINE)
              throw Error('data must be a campaign JSON string under 16 MiB');
            const candidate = load(message.data);
            if (candidate.mode === 'multiplayer') throw Error('Offline bridge cannot load PvP');
            state = candidate;
            paused = true;
            break;
          }
          case 'quit':
            closed = true;
            break;
          default:
            throw Error('Unknown bridge command');
        }
        return { kind: 'reply', id, ok: true, ...(data === undefined ? {} : { data }) };
      } catch (error) {
        return { kind: 'error', id, ok: false, message: error.message };
      }
    },
  };
}

// The pipe owns at most one pending state; control replies are ordered and bounded.
export function createOutputQueue(output, onOverflow = () => {}) {
  let blocked = false,
    latest = null,
    ending = false;
  const controls = [];
  const flush = () => {
    while (!blocked && (controls.length || latest)) {
      const next = controls.length ? controls.shift() : latest;
      if (next === latest) latest = null;
      blocked = !output.write(JSON.stringify(next) + '\n');
    }
    if (ending && !blocked && !controls.length && !latest) output.end();
  };
  output.on('drain', () => {
    blocked = false;
    flush();
  });
  return {
    end() {
      ending = true;
      latest = null;
      flush();
    },
    send(message) {
      if (message.kind === 'state') latest = message;
      else {
        if (controls.length >= 32) {
          onOverflow();
          return false;
        }
        controls.push(message);
      }
      flush();
      return true;
    },
    get pendingStates() {
      return latest ? 1 : 0;
    },
    get pendingControls() {
      return controls.length;
    },
  };
}

export function startBridge({ input = process.stdin, output = process.stdout } = {}) {
  const session = createBridgeSession();
  let timer,
    ending = false,
    accumulator = 0;
  let previous = performance.now(),
    lastSnapshot = previous;
  const lines = createInterface({ input, crlfDelay: Infinity });
  const stop = () => {
    ending = true;
    clearInterval(timer);
    lines.close();
    input.pause();
    input.destroy();
  };
  const writer = createOutputQueue(output, () => {
    process.stderr.write('Native bridge control backlog exceeded 32; closing pipe.\n');
    stop();
    output.end();
  });
  output.on('error', stop);
  lines.on('line', (line) => {
    if (ending) return;
    let message;
    try {
      if (line.length > MAX_LINE) throw Error('Command exceeds 16 MiB');
      message = JSON.parse(line);
    } catch (error) {
      writer.send({ kind: 'error', id: null, ok: false, message: error.message });
      return;
    }
    const reply = session.handle(message);
    writer.send(reply);
    if (reply.ok && ['new', 'load'].includes(message.cmd)) {
      accumulator = 0;
      previous = performance.now();
      writer.send(createWorldDescriptor());
    }
    if (session.closed) {
      stop();
      writer.end();
    }
  });
  lines.on('close', () => {
    ending = true;
    clearInterval(timer);
  });
  writer.send(createWorldDescriptor());
  writer.send(session.snapshot());
  timer = setInterval(() => {
    const now = performance.now();
    accumulator += Math.min(0.2, Math.max(0, (now - previous) / 1000));
    previous = now;
    let steps = 0;
    while (accumulator >= STEP && steps < 4) {
      session.tick();
      accumulator -= STEP;
      steps++;
    }
    if (steps === 4) accumulator = 0;
    if (now - lastSnapshot >= 200) {
      lastSnapshot = now;
      writer.send(session.snapshot());
    }
  }, 25);
  return { session, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startBridge();

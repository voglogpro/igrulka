import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { knownTargets, observedTarget } from '../../src/game/visibility.js';
import { COVER_PATCHES } from '../../src/game/units/infantry/cover.js';
import { loadCampaign, SAVE } from '../../src/ui/session/campaign-store.js';

function building(s, side, extra = {}) {
  const b = {
    id: s.nextId++,
    side,
    key: 'housing',
    x: side % 2 ? 1100 : -1100,
    z: side < 2 ? -1000 : 1000,
    hp: 100,
    maxHp: 100,
    progress: 1,
    ...extra,
  };
  s.buildings.push(b);
  return b;
}
function road(s, side, extra = {}) {
  const r = {
    id: s.nextId++,
    side,
    ax: side % 2 ? 1100 : -1100,
    az: -900,
    bx: side % 2 ? 1200 : -1200,
    bz: -900,
    hp: 100,
    maxHp: 100,
    ...extra,
  };
  s.roads.push(r);
  return r;
}

test('public city target catalogue preserves observed target order, building identity and complete road projection', () => {
  const s = E.createGame(8121, { mode: 'coop' });
  for (const side of [3, 0, 1, 2]) building(s, side);
  for (const side of [2, 1, 0, 3])
    road(s, side, { repairing: true, privateFutureField: 'retained-contract' });
  building(s, 1, { hp: 0 });
  building(s, 3, { demolished: true });
  road(s, 1, { hp: 0 });
  road(s, 3, { removed: true });
  const expected = [...s.buildings, ...s.roads]
    .filter((t) => E.hostile(s, t.side, 0))
    .map((t) => observedTarget(s, 0, t.id))
    .filter((t) => t && t.hp > 0);
  const actual = knownTargets(s, 0);
  assert.deepEqual(actual, expected);
  for (const b of s.buildings.filter((t) => actual.some((v) => v.id === t.id)))
    assert.equal(
      actual.find((v) => v.id === b.id),
      b,
      'buildings keep their live public identity',
    );
  assert.ok(
    actual
      .filter((t) => t.key === 'road')
      .every((t) => t.progress === 1 && Number.isFinite(t.x) && Number.isFinite(t.z)),
  );
  assert.ok(
    actual.every((t) => t.side === 1 || t.side === 3),
    'allied cities never become attack targets',
  );
});

test('large city catalogues do not look up each building through the army and stay fresh after damage/removal', () => {
  const s = E.createGame(8121, { mode: 'multiplayer' });
  const originalRoads = knownTargets(s, 0).filter((t) => t.key === 'road').length;
  let idReads = 0;
  for (let i = 0; i < 500; i++) {
    const u = E.makeGround(s, 0, 'infantry', -1200, -400),
      id = u.id;
    Object.defineProperty(u, 'id', {
      enumerable: true,
      get() {
        idReads++;
        return id;
      },
    });
    s.groundUnits.push(u);
    building(s, 1);
    road(s, 1);
  }
  const targets = knownTargets(s, 0);
  assert.equal(idReads, 0, 'city listing must not perform objects × army linear lookups');
  assert.equal(targets.filter((t) => t.key === 'housing').length, 500);
  assert.equal(targets.filter((t) => t.key === 'road').length, 500 + originalRoads);
  const b = s.buildings.find((t) => t.key === 'housing'),
    r = s.roads.find((t) => !t.camp);
  const previousRoad = targets.find((t) => t.id === r.id);
  b.hp = 37;
  r.hp = 19;
  r.ax += 10;
  const refreshed = knownTargets(s, 0);
  assert.equal(refreshed.find((t) => t.id === b.id).hp, 37);
  assert.equal(refreshed.find((t) => t.id === r.id).hp, 19);
  assert.equal(refreshed.find((t) => t.id === r.id).x, (r.ax + r.bx) / 2);
  assert.equal(
    previousRoad.hp,
    100,
    'road records retain the previous observed snapshot semantics',
  );
  b.demolished = true;
  r.removed = true;
  assert.ok(knownTargets(s, 0).every((t) => t.id !== b.id && t.id !== r.id));
  assert.equal(idReads, 0);
});

test('public city listing never exposes concealed infantry and observedTarget keeps its visibility rules', () => {
  const s = E.createGame(8121, { mode: 'coop' }),
    patch = COVER_PATCHES.find((p) => p.forest && p.x > 300);
  assert.ok(patch);
  const hidden = E.makeGround(s, 1, 'sniper', patch.x, patch.z);
  hidden.camouflaged = true;
  s.groundUnits.push(hidden);
  assert.equal(observedTarget(s, 0, hidden.id), null);
  assert.ok(knownTargets(s, 0).every((t) => t.id !== hidden.id));
  assert.equal(observedTarget(s, 0, hidden.id), null);
  const own = building(s, 0),
    enemy = building(s, 1);
  assert.equal(observedTarget(s, 0, own.id), own);
  assert.equal(observedTarget(s, 0, enemy.id), enemy);
});

test('campaign loader parses metadata once while preserving raw legacy backups and notice precedence', (t) => {
  const parse = JSON.parse;
  let calls = 0;
  JSON.parse = (...args) => {
    calls++;
    return parse(...args);
  };
  t.after(() => {
    JSON.parse = parse;
  });
  for (const version of [3, 20]) {
    calls = 0;
    const raw = JSON.stringify({
        version,
        time: 42,
        buildings: [{ id: 1 }],
        payload: Array.from({ length: 500 }, (_, id) => ({ id })),
      }),
      values = new Map([[SAVE, raw]]),
      writes = [],
      storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          writes.push([key, value]);
          values.set(key, value);
        },
      };
    const loaded = loadCampaign(storage, {
      load: (value) => JSON.parse(value),
      createGame: () => assert.fail('existing campaign replaced'),
    });
    assert.equal(calls, 2, 'one game decode plus one shared metadata decode');
    assert.equal(loaded.state.time, 42);
    assert.equal(loaded.resumed, true);
    assert.equal(values.get(SAVE), raw, 'reading never rewrites user save');
    if (version === 3) {
      assert.match(loaded.loadNotice, /Дорожная система/);
      for (const suffix of ['deployment10', 'districts9', 'infantry8', 'combat6', 'roads'])
        assert.equal(values.get(`${SAVE}-before-${suffix}`), raw);
    } else assert.deepEqual(writes, []);
  }
});

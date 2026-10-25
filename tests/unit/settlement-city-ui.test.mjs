import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { settlementInspectorHTML, settlementListHTML } from '../../src/ui/settlements.js';
import { addRoad } from '../../src/game/city/roads.js';

test('neutral city describes its marked entrance and ordinary buildings without extra repair controls', () => {
  const s = E.createGame(811),
    site = E.SETTLEMENTS[0],
    html = settlementInspectorHTML(s, site.id);
  assert.match(html, /к отмеченному въезду/);
  assert.match(html, /жилые дома и промышленность/);
  assert.doesNotMatch(html, /data-repair|data-demolish|data-upgrade/);
});

test('city card distinguishes disconnected ordinary buildings and destroyed structures', () => {
  const s = E.createGame(811),
    site = E.SETTLEMENTS[0],
    value = s.settlements[0];
  const b = {
    id: s.nextId++,
    key: 'housing',
    side: 0,
    x: site.x - 42,
    z: site.z,
    hp: 100,
    maxHp: E.BUILDINGS.housing.hp,
    progress: 1,
    settlementId: site.id,
    settlementSlot: 0,
  };
  s.buildings.push(b);
  Object.assign(value, { owner: 0, materialized: true, componentIds: [b.id] });
  assert.match(settlementInspectorHTML(s, site.id), /Отключено · восстановите дорогу к штабу/);
  b.hp = 0;
  const html = settlementInspectorHTML(s, site.id);
  assert.match(html, /Разрушено/);
  assert.match(html, /0 из 1 зданий в строю/);
  assert.match(settlementListHTML(s), /Здания разрушены/);
});

test('status skips economy for zero-output towns and shares one fresh economy per owner within a list', () => {
  const s = E.createGame(811),
    economies = new Map();
  for (const site of E.SETTLEMENTS) E.settlementStatus(s, site.id, economies);
  assert.equal(economies.size, 0, 'neutral sites cannot produce income');
  const hq = E.hqOf(s, 0);
  for (let i = 0; i < 2; i++) {
    const site = E.SETTLEMENTS[i],
      value = s.settlements[i];
    const b = {
      id: s.nextId++,
      key: 'housing',
      side: 0,
      x: site.x - 42,
      z: site.z,
      hp: E.BUILDINGS.housing.hp,
      maxHp: E.BUILDINGS.housing.hp,
      progress: 1,
      settlementId: site.id,
      settlementSlot: 0,
    };
    s.buildings.push(b);
    Object.assign(value, { owner: 0, materialized: true, componentIds: [b.id] });
    addRoad(s, 0, hq.x, hq.z, site.x, site.z);
    addRoad(s, 0, site.x, site.z, b.x, b.z);
  }
  const first = E.settlementStatus(s, E.SETTLEMENTS[0].id, economies);
  assert.equal(first.active, true);
  assert.ok(first.income > 0);
  assert.equal(economies.size, 1);
  const shared = economies.get(0);
  assert.ok(E.settlementStatus(s, E.SETTLEMENTS[1].id, economies).income > 0);
  assert.equal(economies.get(0), shared);
  const next = new Map();
  E.settlementStatus(s, E.SETTLEMENTS[0].id, next);
  assert.notEqual(next.get(0), shared, 'the next UI list recomputes current economy');
});

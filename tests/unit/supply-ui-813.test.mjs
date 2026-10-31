import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { supplyHTML } from '../../src/ui/equipment-detail.js';
import { price, deliveryText } from '../../src/ui/format.js';
import { compactInspectorStatus } from '../../src/ui/inspector-card.js';

test('economic prices include actual oil and electronics without zero resource clutter', () => {
  assert.equal(
    price({ cost: 90, metal: 12, oil: 4, components: 3 }),
    '90 ₡ · 12 спл. · 4 нефти · 3 эл.',
  );
  assert.equal(price({ cost: 90, metal: 12 }), '90 ₡ · 12 спл.');
});

test('reopening launcher supply details is pure and shows compatible per-key stock', () => {
  const s = E.createGame(813);
  const site = {
    id: 900,
    key: 'silo',
    side: 0,
    hp: 100,
    maxHp: 100,
    progress: 1,
    x: -1092,
    z: 200,
    launchStore: { cruise: 0, ballistic: 2 },
    weaponDemand: { cruise: 1 },
  };
  s.buildings.push(site);
  const before = JSON.stringify(s);
  const html = supplyHTML(s, site);
  assert.equal(supplyHTML(s, site), html);
  assert.equal(JSON.stringify(s), before);
  assert.match(html, /Баллистическая[^<]*2/);
  assert.equal(supplyHTML(s, { ...site, side: 1 }), '');
});

test('physical incoming cargo shows its count and approximate ETA while collection remains a distinct reason', () => {
  assert.equal(deliveryText({ reason: 'Груз в пути', inTransit: 2, eta: 4.1 }), 'Едет 2 ≈5 с');
  assert.equal(
    deliveryText({ reason: 'Освобождаем место', inTransit: 0, exchanging: 1, eta: null }),
    'Освобождаем место',
  );
  assert.equal(
    deliveryText({ reason: 'Нет сухого пути к пусковой', inTransit: 1, eta: null }),
    'Нет сухого пути к пусковой · груз 1',
  );
});

test('electronics inspector shows actual stock and batch progress with a collapsed-input recipe', () => {
  const s = E.createGame(813);
  const factory = E.build(s, 0, 'electronics', -1272, -80);
  assert.equal(typeof factory, 'object', String(factory));
  factory.progress = 1;
  factory.hp = factory.maxHp;
  factory.componentProgress = 0.5;
  s.sides[0].components = 7;
  const before = JSON.stringify(s),
    html = supplyHTML(s, factory),
    status = {};
  compactInspectorStatus({ querySelector: () => status }, s, factory);
  assert.match(html, /Электроника 7 \/ 120/);
  assert.match(html, /50%/);
  assert.match(html, /6 ₡ · 5 спл. · 0.5 нефти → 1 эл./);
  assert.match(status.textContent, /7\/120 эл. · сборка 50%/);
  assert.equal(JSON.stringify(s), before);
});

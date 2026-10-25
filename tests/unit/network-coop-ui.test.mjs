import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { playerView } from '../../src/network/perspective.js';
import { executeCommand } from '../../src/network/commands.js';
import { renderInspector } from '../../src/ui/inspector.js';
import {
  settlementListHTML,
  settlementInspectorHTML,
  updateSettlementList,
} from '../../src/ui/settlements.js';
import { DistrictHUD } from '../../src/ui/districts.js';

test('unchanged HUD polling preserves settlement buttons, while ownership and supply changes refresh them', () => {
  const state = E.createGame(810, { mode: 'coop' }),
    writes = [];
  const host = {
    set innerHTML(value) {
      writes.push(value);
    },
  };
  updateSettlementList(host, state);
  for (let i = 0; i < 20; i++) {
    state.time += 0.4;
    updateSettlementList(host, state);
  }
  assert.equal(writes.length, 1, 'scrolling/clicking retains the original button nodes');
  Object.assign(state.settlements[0], { owner: 0, control: 1 });
  updateSettlementList(host, state);
  assert.equal(writes.length, 2);
  assert.match(writes[1], /Наше поселение/);
  state.settlements[0].blocked = true;
  updateSettlementList(host, state);
  assert.equal(writes.length, 3);
  assert.match(writes[2], /вражеские войска рядом/);
  for (let i = 0; i < 20; i++) updateSettlementList(host, state);
  assert.equal(writes.length, 3);
  const reopened = [];
  updateSettlementList(
    {
      set innerHTML(value) {
        reopened.push(value);
      },
    },
    state,
  );
  assert.equal(reopened.length, 1, 'a newly opened panel still receives its initial content');
});

test('four-city projections retain exact coordinates, normalize ownership and hide every other city plan', () => {
  const s = E.createGame(810, { mode: 'coop' });
  for (const side of E.sideIds(s)) {
    s.sides[side].credits = 10000 + side;
    s.sides[side].inventory.ballistic = side + 1;
    const hq = E.hqOf(s, side),
      u = E.makeGround(s, side, 'infantry', hq.x, hq.z + 60);
    u.path = [{ x: hq.x + 40, z: hq.z }];
    u.order = { mode: 'move', x: hq.x + 40, z: hq.z };
    s.groundUnits.push(u);
    hq.privateFuturePlan = { secret: side };
    s.groups[side] = { 1: [u.id] };
  }
  s.settlements[0].owner = 2;
  s.settlements[0].control = 0.7;
  for (const viewer of E.sideIds(s)) {
    const view = playerView(s, viewer),
      order = [viewer, viewer ^ 1, viewer ^ 2, viewer ^ 3];
    for (const [local, actual] of order.entries()) {
      const original = E.hqOf(s, actual),
        projected = E.hqOf(view, local);
      assert.deepEqual(
        [projected.id, projected.x, projected.z],
        [original.id, original.x, original.z],
      );
      const unit = view.groundUnits.find(
        (u) => u.id === s.groundUnits.find((u) => u.side === actual).id,
      );
      assert.equal(unit.side, local);
      assert.equal(view.sides[local].credits, local === 0 ? 10000 + viewer : 0);
      assert.equal(view.sides[local].inventory.ballistic, local === 0 ? viewer + 1 : 0);
      assert.equal(Object.hasOwn(unit, 'path'), local === 0);
      assert.equal(Object.hasOwn(projected, 'privateFuturePlan'), local === 0);
      if (local !== 0) assert.deepEqual(view.groups[local], {});
    }
    assert.equal(view.settlements[0].control, 0.7);
    assert.equal(view.settlements[0].owner, order.indexOf(2));
    assert.equal(view.ai, undefined);
    assert.equal(view.aiBySide, undefined);
    assert.equal(E.allied(view, 0, 2), true);
    assert.equal(E.hostile(view, 0, 3), true);
  }
  const own = s.groundUnits.find((u) => u.side === 2),
    ally = s.groundUnits.find((u) => u.side === 0);
  assert.equal(
    typeof executeCommand(s, 2, 'order', {
      ids: [own.id],
      aim: { mode: 'attack', targetId: ally.id, x: ally.x, z: ally.z },
    }),
    'string',
  );
  assert.equal(typeof executeCommand(s, 4, 'formation', { value: 'column' }), 'string');
});

test('allied capture progress is friendly and own vehicles may guard an allied central depot', () => {
  const s = E.createGame(810, { mode: 'coop' }),
    nodes = new Map();
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '', style: {} });
    return nodes.get(selector);
  };
  const card = {
    dataset: { district: E.DISTRICTS[0].id },
    classList: { toggle() {} },
    querySelector: get,
  };
  get('.district-focus').querySelector = get;
  const hud = Object.create(DistrictHUD.prototype);
  hud.host = { children: [card] };
  const u = E.makeGround(s, 0, 'apc', -1015, -950),
    foot = E.makeGround(s, 0, 'infantry', -1010, -950);
  s.groundUnits.push(u, foot);
  const d = s.districts[0];
  d.owner = 2;
  d.control = 1;
  hud.update(s, [u.id], true);
  assert.equal(card.dataset.owner, 'ally');
  assert.equal(get('.district-order').disabled, false);
  assert.match(get('.district-order').title, /охранять/);
  hud.update(s, [foot.id], true);
  assert.equal(get('.district-order').disabled, false);
  assert.equal(get('.district-repair').hidden, true, 'ally repair remains owner-only');
  d.owner = null;
  d.control = 0.5;
  d.capturing = 2;
  s.networkRevision++;
  hud.update(s, [u.id], true);
  assert.match(get('small').textContent, /Союзник 50%/);
});

test('context inspector makes allied cities read-only while own repair controls and settlement road reasons remain discoverable', (t) => {
  const previous = globalThis.document,
    nodes = new Map();
  const element = () => ({
    hidden: false,
    innerHTML: '',
    dataset: {},
    style: {},
    classList: { toggle() {} },
    append() {},
    querySelector(selector) {
      return get(selector);
    },
  });
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  globalThis.document = { querySelector: get, createElement: element };
  t.after(() => {
    if (previous) globalThis.document = previous;
    else delete globalThis.document;
  });
  const s = E.createGame(810, { mode: 'coop' }),
    host = get('#inspector');
  renderInspector({ state: s, selected: E.hqOf(s, 2).id, armySelection: [] });
  assert.match(host.innerHTML, /Союзный город/);
  assert.doesNotMatch(
    host.innerHTML,
    /data-repair|data-demolish|data-upgrade|data-rally|data-produce/,
  );
  renderInspector({ state: s, selected: E.hqOf(s, 0).id, armySelection: [] });
  assert.match(host.innerHTML, /data-repair/);
  assert.equal(
    get('#repair-button').disabled,
    true,
    'undamaged own HQ repair remains safely disabled',
  );
  assert.equal((settlementListHTML(s).match(/data-settlement-focus=/g) || []).length, 8);
  const html = settlementInspectorHTML(s, E.SETTLEMENTS[0].id);
  assert.match(html, /Проведите дорогу от своего штаба/);
  assert.doesNotMatch(html, /data-repair|data-demolish|data-upgrade/);
});

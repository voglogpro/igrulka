import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { ARMY_CATEGORIES, updateArmyRecruitment } from '../../src/ui/army-recruitment.js';
import { DistrictHUD } from '../../src/ui/districts.js';

function recruitmentDOM(t) {
  const nodes = new Map(),
    visible = new Set(ARMY_CATEGORIES.infantry.keys);
  const get = (selector) => {
    const role = selector.match(/^\[data-(?:recruit|army-target)="([^"]+)"\]$/)?.[1];
    if (role && !visible.has(role)) return null;
    if (!nodes.has(selector))
      nodes.set(selector, {
        textContent: '',
        innerHTML: '',
        dataset: {},
        classList: { toggle() {} },
        setAttribute() {},
        querySelector: (child) => get(`${selector} ${child}`),
      });
    return nodes.get(selector);
  };
  get('.army-recruit').dataset.recruitCategory = 'infantry';
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { activeElement: null, querySelector: get },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  return get;
}

test('live defence catalogue scans a large army a bounded number of times and stays fresh after losses, queue and goal changes', (t) => {
  const get = recruitmentDOM(t),
    state = E.createGame(8111),
    size = 1000;
  const site = {
    ...state.buildings.find((b) => b.side === 0),
    id: state.nextId++,
    key: 'barracks',
    armyQueue: [],
  };
  state.buildings.push(site);
  let reads = 0;
  for (let i = 0; i < size; i++) {
    const unit = E.makeGround(state, 0, 'infantry', -1100, -300);
    Object.defineProperty(unit, 'side', {
      enumerable: true,
      get() {
        reads++;
        return 0;
      },
    });
    state.groundUnits.push(unit);
  }
  E.setArmyTarget(state, 0, 'infantry', size + 5);
  updateArmyRecruitment({ state, recruitCount: 5, recruitMode: 'defend' });
  assert.ok(reads <= size * 3, `${reads} side reads for ${size} units`);
  assert.equal(get('[data-composition-count="infantry"]').textContent, '1000 + 0');
  assert.equal(get('[data-army-target="infantry"]').value, 1005);
  assert.equal(get('[data-recruit="infantry"]').disabled, false);
  assert.match(get('#army-list').innerHTML, /<b>1000<\/b>/);

  state.groundUnits[0].hp = 0;
  site.armyQueue.push({ key: 'infantry', progress: 0 });
  E.setArmyTarget(state, 0, 'infantry', E.ARMY_TARGET_MAX);
  reads = 0;
  updateArmyRecruitment({ state, recruitCount: 1, recruitMode: 'defend' });
  assert.ok(reads <= size * 3);
  assert.equal(get('[data-composition-count="infantry"]').textContent, '999 + 1');
  assert.equal(get('[data-army-target="infantry"]').value, E.ARMY_TARGET_MAX);
  assert.equal(get('[data-recruit="infantry"]').disabled, true);
  assert.match(get('#army-list').innerHTML, /<b>999<\/b>/);
  assert.equal(state.groundUnits.length, size, 'UI never removes a dead record or mutates army');
  assert.equal(site.armyQueue.length, 1, 'UI does not consume paid orders');
});

test('district orders handle a large selected army without repeated selection searches and exclude carried soldiers', () => {
  const state = E.createGame(8112),
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
  const selection = [];
  for (let i = 0; i < 1000; i++) {
    const unit = E.makeGround(state, 0, 'infantry', -1100, -300);
    unit.carrierId = 100000;
    state.groundUnits.push(unit);
    selection.push(unit.id);
  }
  selection.includes = () => assert.fail('quadratic selection membership search');
  hud.update(state, selection, true);
  assert.equal(get('.district-order').disabled, true);
  state.groundUnits.at(-1).carrierId = null;
  hud.update(state, selection, true);
  assert.equal(get('.district-order').disabled, false);
});

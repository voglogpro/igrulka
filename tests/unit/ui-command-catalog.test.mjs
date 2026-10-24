import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  ARMY_CATEGORIES,
  recruitmentHTML,
  availableRecruitment,
  refreshRecruitmentChoices,
} from '../../src/ui/army-recruitment.js';
import { gameLayout } from '../../src/ui/layout.js';
import { panelHTML } from '../../src/ui/panels.js';
import { UNIT_PROFILES, unitIllustration } from '../../src/ui/unit-profiles.js';

const base = (state, key, id) => state.buildings.push({ id, key, side: 0, progress: 1, hp: 200 });
test('resource HUD, arsenal and help expose no retired science or research actions', () => {
  const state = E.createGame(891);
  for (const html of [
    gameLayout(false),
    panelHTML({ panel: 'help', state }),
    panelHTML({ panel: 'attack', state, weapon: 'drone', count: 1 }),
  ]) {
    assert.doesNotMatch(html, /исслед|лаборатор|наук|data-panel="research"|id="science"/i);
  }
  const arsenal = panelHTML({ panel: 'attack', state, weapon: 'drone', count: 1 });
  for (const key of Object.keys(E.WEAPONS)) {
    assert.ok(arsenal.includes(`data-produce="${key}"`));
    assert.ok(arsenal.includes(`data-weapon="${key}"`));
  }
});

test('every role is available with its own facility, no technology gate, and local distinct art', () => {
  const state = E.createGame(892),
    illustrations = new Set();
  base(state, 'barracks', 901);
  base(state, 'vehiclebase', 902);
  state.sides[0].tech = [];
  for (const [category, { keys }] of Object.entries(ARMY_CATEGORIES)) {
    const html = recruitmentHTML({ state, armyCategory: category });
    for (const key of keys) {
      assert.ok(UNIT_PROFILES[key], key);
      const svg = unitIllustration(key);
      assert.ok(svg.includes('<svg') && !svg.includes('http') && !svg.includes('<image'));
      assert.ok(!illustrations.has(svg), key);
      illustrations.add(svg);
      assert.ok(html.includes(`data-recruit="${key}"`), key);
      assert.ok(html.includes(`data-army-target="${key}"`), key);
    }
    assert.doesNotMatch(html, /repeat-toggle|repeat-site|repeat-key|исслед|лаборатор|наук/i);
  }
});

test('missing facilities explain infantry versus vehicle recruitment and goals remain configurable', () => {
  const state = E.createGame(893);
  assert.deepEqual(availableRecruitment(state, ['infantry', 'leopard']), []);
  base(state, 'barracks', 901);
  assert.deepEqual(availableRecruitment(state, ['infantry', 'leopard']), ['infantry']);
  let html = recruitmentHTML({ state, armyCategory: 'vehicles' });
  assert.match(html, /Постройте бронезавод/);
  assert.ok(html.includes('data-army-target="leopard"'));
  assert.ok(!html.includes('data-recruit="leopard"'));
  base(state, 'vehiclebase', 902);
  assert.deepEqual(availableRecruitment(state, ['infantry', 'leopard']), ['infantry', 'leopard']);
});

test('open catalogue refreshes after facility completion and loss without replacing goal controls', (t) => {
  const state = E.createGame(894);
  const facility = { id: 902, key: 'vehiclebase', side: 0, hp: 200, progress: 0.5 };
  state.buildings.push(facility);
  const grid = { dataset: { recruitCategory: 'vehicles' }, innerHTML: '' };
  const input = { value: '50' };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      activeElement: input,
      querySelector: (selector) => (selector === '.army-recruit' ? grid : null),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  refreshRecruitmentChoices(state);
  assert.match(grid.innerHTML, /recruit-empty/);
  facility.progress = 1;
  refreshRecruitmentChoices(state);
  assert.match(grid.innerHTML, /data-recruit="leopard"/);
  assert.equal(input.value, '50');
  facility.hp = 0;
  refreshRecruitmentChoices(state);
  assert.match(grid.innerHTML, /recruit-empty/);
});

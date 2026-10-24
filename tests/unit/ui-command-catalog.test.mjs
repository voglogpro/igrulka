import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  researchAvailability,
  researchGraph,
  researchUnlocks,
  techTreeHTML,
} from '../../src/ui/tech-tree.js';
import {
  ARMY_CATEGORIES,
  recruitmentHTML,
  refreshRecruitmentChoices,
} from '../../src/ui/army-recruitment.js';
import { UNIT_PROFILES, unitIllustration } from '../../src/ui/unit-profiles.js';

function laboratory(state) {
  state.buildings.push({ id: 901, key: 'lab', side: 0, progress: 1, hp: 200 });
}

test('research availability explains prerequisites, facilities, resource shortfalls and running projects', () => {
  const state = E.createGame(861),
    f = state.sides[0];
  f.tech = [];
  f.research = null;
  assert.match(researchAvailability(state, 'lightArmor').text, /лаборатория/);
  assert.match(researchAvailability(state, 'armor').text, /Лёгкая бронетехника/);
  laboratory(state);
  f.science = 0;
  f.credits = 0;
  const shortage = researchAvailability(state, 'lightArmor');
  assert.equal(shortage.disabled, true);
  assert.match(shortage.text, /60 науки/);
  assert.match(shortage.text, /280 ₡/);
  f.science = 1000;
  f.credits = 10000;
  assert.equal(researchAvailability(state, 'lightArmor').kind, 'ready');
  assert.equal(E.research(state, 0, 'lightArmor'), true);
  f.research.progress = 0.5;
  assert.match(researchAvailability(state, 'lightArmor').text, /50%/);
  assert.equal(researchAvailability(state, 'bodyArmor').disabled, true);
  f.research = null;
  f.tech.push('lightArmor');
  assert.equal(researchAvailability(state, 'armor').kind, 'ready');
  assert.equal(researchAvailability(state, 'lightArmor').kind, 'done');
});

test('technology catalogue preserves command hooks and includes building unlocks', () => {
  const html = techTreeHTML();
  for (const key of Object.keys(E.TECH)) {
    assert.ok(html.includes(`data-research="${key}"`), key);
    assert.ok(html.includes(`data-research-reason="${key}"`), key);
  }
  assert.ok(researchUnlocks('missileDefense').includes(E.BUILDINGS.sam.name));
  assert.equal((html.match(/data-research-filter=/g) || []).length, 4);
  assert.equal((html.match(/class="tree-links"/g) || []).length, 4);
  for (const category of ['defense', 'army', 'city', 'aviation']) {
    const graph = researchGraph(category);
    for (const [parent, child] of graph.edges) assert.equal(E.TECH[child].requires, parent);
  }
  assert.ok(
    researchGraph('army').edges.some(
      ([parent, child]) => parent === 'autocannon' && child === 'mobileAA',
    ),
  );
});

test('every recruitable role has distinct local art and keeps recruitment and automation hooks', () => {
  const state = E.createGame(862),
    illustrations = new Set();
  state.sides[0].tech = Object.keys(E.TECH);
  state.buildings.push({ id: 902, key: 'barracks', side: 0, progress: 1, hp: 200 });
  for (const [category, { keys }] of Object.entries(ARMY_CATEGORIES)) {
    const html = recruitmentHTML({ state, armyCategory: category });
    for (const key of keys) {
      assert.ok(UNIT_PROFILES[key], key);
      const svg = unitIllustration(key);
      assert.ok(svg.includes('<svg'));
      assert.ok(!svg.includes('http') && !svg.includes('<image'));
      assert.ok(!illustrations.has(svg), `${key} should have a distinct silhouette`);
      illustrations.add(svg);
      assert.ok(html.includes(`data-recruit="${key}"`));
      assert.ok(html.includes(`data-recruit-state="${key}"`));
    }
    for (const id of [
      'rear-auto',
      'repeat-site',
      'repeat-key',
      'repeat-target',
      'repeat-toggle',
      'army-capacity',
      'army-queue',
      'army-list',
    ])
      assert.ok(html.includes(`id="${id}"`), id);
  }
});

test('open recruitment updates on facility completion and research without replacing focused inputs', (t) => {
  const state = E.createGame(888);
  state.sides[0].tech = [];
  const barracks = { id: 902, key: 'barracks', side: 0, progress: 0.5, hp: 200 };
  state.buildings.push(barracks);
  const grid = { dataset: { recruitCategory: 'vehicles' }, innerHTML: '' };
  const site = { dataset: {}, value: '902', innerHTML: '' };
  const type = { dataset: {}, value: 'armoredcar', innerHTML: '' };
  const target = { value: '24' };
  const elements = new Map([
    ['.army-recruit', grid],
    ['#repeat-site', site],
    ['#repeat-key', type],
    ['#repeat-target', target],
  ]);
  const document = {
    activeElement: target,
    querySelector: (selector) => elements.get(selector) || null,
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  refreshRecruitmentChoices(state);
  assert.match(grid.innerHTML, /recruit-empty/);
  barracks.progress = 1;
  refreshRecruitmentChoices(state);
  assert.match(grid.innerHTML, /data-recruit="armoredcar"/);
  assert.doesNotMatch(grid.innerHTML, /data-recruit="leopard"/);
  state.sides[0].tech.push('armor');
  refreshRecruitmentChoices(state);
  assert.match(grid.innerHTML, /data-recruit="leopard"/);
  assert.match(type.innerHTML, /value="leopard"/);
  assert.equal(type.value, 'armoredcar');
  const before = type.innerHTML;
  document.activeElement = type;
  state.sides[0].tech.push('heavyArmor');
  refreshRecruitmentChoices(state);
  assert.match(grid.innerHTML, /data-recruit="heavytank"/);
  assert.equal(type.innerHTML, before, 'native selector is left intact while focused');
  document.activeElement = target;
  refreshRecruitmentChoices(state);
  assert.match(type.innerHTML, /value="heavytank"/);
  assert.equal(type.value, 'armoredcar');
  assert.equal(target.value, '24');
  assert.equal(site.value, '902');
  barracks.hp = 0;
  refreshRecruitmentChoices(state);
  assert.match(grid.innerHTML, /recruit-empty/);
  assert.doesNotMatch(grid.innerHTML, /data-recruit=/);
});

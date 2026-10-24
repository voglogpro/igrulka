import test from 'node:test';
import assert from 'node:assert/strict';
import { TECH } from '../../src/game/index.js';
import { researchGraph } from '../../src/ui/tech-tree.js';
import { availableRecruitment } from '../../src/ui/army-recruitment.js';

test('army graph includes infantry and its external defense prerequisite with every real edge', () => {
  const graph = researchGraph('army');
  const nodes = new Map(graph.nodes.map((node) => [node.key, node]));
  assert.ok(nodes.has('bodyArmor'));
  assert.ok(nodes.has('fpvTeams'));
  assert.equal(nodes.get('autocannon').external, true);
  assert.ok(graph.edges.some(([from, to]) => from === 'autocannon' && to === 'mobileAA'));
  for (const [from, to] of graph.edges) {
    assert.equal(TECH[to].requires, from);
    assert.equal(nodes.get(to).column, nodes.get(from).column + 1);
  }
});

test('dependency canvases never overlap cards in the same column and cover all four categories', () => {
  const covered = new Set();
  for (const branch of ['defense', 'army', 'city', 'aviation']) {
    const graph = researchGraph(branch);
    for (const node of graph.nodes) {
      covered.add(node.key);
      assert.ok(node.row >= 0 && node.row < graph.rows);
      for (const other of graph.nodes) {
        if (node === other || node.column !== other.column) continue;
        assert.ok(Math.abs(node.row - other.row) >= 1, `${branch}: ${node.key} / ${other.key}`);
      }
    }
  }
  assert.deepEqual(covered, new Set(Object.keys(TECH)));
});

test('recruitment hides unopened types and requires a completed living barracks, not spare resources', () => {
  const state = { sides: [{ tech: [], credits: 0, materials: 0 }], buildings: [] };
  const keys = ['infantry', 'leopard', 'unknown'];
  assert.deepEqual(availableRecruitment(state, keys), []);
  state.buildings.push({ key: 'barracks', side: 0, hp: 100, progress: 0.5 });
  assert.deepEqual(availableRecruitment(state, keys), []);
  state.buildings[0].progress = 1;
  assert.deepEqual(availableRecruitment(state, keys), ['infantry']);
  state.sides[0].tech.push('armor');
  assert.deepEqual(availableRecruitment(state, keys), ['infantry', 'leopard']);
  state.buildings[0].demolished = true;
  assert.deepEqual(availableRecruitment(state, keys), []);
});

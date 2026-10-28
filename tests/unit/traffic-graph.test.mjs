import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../src/rendering/traffic.js';
import { projectPoint } from '../../src/game/city/road-network.js';

const key = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
// Frozen pre-pruning algorithm is the oracle. Array serialization below checks
// insertion order too, because the unchanged route search uses it to break ties.
function referenceGraph(roads, project = projectPoint) {
  const nodes = new Map(),
    edges = new Map();
  const node = (x, z) => {
    const k = key(x, z);
    if (!nodes.has(k)) {
      nodes.set(k, { id: k, x, z });
      edges.set(k, []);
    }
    return nodes.get(k);
  };
  for (const r of roads) {
    const cuts = [0, 1],
      dx = r.bx - r.ax,
      dz = r.bz - r.az,
      len2 = dx * dx + dz * dz || 1;
    for (const o of roads) {
      if (o === r) continue;
      for (const p of [
        [o.ax, o.az],
        [o.bx, o.bz],
      ]) {
        const q = project(p[0], p[1], r);
        if (q.distance < 3 && q.t > 0.01 && q.t < 0.99) cuts.push(q.t);
      }
      // Crossing streets.
      const ex = o.bx - o.ax,
        ez = o.bz - o.az,
        den = dx * ez - dz * ex;
      if (Math.abs(den) > 1e-6) {
        const t = ((o.ax - r.ax) * ez - (o.az - r.az) * ex) / den,
          u = ((o.ax - r.ax) * dz - (o.az - r.az) * dx) / den;
        if (t > 0.01 && t < 0.99 && u >= -0.01 && u <= 1.01) cuts.push(t);
      }
    }
    cuts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      if ((cuts[i + 1] - cuts[i]) * Math.sqrt(len2) < 1) continue;
      const a = node(r.ax + dx * cuts[i], r.az + dz * cuts[i]),
        b = node(r.ax + dx * cuts[i + 1], r.az + dz * cuts[i + 1]);
      if (a === b) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      edges.get(a.id).push({ to: b.id, d });
      edges.get(b.id).push({ to: a.id, d });
    }
  }
  return { nodes, edges };
}

const road = (ax, az, bx, bz) => ({ ax, az, bx, bz });
const ordered = (graph) => ({ nodes: [...graph.nodes], edges: [...graph.edges] });
function same(roads) {
  assert.deepEqual(ordered(buildGraph(roads)), ordered(referenceGraph(roads)));
}

test('traffic AABB pruning preserves exact X/T/diagonal/parallel/overlap graph and edge insertion order', () => {
  const common = [
    road(-30, 0, 30, 0),
    road(0, -30, 0, 30),
    road(0, 0, 20, 20),
    road(-20, -20, 20, 20),
    road(-20, 1.5, 20, 1.5),
    road(-12, 0, 12, 0),
    road(50, 0, 80, 0),
    road(60, 0, 60, 20),
    road(100, 100, 100, 100),
  ];
  same(common);
  same([...common, ...common.map((r) => ({ ...r }))]);
  same([common[0], common[0], ...common.slice(1)]);
  for (const distance of [2.999999, 3, 3.000001])
    for (const x of [0.999999, 1, 1.000001, 50, 98.999999, 99, 99.000001])
      same([road(0, 0, 100, 0), road(x, distance, x, 25)]);
});

test('one-percent crossing extensions and nearly parallel acceptance boundaries remain conservative', () => {
  for (const extension of [6.399999, 6.4, 6.400001]) {
    same([road(0, 0, 100, 0), road(50, extension, 50, extension + 640)]);
    same([road(0, 0, 100, 0), road(50, -extension - 640, 50, -extension)]);
  }
  const diagonal = 640 / Math.sqrt(2);
  for (const extension of [0.00999999, 0.01, 0.01000001])
    same([
      road(-100, 0, 100, 0),
      road(
        -diagonal * extension,
        diagonal * extension,
        -diagonal * (1 + extension),
        diagonal * (1 + extension),
      ),
    ]);
  for (const delta of [0.000000009, 0.00000001, 0.000000011])
    same([road(-50, 0, 50, 0), road(-50, -delta / 2, 50, delta / 2)]);
});

test('dense crossing and deterministic mixed street graphs remain byte-for-byte ordered equivalents', () => {
  const dense = Array.from({ length: 32 }, (_, i) => {
    const a = (i * Math.PI) / 32,
      x = Math.cos(a) * 300,
      z = Math.sin(a) * 300;
    return road(-x, -z, x, z);
  });
  same(dense);
  let seed = 813;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const mixed = Array.from({ length: 80 }, () => {
    const x = random() * 1200 - 600,
      z = random() * 1200 - 600;
    return road(x, z, x + (random() - 0.5) * 650, z + (random() - 0.5) * 650);
  });
  same(mixed);
});

test('500 sparse city roads avoid counted projection result allocations instead of comparing timings', () => {
  const roads = Array.from({ length: 500 }, (_, i) => {
    const x = (i % 20) * 80 - 760,
      z = Math.floor(i / 20) * 80 - 960;
    return road(x, z, x + 50, z);
  });
  const count = (build) => {
      let projections = 0,
        allocatedProjectionObjects = 0;
      const graph = build(roads, (...args) => {
        projections++;
        const result = projectPoint(...args);
        allocatedProjectionObjects++;
        return result;
      });
      return { graph, projections, allocatedProjectionObjects };
    },
    before = count(referenceGraph),
    after = count(buildGraph);
  assert.deepEqual(ordered(after.graph), ordered(before.graph));
  assert.equal(before.projections, 500 * 499 * 2);
  assert.equal(before.allocatedProjectionObjects, 499000);
  assert.equal(after.projections, 0);
  assert.equal(after.allocatedProjectionObjects, 0);
  assert.equal(after.graph.nodes.size, 1000);
});

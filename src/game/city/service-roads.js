import { passable, projectPoint, roadsTouch } from './road-network.js';

const caches = new WeakMap();
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const end = (r, b = false) => ({ x: b ? r.bx : r.ax, z: b ? r.bz : r.az });

export function serviceJunction(a, b) {
  const dx = a.bx - a.ax,
    dz = a.bz - a.az;
  const ex = b.bx - b.ax,
    ez = b.bz - b.az;
  const den = dx * ez - dz * ex;
  if (Math.abs(den) > 1e-7) {
    const t = ((b.ax - a.ax) * ez - (b.az - a.az) * ex) / den;
    const u = ((b.ax - a.ax) * dz - (b.az - a.az) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { x: a.ax + dx * t, z: a.az + dz * t };
  }
  let best = null;
  for (const [r, other] of [
    [a, b],
    [b, a],
  ])
    for (const p of [end(r), end(r, true)]) {
      const q = projectPoint(p.x, p.z, other);
      if (!best || q.distance < best.distance)
        best = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, distance: q.distance };
    }
  return best;
}

// Geometry is rebuilt only when road connectivity changes; never per vehicle/frame.
export function serviceRoadGraph(s, side) {
  let cached = caches.get(s);
  if (!cached || cached.revision !== s.networkRevision) {
    cached = { revision: s.networkRevision, sides: [] };
    caches.set(s, cached);
  }
  if (cached.sides[side]) return cached.sides[side];
  const roads = s.roads.filter((r) => r.side === side && passable(r)),
    nodes = [],
    positions = new Map(),
    byRoad = new Map();
  const add = (road, p) => {
    const key = `${p.x.toFixed(5)},${p.z.toFixed(5)}`;
    let id = positions.get(key);
    if (id === undefined) {
      id = nodes.length;
      positions.set(key, id);
      nodes.push({ x: p.x, z: p.z, links: new Map() });
    }
    byRoad.get(road.id).add(id);
  };
  for (const r of roads) {
    byRoad.set(r.id, new Set());
    add(r, end(r));
    add(r, end(r, true));
  }
  for (let i = 0; i < roads.length; i++)
    for (let j = i + 1; j < roads.length; j++) {
      const a = roads[i],
        b = roads[j];
      if (
        Math.max(a.ax, a.bx) + 2.5 < Math.min(b.ax, b.bx) ||
        Math.max(b.ax, b.bx) + 2.5 < Math.min(a.ax, a.bx) ||
        Math.max(a.az, a.bz) + 2.5 < Math.min(b.az, b.bz) ||
        Math.max(b.az, b.bz) + 2.5 < Math.min(a.az, a.bz) ||
        !roadsTouch(a, b)
      )
        continue;
      const p = serviceJunction(a, b);
      add(a, p);
      add(b, p);
    }
  for (const r of roads) {
    const list = [...byRoad.get(r.id)].sort(
      (a, b) =>
        projectPoint(nodes[a].x, nodes[a].z, r).t - projectPoint(nodes[b].x, nodes[b].z, r).t,
    );
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1],
        b = list[i],
        cost = distance(nodes[a], nodes[b]);
      nodes[a].links.set(b, cost);
      nodes[b].links.set(a, cost);
    }
  }
  const graph = {
    roads,
    nodes,
    byRoad,
    roadById: new Map(roads.map((r) => [r.id, r])),
    revision: s.networkRevision,
  };
  cached.sides[side] = graph;
  return graph;
}

export function serviceAccess(graph, point, reach = 6) {
  return graph.roads
    .map((road) => ({ ...projectPoint(point.x, point.z, road), road }))
    .filter((p) => p.distance <= reach)
    .sort((a, b) => a.distance - b.distance || a.road.id - b.road.id);
}

// One source search serves every prospective repair target of this vehicle.
export function serviceRoutes(graph, origin) {
  const access = serviceAccess(graph, origin),
    n = graph.nodes.length;
  const costs = new Float64Array(n).fill(Infinity),
    previous = new Int32Array(n).fill(-1);
  const heap = [];
  const push = (cost, id) => {
    let i = heap.length;
    heap.push([cost, id]);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= cost) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = [cost, id];
  };
  const pop = () => {
    const first = heap[0],
      last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++;
        if (heap[child][0] >= last[0]) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  for (const p of access)
    for (const id of graph.byRoad.get(p.road.id))
      costs[id] = Math.min(costs[id], distance(origin, p) + distance(p, graph.nodes[id]));
  for (let i = 0; i < n; i++) if (Number.isFinite(costs[i])) push(costs[i], i);
  while (heap.length) {
    const [cost, current] = pop();
    if (cost > costs[current]) continue;
    for (const [id, length] of graph.nodes[current].links)
      if (costs[current] + length < costs[id]) {
        costs[id] = costs[current] + length;
        previous[id] = current;
        push(costs[id], id);
      }
  }
  return (destination, roadId) => {
    if (!access.length || !graph.byRoad.has(roadId)) return null;
    let score = Infinity,
      last = -1,
      direct = null;
    for (const p of access)
      if (p.road.id === roadId) {
        score = distance(origin, p) + distance(p, destination);
        direct = p;
      }
    for (const id of graph.byRoad.get(roadId)) {
      const cost = costs[id] + distance(graph.nodes[id], destination);
      if (cost < score) {
        score = cost;
        last = id;
        direct = null;
      }
    }
    if (!Number.isFinite(score)) return null;
    const path = [];
    if (direct) path.push({ x: direct.x, z: direct.z });
    else {
      for (let id = last; id >= 0; id = previous[id])
        path.push({ x: graph.nodes[id].x, z: graph.nodes[id].z });
      path.reverse();
      // The first node can be far along the source road: enter through its actual projection.
      const first = path[0];
      const source = access.find((p) =>
        graph.byRoad.get(p.road.id).has(positionsIndex(graph, first)),
      );
      if (source) path.unshift({ x: source.x, z: source.z });
    }
    path.push({ x: destination.x, z: destination.z });
    return {
      path: path.filter((p, i) => distance(i ? path[i - 1] : origin, p) > 0.001),
      cost: score,
    };
  };
}

function positionsIndex(graph, p) {
  return graph.nodes.findIndex((n) => n.x === p.x && n.z === p.z);
}

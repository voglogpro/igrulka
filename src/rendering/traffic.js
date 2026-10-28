import * as T from '../../vendor/three/three.module.js';
import * as E from '../game/index.js';
import { projectPoint } from '../game/city/road-network.js';

// Commuter cars: residents drive from housing to workplaces along the real streets. This layer is
// only a picture of the economy (the income itself comes from the simulation), so it needs no
// state of its own beyond a few moving cars and a road graph rebuilt when the network changes.
const MAX_CARS = 70;
const PER_SIDE = 28;
const SPEED = 15;
const LANE = 2.1;
const PALETTE = ['#c9c4b1', '#8e9fa8', '#b47a68', '#6e8c70', '#d6c27a', '#58666d', '#a9b3a4'];

const key = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;

// Splits every street at the points where other streets touch it, then links consecutive points.
export function buildGraph(roads, project = projectPoint) {
  // Endpoint projection accepts distances below 3m; crossing tests extend the
  // other segment by 1%. Reject only pairs that cannot meet either condition.
  const bounds = new Map();
  for (const road of roads) {
    if (bounds.has(road)) continue;
    const padding = Math.max(3, Math.hypot(road.bx - road.ax, road.bz - road.az) * 0.01) + 1e-6;
    bounds.set(road, {
      minX: Math.min(road.ax, road.bx) - padding,
      maxX: Math.max(road.ax, road.bx) + padding,
      minZ: Math.min(road.az, road.bz) - padding,
      maxZ: Math.max(road.az, road.bz) + padding,
    });
  }
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
    const rBounds = bounds.get(r);
    for (const o of roads) {
      if (o === r) continue;
      const oBounds = bounds.get(o);
      if (
        rBounds.maxX < oBounds.minX ||
        rBounds.minX > oBounds.maxX ||
        rBounds.maxZ < oBounds.minZ ||
        rBounds.minZ > oBounds.maxZ
      )
        continue;
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

function nearestNode(graph, x, z) {
  let best = null,
    distance = Infinity;
  for (const n of graph.nodes.values()) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < distance) {
      distance = d;
      best = n;
    }
  }
  return best && Math.sqrt(distance) < 90 ? best : null;
}

function route(graph, from, to) {
  if (from === to) return [from];
  const dist = new Map([[from.id, 0]]),
    prev = new Map(),
    open = new Set([from.id]);
  while (open.size) {
    let current = null,
      best = Infinity;
    for (const id of open) {
      const d = dist.get(id);
      if (d < best) {
        best = d;
        current = id;
      }
    }
    open.delete(current);
    if (current === to.id) break;
    for (const e of graph.edges.get(current) || []) {
      const d = best + e.d;
      if (d < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, d);
        prev.set(e.to, current);
        open.add(e.to);
      }
    }
  }
  if (!prev.has(to.id)) return null;
  const path = [to];
  let id = to.id;
  while (prev.has(id)) {
    id = prev.get(id);
    path.push(graph.nodes.get(id));
  }
  return path.reverse();
}

export class Traffic {
  constructor(world) {
    this.world = world;
    this.cars = [];
    this.graphs = [null, null];
    this.revision = -1;
    this.body = new T.InstancedMesh(
      world.boxGeo,
      new T.MeshStandardMaterial({ roughness: 0.55, metalness: 0.2 }),
      MAX_CARS,
    );
    this.cabin = new T.InstancedMesh(
      world.boxGeo,
      new T.MeshStandardMaterial({ color: '#30424a', roughness: 0.3, metalness: 0.4 }),
      MAX_CARS,
    );
    this.lights = new T.InstancedMesh(
      world.boxGeo,
      new T.MeshBasicMaterial({ color: '#ffe9b0', toneMapped: false }),
      MAX_CARS * 2,
    );
    for (const mesh of [this.body, this.cabin, this.lights]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      world.scene.add(mesh);
    }
    this.body.castShadow = true;
    this.dummy = new T.Object3D();
    this.color = new T.Color();
    this.timer = 0;
    this.arrived = 0;
  }
  rebuild(state) {
    this.revision = state.networkRevision;
    for (const side of E.sideIds(state))
      this.graphs[side] = buildGraph(state.roads.filter((r) => r.side === side && E.passable(r)));
    this.cars = this.cars.filter((c) => c.route);
  }
  spawn(state, side) {
    const graph = this.graphs[side];
    if (!graph?.nodes.size) return;
    const live = state.buildings.filter(
        (b) => b.side === side && b.hp > 0 && b.progress >= 1 && !b.demolished,
      ),
      homes = live.filter((b) => E.BUILDINGS[b.key]?.residents),
      works = live.filter((b) => E.BUILDINGS[b.key]?.jobs);
    if (!homes.length || !works.length) return;
    const from = homes[Math.floor(Math.random() * homes.length)],
      to = works[Math.floor(Math.random() * works.length)],
      a = nearestNode(graph, from.x, from.z),
      b = nearestNode(graph, to.x, to.z);
    if (!a || !b) return;
    const path = route(graph, a, b);
    if (!path || path.length < 2) return;
    const outbound = Math.random() < 0.5,
      points = (outbound ? path : [...path].reverse()).map((n) => ({ x: n.x, z: n.z }));
    this.cars.push({
      side,
      points,
      leg: 0,
      t: 0,
      speed: SPEED * (0.85 + Math.random() * 0.3),
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      to: outbound ? to : from,
      x: points[0].x,
      z: points[0].z,
      yaw: 0,
      wait: 0,
      hue: Math.random(),
    });
  }
  update(state, dt, effects) {
    if (state.networkRevision !== this.revision) this.rebuild(state);
    this.timer += dt;
    if (this.timer > 0.6 && this.cars.length < MAX_CARS) {
      this.timer = 0;
      for (const side of E.sideIds(state)) {
        const employed = E.economy(state, side).commute.employed,
          wanted = Math.min(PER_SIDE, Math.round(employed / 5));
        if (this.cars.filter((c) => c.side === side).length < wanted) this.spawn(state, side);
      }
    }
    let shown = 0;
    for (const car of this.cars) {
      const a = car.points[car.leg],
        b = car.points[car.leg + 1];
      if (!b) {
        // Arrived: a little coin sparkle over the workplace, then the car leaves the scene.
        car.done = true;
        if (E.fogVisible(state, 0, car.x, car.z) || car.side === 0)
          effects?.glow.spawn(car.x, 4, car.z, {
            size: 1.6,
            life: 0.9,
            vy: 7,
            opacity: 0.8,
            color: [1, 2.4, 0.5],
          });
        this.arrived++;
        continue;
      }
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      car.t += (car.speed * dt) / length;
      while (car.t >= 1 && car.points[car.leg + 2]) {
        car.t -= 1;
        car.leg++;
      }
      const from = car.points[car.leg],
        to = car.points[car.leg + 1];
      if (!to) continue;
      const dx = to.x - from.x,
        dz = to.z - from.z,
        l = Math.hypot(dx, dz) || 1,
        t = Math.min(1, car.t);
      // Drive in the right-hand lane.
      car.x = from.x + dx * t - (dz / l) * LANE;
      car.z = from.z + dz * t + (dx / l) * LANE;
      car.yaw = Math.atan2(dx, dz);
      if (t >= 1 && !car.points[car.leg + 2]) car.leg++;
      // Cars of the other side are seen only inside the observed area.
      if (car.side !== 0 && !E.fogVisible(state, 0, car.x, car.z)) continue;
      if (shown >= MAX_CARS) break;
      const d = this.dummy;
      d.position.set(car.x, 1.3, car.z);
      d.rotation.set(0, car.yaw, 0);
      d.scale.set(2.5, 1.4, 5.4);
      d.updateMatrix();
      this.body.setMatrixAt(shown, d.matrix);
      this.body.setColorAt(shown, this.color.set(car.color));
      d.position.set(car.x - Math.sin(car.yaw) * 0.3, 2.4, car.z - Math.cos(car.yaw) * 0.2);
      d.scale.set(2.1, 1, 2.8);
      d.updateMatrix();
      this.cabin.setMatrixAt(shown, d.matrix);
      for (const side of [-1, 1]) {
        d.position.set(
          car.x + Math.sin(car.yaw) * 2.1 + Math.cos(car.yaw) * 0.7 * side,
          1.1,
          car.z + Math.cos(car.yaw) * 2.1 - Math.sin(car.yaw) * 0.7 * side,
        );
        d.scale.set(0.35, 0.25, 0.1);
        d.updateMatrix();
        this.lights.setMatrixAt(shown * 2 + (side > 0 ? 1 : 0), d.matrix);
      }
      shown++;
    }
    this.cars = this.cars.filter((c) => !c.done);
    for (const mesh of [this.body, this.cabin]) {
      mesh.count = shown;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.lights.count = shown * 2;
    this.lights.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
  diagnostics() {
    return { cars: this.cars.length, arrived: this.arrived };
  }
}

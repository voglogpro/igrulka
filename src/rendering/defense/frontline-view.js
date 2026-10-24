import * as T from '../../../vendor/three/three.module.js';
import { frontlineSegments } from './frontline-segments.js';

const SEGMENTS = 64;
const colour = (sector) =>
  sector.knowledge === 'unknown'
    ? [0.36, 0.46, 0.48]
    : sector.pressure >= 1.15
      ? [1, 0.48, 0.22]
      : [0.43, 0.78, 0.68];

function line(scene, dashed) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    'position',
    new T.BufferAttribute(new Float32Array(SEGMENTS * 6), 3).setUsage(T.DynamicDrawUsage),
  );
  geometry.setAttribute(
    'color',
    new T.BufferAttribute(new Float32Array(SEGMENTS * 6), 3).setUsage(T.DynamicDrawUsage),
  );
  geometry.setAttribute(
    'lineDistance',
    new T.BufferAttribute(new Float32Array(SEGMENTS * 2), 1).setUsage(T.DynamicDrawUsage),
  );
  geometry.setDrawRange(0, 0);
  const options = {
    vertexColors: true,
    transparent: true,
    opacity: dashed ? 0.55 : 0.85,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  };
  const mesh = new T.LineSegments(
    geometry,
    dashed
      ? new T.LineDashedMaterial({ ...options, dashSize: 6, gapSize: 5 })
      : new T.LineBasicMaterial(options),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 23;
  scene.add(mesh);
  return mesh;
}

// A tactical estimate, never a collision wall or a source of game visibility.
export class FrontlineView {
  constructor(scene, height = () => 0) {
    this.height = height;
    this.enabled = false;
    this.solid = line(scene, false);
    this.estimated = line(scene, true);
    this.report = null;
    this.previous = null;
    this.segments = 0;
    this.setVisible(false);
  }
  setVisible(value) {
    this.enabled = !!value;
    this.solid.visible = this.estimated.visible = this.enabled;
  }
  update(report) {
    this.report = report;
    if (this.previous === report) return;
    this.previous = report;
    const counts = [0, 0],
      meshes = [this.solid, this.estimated];
    let distance = 0;
    for (const { a, b, sector } of frontlineSegments(report)) {
      const uncertain = a.knowledge !== 'observed' || b.knowledge !== 'observed',
        pool = uncertain ? 1 : 0;
      const mesh = meshes[pool],
        attributes = mesh.geometry.attributes;
      const tint = colour(sector);
      for (let step = 0; step < 12 && counts[pool] < SEGMENTS; step++) {
        const slot = counts[pool]++;
        for (let end = 0; end < 2; end++) {
          const t = (step + end) / 12,
            x = a.x + (b.x - a.x) * t,
            z = a.z + (b.z - a.z) * t;
          attributes.position.setXYZ(slot * 2 + end, x, Math.max(0.9, this.height(x, z) + 0.9), z);
          attributes.color.setXYZ(slot * 2 + end, ...tint);
          attributes.lineDistance.setX(
            slot * 2 + end,
            distance + Math.hypot(b.x - a.x, b.z - a.z) * t,
          );
        }
      }
      distance += Math.hypot(b.x - a.x, b.z - a.z);
    }
    this.segments = counts[0] + counts[1];
    for (let i = 0; i < 2; i++) {
      const geometry = meshes[i].geometry;
      geometry.setDrawRange(0, counts[i] * 2);
      for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
      meshes[i].visible = this.enabled;
    }
  }
  diagnostics() {
    return {
      visible: this.enabled,
      sectors: this.report?.sectors.length || 0,
      segments: this.segments,
      capacity: SEGMENTS * 2,
    };
  }
  dispose() {
    for (const mesh of [this.solid, this.estimated]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}

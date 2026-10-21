import * as T from '../../../vendor/three/three.module.js';
import * as E from '../../game/index.js';
import { streetDecorationSpans } from './road-surfaces.js';
export function road(r, network) {
  const root = new T.Group(),
    length = Math.hypot(r.bx - r.ax, r.bz - r.az),
    width = r.connectorTo ? 5 : 10,
    damaged = !E.passable(r),
    street = network.find((s) => s.index === r.id);
  root.position.set((r.ax + r.bx) / 2, 0, (r.az + r.bz) / 2);
  root.rotation.y = Math.atan2(r.bx - r.ax, r.bz - r.az);
  root.userData.roadId = r.id;
  const asphaltColor = damaged ? '#292c2a' : r.hp < r.maxHp ? '#4d4d43' : '#41494b';
  if (damaged) {
    for (const sign of [-1, 1])
      this.box(root, 0, 0.2, sign * length * 0.32, width, 0.35, length * 0.35, asphaltColor);
    for (let i = 0; i < 6; i++) {
      const m = this.box(
        root,
        Math.sin(i * 2.4) * 3,
        0.3,
        Math.cos(i * 1.8) * 5,
        2 + (i % 3),
        0.7 + (i % 2),
        2 + (i % 3),
        '#42433b',
      );
      m.rotation.y = i;
    }
  } else {
    this.box(root, 0, -0.05, 0, width, 0.6, length, asphaltColor);
    for (const x of [-width / 2 - 0.4, width / 2 + 0.4])
      for (const [a, b] of streetDecorationSpans(street, network, x, 0.7))
        this.box(root, x, 0.12, (a + b) / 2 - length / 2, 0.7, 0.61, b - a, '#8b9085');
    if (!r.connectorTo)
      for (const [a, b] of streetDecorationSpans(street, network, 0, 1.2))
        for (let z = a + 3; z < b - 3; z += 13) {
          const paint = this.box(root, 0, 0.76, z - length / 2, 0.25, 0.025, 5, '#bbbca7', {
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -2,
          });
          paint.renderOrder = 12;
        }
  }
  if (!r.connectorTo && !damaged && length > 35) {
    this.cyl(root, width / 2 + 2, 0.7, 0, 0.18, 11, '#57655b');
    this.box(root, width / 2 + 1, 11.6, 0, 2.4, 0.25, 1.2, '#ffdca1', {
      emissive: '#ffbf6b',
      emissiveIntensity: 5,
    });
    const pool = new T.Mesh(
      new T.PlaneGeometry(18, 22),
      new T.MeshBasicMaterial({
        color: '#ffd39b',
        map: this.glowTexture,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(width / 2, 0.74, 0);
    root.add(pool);
  }
  this.scene.add(root);
  for (let t = 0; t <= 1; t += 0.07)
    this.clearTrees(r.ax + (r.bx - r.ax) * t, r.az + (r.bz - r.az) * t, width / 2 + 5);
  return root;
}

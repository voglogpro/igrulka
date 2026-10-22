import * as T from '../../vendor/three/three.module.js';

// One reusable path buffer and destination ring, regardless of cursor movement.
export class DeploymentPreview {
  constructor(scene) {
    this.root = new T.Group();
    this.root.visible = false;
    this.positions = new Float32Array(256 * 3);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.line = new T.Line(
      geometry,
      new T.LineBasicMaterial({
        color: '#b8e3ae',
        depthTest: false,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.line.frustumCulled = false;
    this.ring = new T.Mesh(
      new T.RingGeometry(8, 9, 48),
      new T.MeshBasicMaterial({
        color: '#b8e3ae',
        side: T.DoubleSide,
        depthWrite: false,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.root.add(this.line, this.ring);
    scene.add(this.root);
  }
  set(plan) {
    this.root.visible = !!plan?.point;
    if (!this.root.visible) return;
    const color = plan.ok ? '#b8e3ae' : '#ef9e7d';
    this.line.material.color.set(color);
    this.ring.material.color.set(color);
    this.ring.position.set(plan.point.x, 1.9, plan.point.z);
    const points = plan.origin ? [plan.origin, ...(plan.path || [])] : plan.path || [];
    const count = Math.min(256, points.length);
    for (let i = 0; i < count; i++) {
      const p = points[Math.floor((i * (points.length - 1)) / Math.max(1, count - 1))];
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = 2.1;
      this.positions[i * 3 + 2] = p.z;
    }
    this.line.geometry.setDrawRange(0, count);
    this.line.geometry.attributes.position.needsUpdate = true;
  }
}

import * as T from '../../../vendor/three/three.module.js';
import { DISTRICTS, districtStatus } from '../../game/territory/districts.js';
import { batchStatic } from '../mesh-utils.js';

const COLORS = ['#a9d6b4', '#db9c7d'];
export class DistrictView {
  constructor(world) {
    this.world = world;
    this.sites = new Map();
    const ringGeometry = new T.RingGeometry(62.5, 63.2, 96);
    const flagGeometry = new T.PlaneGeometry(9, 4.5);
    for (const d of DISTRICTS) {
      const root = new T.Group();
      root.userData.districtId = d.id;
      root.position.set(d.x, 0, d.z);
      const body = new T.Group(),
        ruins = new T.Group();
      root.add(body, ruins);
      world.box(body, 0, 0.1, 0, 28, 0.45, 24, '#777f71');
      world.box(body, -11, 0.6, -8, 4, 2.2, 4, '#5d6b58');
      if (d.type === 'depot') {
        for (let row = 0; row < 2; row++)
          for (let col = 0; col < 3; col++) {
            world.box(body, -7 + col * 5, 0.55, -6 + row * 7, 4.2, 2.6, 5.5, '#747451');
            world.box(body, -7 + col * 5, 3.15, -6 + row * 7, 3.7, 0.25, 5, '#a5a086');
            for (const band of [-1.4, 1.4])
              world.box(body, -7 + col * 5 + band, 0.55, -6 + row * 7, 0.18, 2.9, 5.6, '#454e43');
            world.box(body, -7 + col * 5, 1.7, -8.8 + row * 7, 1.2, 0.35, 0.2, '#bab499');
          }
      } else {
        world.box(body, -5, 0.6, 0, 7, 4, 8, '#63766e');
        world.box(body, -5, 4.6, 0, 6, 0.5, 7.5, '#97a59b');
        world.cyl(body, 7, 0.6, -4, 0.5, 15, '#b1b4a0');
        for (const y of [6, 10, 14]) world.box(body, 7, y, -4, 6, 0.25, 0.3, '#aeb6a5');
        world.box(body, 3, 0.6, 6, 4.5, 2.5, 3.5, '#586c63');
      }
      for (let i = 0; i < 9; i++) {
        const m = world.box(
          ruins,
          ((i % 3) - 1) * 6,
          0,
          (Math.floor(i / 3) - 1) * 6,
          3 + (i % 3),
          0.7 + (i % 2),
          4,
          '#424b41',
        );
        m.rotation.y = i * 0.74;
      }
      batchStatic(body);
      batchStatic(ruins);
      const mast = world.cyl(root, 11, 0.3, 9, 0.35, 13, '#b7bba6');
      const flag = new T.Mesh(
        flagGeometry,
        new T.MeshStandardMaterial({
          color: '#adb5a2',
          side: T.DoubleSide,
          roughness: 0.9,
        }),
      );
      flag.position.set(15.5, 11, 9);
      flag.castShadow = true;
      root.add(flag);
      const ring = new T.Mesh(
        ringGeometry,
        new T.MeshBasicMaterial({
          color: '#b8bfab',
          transparent: true,
          opacity: 0.2,
          side: T.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 2.1;
      root.add(ring);
      const progress = new T.Mesh(
        new T.RingGeometry(64, 65.3, 96),
        new T.MeshBasicMaterial({
          color: '#b8bfab',
          transparent: true,
          opacity: 0.8,
          side: T.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      progress.rotation.x = -Math.PI / 2;
      progress.position.y = 2.2;
      root.add(progress);
      world.scene.add(root);
      world.clearTrees(d.x, d.z, 19);
      this.sites.set(d.id, { root, body, ruins, flag, mast, ring, progress });
    }
  }
  pick(ray) {
    const roots = [...this.sites.values()]
      .filter((m) => m.root.visible)
      .flatMap((m) => [m.body.visible ? m.body : m.ruins, m.flag, m.mast]);
    for (const hit of ray.intersectObjects(roots, true)) {
      for (let o = hit.object; o; o = o.parent)
        if (o.userData.districtId) return o.userData.districtId;
    }
    return null;
  }
  sync(state) {
    for (const [id, m] of this.sites) {
      const d = districtStatus(state, id);
      m.root.visible = !!d;
      if (!d) continue;
      const color = d.owner == null ? '#adb5a2' : COLORS[d.owner];
      m.body.visible = d.hp > 0;
      m.ruins.visible = d.hp <= 0;
      m.flag.material.color.set(color);
      m.flag.rotation.y = 0.12 + Math.sin(state.time * 1.9 + d.x) * 0.12;
      m.flag.rotation.z = Math.sin(state.time * 2.4 + d.z) * 0.035;
      m.ring.material.color.set(d.contested || d.blocked ? '#e2ad7c' : color);
      m.ring.visible =
        !!this.world.armySelection.length ||
        this.world.groundTargeting === 'deploy' ||
        d.contested ||
        d.capturing != null;
      m.ring.material.opacity = d.contested ? 0.3 + Math.sin(state.time * 4) * 0.1 : 0.18;
      m.progress.material.color.set(d.control >= 0 ? COLORS[0] : COLORS[1]);
      m.progress.visible = d.capturing != null || d.contested;
      m.progress.material.opacity = Math.abs(d.control) < 0.999 ? 0.7 : 0.2;
      m.progress.geometry.setDrawRange(0, Math.floor(Math.abs(d.control) * 96) * 6);
    }
  }
}

import * as T from '../../../vendor/three/three.module.js';
import { BUILDINGS } from '../../game/index.js';
import { radarModel, defenseModel } from './defenses.js';
import { detailBuilding, batchStatic } from '../mesh-utils.js';
export function model(b) {
  const root = new T.Group();
  root.position.set(b.x, Math.max(0, this.height(b.x, b.z)), b.z);
  root.rotation.y = b.rotation || 0;
  root.userData.buildingId = b.id;
  const content = new T.Group();
  root.add(content);
  const d = BUILDINGS[b.key],
    size = d?.size || 30,
    own = b.side === 0,
    accent = own ? '#87c6a4' : '#d58e76';
  if (b.key !== 'gun') {
    this.box(root, 0, 0, 0, size + 7, 0.65, size + 7, '#6d706a');
    this.box(root, 0, 0.68, size / 2 + 2, size + 5, 0.15, 0.65, accent, {
      emissive: accent,
      emissiveIntensity: 0.35,
    });
  }
  this.facadeMat ||= new T.MeshStandardMaterial({
    color: '#e1e6dd',
    map: this.facade,
    emissiveMap: this.emission,
    emissive: '#ffcf93',
    emissiveIntensity: 1.1,
    roughness: 0.65,
  });
  const windowMat = this.facadeMat;
  this.sharedMaterials.add(windowMat);
  if (b.key === 'housing') {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 8,
        z = i % 2 ? 5 : -3,
        h = 20 + i * 6;
      this.box(content, x, 0.7, z, 6.5, h, 11, windowMat);
      this.box(content, x, h + 0.7, z, 7.2, 1, 11.6, '#a5ada4');
      this.box(content, x, h + 1.7, z, 2, 1.8, 3, '#6c7776');
      for (let y = 5; y < h; y += 5) this.box(content, x, y, z + 5.7, 7, 0.25, 1.4, '#b6bdb0');
    }
    this.box(content, 0, 0.7, 10, 21, 1, 2, '#a5a08d');
  } else if (b.key === 'industry') {
    this.box(content, -4, 0.7, 0, 19, 13, 23, '#8c8270');
    this.box(content, -4, 13.7, 0, 21, 1.2, 24, '#434f52');
    for (let i = 0; i < 4; i++) this.box(content, -4, 6 + i * 0.3, -12, 14, 1.4, 0.25, accent);
    for (let i = 0; i < 2; i++) {
      this.cyl(content, 10, 0.7, -7 + i * 13, 4.4, 17, '#9a9b8e');
      this.cyl(content, -9, 14, -7 + i * 10, 1.4, 19, '#777a73');
    }
    this.box(content, 0, 1, 15, 12, 3, 4, '#625f51');
  } else if (b.key === 'power') {
    this.box(content, -3, 0.7, 0, 16, 10, 18, '#7c8686');
    this.box(content, -3, 10.7, 0, 17, 1, 19, '#454f54');
    this.cyl(content, 8, 0.7, -5, 4.2, 24, '#9aa3a0');
    this.cyl(content, 8, 18, -5, 4.3, 2, accent);
    for (let i = 0; i < 4; i++) this.box(content, -10 + i * 5, 1, 12, 3.5, 4, 5, '#b0a17a');
    this.box(content, -3, 6, -9.2, 12, 2, 0.25, '#e1b96f', {
      emissive: '#e1b96f',
      emissiveIntensity: 0.6,
    });
  } else if (b.key === 'factory') {
    this.box(content, 0, 0.7, 0, 28, 15, 24, '#77817d');
    this.box(content, 0, 15.7, 0, 30, 1, 26, '#424e52');
    for (let i = 0; i < 3; i++) {
      this.box(content, -9 + i * 9, 0.8, 12.1, 6, 9, 0.4, '#39484d');
      this.box(content, -9 + i * 9, 10.5, 12.4, 6, 0.8, 0.5, '#f8cb8b', {
        emissive: '#f8cb8b',
        emissiveIntensity: 1,
      });
      this.box(content, -9 + i * 9, 16.8, 0, 5, 2, 18, '#929b96');
    }
    this.box(content, -10, 1, 17, 5, 3, 4, accent);
  } else if (b.key === 'barracks') {
    this.box(content, -5, 0.7, 0, 20, 9, 23, '#738171');
    this.box(content, -5, 9.7, 0, 22, 1.2, 25, '#424f46');
    this.box(content, 9, 0.7, -3, 9, 6, 16, '#7c8973');
    for (let i = 0; i < 3; i++) {
      this.box(content, -11 + i * 6, 2, 11.7, 4, 5, 0.4, '#334b40');
      this.box(content, -11 + i * 6, 7.4, 11.8, 4, 0.4, 0.4, accent);
    }
    this.cyl(content, 11, 1, 9, 0.16, 17, '#b7bfa5');
    this.box(content, 13, 14, 9, 4, 2.5, 0.1, accent);
  } else if (b.key === 'launcher') {
    this.box(content, 0, 0.7, 0, 20, 1, 20, '#505c58');
    this.box(content, -7, 1.7, 0, 5, 4, 15, '#687b6e');
    for (const x of [-1, 5]) {
      const rail = new T.Group();
      rail.position.set(x, 3, 0);
      rail.rotation.x = -0.22;
      this.box(rail, 0, 0, 0, 1.2, 0.7, 19, '#bbc3b4');
      this.box(rail, 0, 1, -2, 2, 1.2, 9, '#9eafa1');
      this.box(rail, 0, 1.4, -2, 10, 0.25, 2.5, '#b0bbae');
      content.add(rail);
    }
    for (const z of [-7, 7]) this.box(content, 0, 1.8, z, 18, 1, 1.2, '#788779');
    this.box(content, -7, 6, 4, 3, 2, 2, '#304e55');
  } else if (b.key === 'lab') {
    this.box(content, 0, 0.7, 0, 21, 16, 20, windowMat);
    this.box(content, 0, 17, 0, 23, 1, 22, '#bbc2bb');
    this.cyl(content, 0, 18, 0, 6, 3, '#bfc6bf');
    const dome = new T.Mesh(
      new T.SphereGeometry(5.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      this.mat('#aabdbf', { metalness: 0.3, roughness: 0.3 }),
    );
    dome.position.set(0, 21, 0);
    content.add(dome);
  } else if (b.key === 'hq') {
    this.box(content, 0, 2.5, 0, 12, 6, 26, '#6f8075');
    this.box(content, 0, 3, 12, 12, 8, 8, '#89988a');
    this.box(content, 0, 8, 16.1, 9, 2, 0.2, '#314e5b', { metalness: 0.3 });
    this.box(content, 0, 8.5, -2, 11, 4, 16, '#87988a');
    for (const x of [-6.5, 6.5])
      for (const z of [-9, 4, 12]) {
        const tire = new T.Mesh(new T.CylinderGeometry(2.5, 2.5, 1.8, 12), this.mat('#222b2a'));
        tire.rotation.z = Math.PI / 2;
        tire.position.set(x, 2.5, z);
        content.add(tire);
      }
    this.cyl(content, -4, 10, -9, 0.2, 20, '#aeb7af');
    this.box(content, -2, 26, -9, 4, 2.6, 0.25, accent, {
      emissive: accent,
      emissiveIntensity: 0.5,
    });
  } else if (b.key === 'radar') {
    radarModel(this, content, root);
  } else {
    defenseModel(this, b, content, root);
  }
  // Warm porch lights are emissive geometry, avoiding a point light per structure.
  if (!['gun', 'cannon', 'sam'].includes(b.key))
    for (const x of [-size * 0.4, size * 0.4]) {
      this.cyl(content, x, 0.8, size * 0.43, 0.18, 7, '#485951');
      this.box(content, x, 7.5, size * 0.43, 1.7, 0.35, 1.7, '#ffcf8e', {
        emissive: '#ffba63',
        emissiveIntensity: 3,
      });
      const glow = new T.Mesh(
        new T.PlaneGeometry(7, 9),
        new T.MeshBasicMaterial({
          color: '#ffcb79',
          map: this.glowTexture,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
          side: T.DoubleSide,
        }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(x, 0.73, size * 0.43);
      content.add(glow);
    }
  if (['housing', 'lab', 'factory', 'industry'].includes(b.key)) {
    this.box(content, 0, 0.68, -size * 0.5 - 1, size + 4, 0.06, 3, '#909385');
    for (let i = 0; i < 4; i++) {
      this.box(
        content,
        -size * 0.4 + i * size * 0.25,
        0.72,
        -size * 0.5 - 1,
        0.12,
        0.035,
        2.6,
        '#d0ceaf',
      );
      if (i % 2 === 0) {
        const car = new T.Group();
        this.box(car, 0, 0.4, 0, 1.7, 0.8, 3.5, i === 0 ? '#c5c2af' : '#576f7b');
        this.box(car, 0, 1.2, 0, 1.4, 0.6, 1.7, '#354952');
        car.position.set(-size * 0.3 + i * size * 0.2, 0.7, -size * 0.5 - 1);
        content.add(car);
      }
    }
  }
  const scaffold = new T.Group();
  const wire = new T.LineSegments(
    new T.EdgesGeometry(new T.BoxGeometry(size + 3, 22, size + 3)),
    new T.LineBasicMaterial({ color: '#d3b97b', transparent: true, opacity: 0.6 }),
  );
  wire.position.y = 11;
  scaffold.add(wire);
  for (let i = 0; i < 3; i++)
    this.box(scaffold, 0, 2 + i * 7, 0, size + 4, 0.25, size + 4, '#907e54');
  root.add(scaffold);
  this.clearTrees(b.x, b.z, size + 10);
  detailBuilding(this, b, content);
  const dynamic = new Set([root.userData.turret].filter(Boolean));
  batchStatic(content, dynamic);
  batchStatic(scaffold);
  this.scene.add(root);
  return { root, content, scaffold, dead: false, wasAlive: b.hp > 0 };
}

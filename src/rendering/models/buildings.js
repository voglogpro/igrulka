import * as T from '../../../vendor/three/three.module.js';
import { BUILDINGS } from '../../game/index.js';
import { radarModel, defenseModel } from './defenses.js';
import { detailBuilding, batchStatic } from '../mesh-utils.js';
import { serviceStationModel } from './city/service-station.js';
import { oilWellModel, oilTankModel, portModel, trainingModel } from './city/oil.js';
import { factionHex } from '../team-colors.js';
const tierTemplates = new WeakMap();
export const STATIC_BUILDING_KEYS = new Set([
  'housing',
  'industry',
  'power',
  'factory',
  'electronics',
  'barracks',
  'vehiclebase',
  'market',
  'ammofactory',
]);
const tiered = new Set(['gun', 'sam', 'cannon', 'launcher', 'silo', 'ammofactory', 'factory']);
function cloneTier(template, b, world) {
  const root = template.clone(true);
  root.position.set(b.x, Math.max(0, world.height(b.x, b.z)), b.z);
  root.rotation.y = b.rotation || 0;
  root.userData.buildingId = b.id;
  root.userData.buildingKey = b.key;
  root.userData.turret = root.getObjectByName('building-turret');
  root.userData.pitch = root.getObjectByName('building-pitch');
  world.clearTrees(b.x, b.z, (BUILDINGS[b.key]?.size || 30) + 10);
  world.scene.add(root);
  return {
    root,
    content: root.getObjectByName('building-content'),
    scaffold: root.getObjectByName('building-scaffold'),
    dead: false,
    wasAlive: b.hp > 0,
  };
}
export function model(b) {
  let cache = tierTemplates.get(this);
  if (!cache) tierTemplates.set(this, (cache = new Map()));
  const tierKey = `${b.key}/${b.side}/${b.level || 0}`;
  if ((tiered.has(b.key) || STATIC_BUILDING_KEYS.has(b.key)) && cache.has(tierKey))
    return cloneTier(cache.get(tierKey), b, this);
  const root = new T.Group();
  root.position.set(b.x, Math.max(0, this.height(b.x, b.z)), b.z);
  root.rotation.y = b.rotation || 0;
  root.userData.buildingId = b.id;
  root.userData.buildingKey = b.key;
  const content = new T.Group();
  content.name = 'building-content';
  root.add(content);
  const d = BUILDINGS[b.key],
    size = d?.size || 30,
    accent = factionHex(b.side);
  if (!['gun', 'port', 'navalbase'].includes(b.key)) {
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
  if (b.key === 'service') {
    serviceStationModel(this, content, accent);
  } else if (b.key === 'oilwell') {
    oilWellModel(this, content, root, accent);
  } else if (b.key === 'oiltank') {
    oilTankModel(this, content, accent);
  } else if (b.key === 'port' || b.key === 'navalbase') {
    portModel(this, content, b.key === 'navalbase' ? '#6f7b7e' : accent);
  } else if (b.key === 'training') {
    trainingModel(this, content, accent);
  } else if (b.key === 'housing') {
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
  } else if (b.key === 'electronics') {
    // Compact clean assembly hall, restrained green cladding and rooftop air handling.
    this.box(content, 0, 0.7, 0, 28, 12, 24, '#40594b');
    this.box(content, 0, 12.7, 0, 30, 1, 26, '#293d35');
    this.box(content, -8, 0.7, 7, 9, 8, 10, '#577062');
    this.box(content, -8, 8.7, 7, 10, 0.7, 11, '#334b40');
    for (const x of [-8, 1, 10]) {
      this.box(content, x, 5.5, 12.1, 6, 2.8, 0.25, '#8da79a');
      this.box(content, x, 9, 12.3, 6, 0.3, 0.3, accent);
    }
    this.box(content, 5, 0.8, 12.2, 5, 5, 0.4, '#2c4238');
    for (const x of [-7, 6]) {
      this.box(content, x, 13.7, -3, 7, 2.5, 9, '#788a7f');
      for (let i = 0; i < 3; i++) this.box(content, x, 16.2, -6 + i * 3, 5.5, 0.2, 0.35, '#344b3f');
    }
    this.box(content, 13.9, 2, -5, 0.25, 7, 10, '#34483e');
    for (let i = 0; i < 4; i++) this.box(content, 14.1, 3 + i * 1.5, -5, 0.2, 0.18, 8, '#829184');
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
    if (b.level > 0) {
      this.box(content, 10, 16.7, -6, 3, 1.8, 3.5, '#4c6258');
      this.box(content, 10, 18.5, -6, 0.12, 4, 0.12, '#9caf9b');
    }
    if (b.level > 1) {
      this.box(content, -10, 1, 17, 5.4, 4.2, 4.2, '#647869');
      this.box(content, 5, 16.7, -6, 3, 1.8, 3.5, '#a6aa83');
    }
  } else if (b.key === 'vehiclebase') {
    // Wide assembly bays and an overhead crane distinguish armour production from drones.
    this.box(content, -3, 0.7, -2, 34, 13, 28, '#747e76');
    this.box(content, -3, 13.7, -2, 36, 1.2, 30, '#414f50');
    for (const x of [-13, 1, 12]) {
      this.box(content, x, 0.8, 12.2, 9, 10, 0.5, '#34443f');
      this.box(content, x, 11.4, 12.5, 8, 0.6, 0.4, accent, {
        emissive: accent,
        emissiveIntensity: 0.6,
      });
      for (const z of [-4, 5, 14]) this.box(content, x, 0.8, z, 0.5, 0.1, 5, '#b2a46d');
    }
    for (const x of [-20, 18]) this.box(content, x, 0.7, -2, 1, 19, 1, '#b19a60');
    this.box(content, -1, 19.7, -2, 40, 1, 1.5, '#b19a60');
    this.box(content, -6, 17, -2, 3, 2.2, 3, '#4f5d54');
    this.cyl(content, -6, 12, -2, 0.14, 5, '#222b29');
    this.box(content, -12, 1, -20, 11, 3, 5, '#657564');
    this.box(content, -12, 4, -20, 5, 2, 4, '#7d8b70');
    this.box(content, -12, 4.6, -15, 0.6, 0.6, 8, '#414e42');
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
  } else if (b.key === 'silo') {
    this.box(content, 0, 0.7, 0, 23, 1.2, 23, '#515e58');
    this.box(content, -8, 1.9, 0, 6, 4, 17, '#697c6b');
    for (const x of [0, 7]) {
      this.box(content, x, 1.9, 0, 5.6, 0.8, 17, '#394b44');
      this.box(content, x, 2.7, 0, 5.2, 0.5, 16, '#91a18c');
      this.box(content, x, 3.2, -5, 4.5, 0.12, 0.7, accent);
    }
    this.cyl(content, -8, 6, -5, 0.14, 7, '#6b7b70');
    this.box(content, -8, 5.9, 5, 3, 1.2, 2, '#314c50');
  } else if (b.key === 'ammofactory') {
    this.box(content, -3, 0.7, -3, 25, 11, 23, '#7c8070');
    this.box(content, -3, 11.7, -3, 27, 1, 25, '#414f4c');
    for (let i = 0; i < 2 + (b.level || 0); i++) {
      const x = -12 + i * 7;
      this.box(content, x, 0.8, 9, 5, 6, 0.4, '#31433d');
      this.box(content, x, 7.1, 9.2, 5, 0.5, 0.3, accent);
      this.box(content, x, 0.8, 14, 0.3, 0.08, 7, '#c7b57f');
    }
    for (const z of [-8, -1, 6]) {
      this.box(content, 13, 0.8, z, 5, 3, 5, '#697456');
      this.box(content, 13, 3.8, z, 5.2, 0.2, 5.2, '#a69b77');
    }
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
  } else if (b.key === 'market') {
    // Covered stalls with striped awnings, crates, a loading dock and a flag over the entrance.
    this.box(content, 0, 0.7, -4, 20, 6.5, 12, '#a99f87');
    this.box(content, 0, 7.2, -4, 21.5, 0.9, 13.5, '#59655d');
    for (let i = 0; i < 6; i++) {
      this.box(content, -8.5 + i * 3.4, 4.6, 6.5, 3.4, 0.4, 7, i % 2 ? '#d7ccb0' : '#b8524a');
      this.box(content, -8.5 + i * 3.4, 0.7, 9.4, 3, 1.4, 1.6, '#7b6a50');
    }
    for (let i = 0; i < 5; i++) {
      this.box(content, -8 + i * 4, 0.7, 4, 2.2, 1.8, 2.2, i % 2 ? '#8d6f45' : '#a2854f');
      this.box(content, -8 + i * 4, 2.5, 4, 1.6, 1.2, 1.6, '#b79a62');
    }
    this.box(content, 12, 0.7, -4, 4, 3.2, 10, '#667a8a');
    this.box(content, 12, 3.9, -4, 4.4, 0.4, 10.4, '#4c5b66');
    this.cyl(content, -10, 0.7, -10, 0.25, 17, '#aeb7af');
    this.box(content, -7.5, 15, -10, 5, 2.6, 0.25, accent, {
      emissive: accent,
      emissiveIntensity: 0.5,
    });
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
  if (['launcher', 'silo'].includes(b.key)) {
    for (let tier = 0; tier < (b.level || 0); tier++) {
      const z = -7 + tier * 7;
      this.box(content, 9, 1, z, 4.5, 4, 5.5, '#586b59');
      this.box(content, 9, 5, z, 4.8, 0.35, 5.8, '#9aa58b');
      this.box(content, 9, 3, z + 2.8, 2.5, 0.5, 0.1, accent);
    }
  }
  // Warm porch lights are emissive geometry, avoiding a point light per structure.
  if (
    !['gun', 'cannon', 'sam', 'oilwell', 'oiltank', 'port', 'navalbase', 'training'].includes(b.key)
  )
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
  if (['housing', 'lab', 'factory', 'vehiclebase', 'industry'].includes(b.key)) {
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
  scaffold.name = 'building-scaffold';
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
  const dynamic = new Set([root.userData.turret, root.userData.pump].filter(Boolean));
  batchStatic(content, dynamic);
  batchStatic(scaffold);
  if (tiered.has(b.key) || STATIC_BUILDING_KEYS.has(b.key)) {
    for (const [key, name] of [
      ['turret', 'building-turret'],
      ['pitch', 'building-pitch'],
    ])
      if (root.userData[key]) root.userData[key].name = name;
    const data = root.userData;
    root.userData = { buildingId: b.id };
    cache.set(tierKey, root.clone(true));
    root.userData = data;
    root.traverse((object) => {
      if (object.geometry) this.sharedGeometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        if (material) this.sharedMaterials.add(material);
    });
  }
  this.scene.add(root);
  return { root, content, scaffold, dead: false, wasAlive: b.hp > 0 };
}

import * as T from '../../vendor/three/three.module.js';
import { BUILDINGS, problemMarkers } from '../game/index.js';

const CAPACITY = 96;
const COLORS = {
  road: '#d8a24a',
  power: '#e3c53d',
  electronics: '#4fb3c9',
  oil: '#8f7b5d',
  materials: '#a9a39a',
  credits: '#7fc66a',
  weapons: '#d26a4a',
  ammo: '#e05b4a',
  repair: '#c98a3a',
};

// One small round badge per kind, drawn once on a canvas: a city-builder style warning icon.
function badge(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,24,26,0.85)';
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = COLORS[kind];
  g.stroke();
  g.fillStyle = COLORS[kind];
  g.strokeStyle = COLORS[kind];
  g.lineWidth = 4;
  g.lineCap = 'round';
  const path = (points, fill = true) => {
    g.beginPath();
    points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    if (fill) g.fill();
    else g.stroke();
  };
  if (kind === 'power')
    path([
      [36, 12],
      [22, 35],
      [31, 35],
      [27, 52],
      [43, 28],
      [33, 28],
    ]);
  else if (kind === 'road') {
    path(
      [
        [24, 14],
        [18, 50],
      ],
      false,
    );
    path(
      [
        [40, 14],
        [46, 50],
      ],
      false,
    );
    for (const y of [20, 32, 44])
      path(
        [
          [32, y],
          [32, y + 5],
        ],
        false,
      );
  } else if (kind === 'electronics') {
    g.fillRect(22, 22, 20, 20);
    for (const v of [26, 32, 38]) {
      g.fillRect(v - 1, 15, 2, 6);
      g.fillRect(v - 1, 43, 2, 6);
      g.fillRect(15, v - 1, 6, 2);
      g.fillRect(43, v - 1, 6, 2);
    }
  } else if (kind === 'oil') {
    g.beginPath();
    g.moveTo(32, 12);
    g.quadraticCurveTo(48, 34, 42, 44);
    g.arc(32, 41, 11, 0.3, Math.PI - 0.3);
    g.quadraticCurveTo(16, 34, 32, 12);
    g.fill();
  } else if (kind === 'ammo')
    for (const x of [22, 32, 42]) {
      g.fillRect(x - 3, 26, 6, 22);
      g.beginPath();
      g.arc(x, 26, 3, Math.PI, 0);
      g.fill();
    }
  else if (kind === 'weapons') {
    path([
      [32, 10],
      [38, 22],
      [38, 42],
      [26, 42],
      [26, 22],
    ]);
    path([
      [26, 36],
      [19, 48],
      [26, 46],
    ]);
    path([
      [38, 36],
      [45, 48],
      [38, 46],
    ]);
  } else if (kind === 'repair') {
    path(
      [
        [20, 44],
        [40, 24],
      ],
      false,
    );
    g.beginPath();
    g.arc(42, 22, 7, 0, Math.PI * 2);
    g.stroke();
  } else {
    g.font = 'bold 30px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(kind === 'credits' ? '₡' : '?', 32, 34);
  }
  const texture = new T.CanvasTexture(c);
  texture.colorSpace = T.SRGBColorSpace;
  return new T.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
}

// Pooled sprites, refreshed a few times a second from the player's own problems only.
export class ProblemIcons {
  constructor(world) {
    this.world = world;
    this.materials = new Map();
    this.sprites = Array.from({ length: CAPACITY }, () => {
      const sprite = new T.Sprite();
      sprite.visible = false;
      sprite.renderOrder = 20;
      world.scene.add(sprite);
      return sprite;
    });
    this.next = 0;
    this.markers = [];
  }
  material(kind) {
    if (!this.materials.has(kind)) this.materials.set(kind, badge(kind));
    return this.materials.get(kind);
  }
  update(state, time, height) {
    if (time < this.next && this.markers) return;
    this.next = time + 0.5;
    this.markers = state ? problemMarkers(state, 0) : [];
    const bob = Math.sin(time * 2.5) * 0.6;
    this.sprites.forEach((sprite, i) => {
      const m = this.markers[i];
      sprite.visible = !!m;
      if (!m) return;
      const building = m.id != null && state.buildings.find((b) => b.id === m.id);
      sprite.material = this.material(m.kind);
      sprite.position.set(
        m.x,
        Math.max(0, height(m.x, m.z)) +
          (building ? (BUILDINGS[building.key]?.height || 12) + 10 : 9) +
          bob,
        m.z,
      );
      sprite.scale.setScalar(building ? 11 : 10);
    });
  }
  dispose() {
    for (const sprite of this.sprites) sprite.removeFromParent();
    for (const material of this.materials.values()) {
      material.map.dispose();
      material.dispose();
    }
  }
}

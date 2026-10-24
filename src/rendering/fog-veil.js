import * as T from '../../vendor/three/three.module.js';
import { GRID, visionOf } from '../game/vision-grid.js';

// A single translucent plane over the playable valley. One texel per vision cell; bilinear
// filtering softens the edge of every observed circle, and cells fade in and out over time.
const DARK = 100;
export class FogVeil {
  constructor(scene) {
    this.size = GRID.cols * GRID.rows;
    this.data = new Uint8Array(this.size * 4);
    this.alpha = new Float32Array(this.size).fill(DARK);
    this.texture = new T.DataTexture(this.data, GRID.cols, GRID.rows, T.RGBAFormat);
    this.texture.magFilter = this.texture.minFilter = T.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    for (let i = 0; i < this.size; i++) {
      this.data[i * 4] = 8;
      this.data[i * 4 + 1] = 16;
      this.data[i * 4 + 2] = 20;
      this.data[i * 4 + 3] = DARK;
    }
    this.texture.needsUpdate = true;
    this.mesh = new T.Mesh(
      new T.PlaneGeometry(GRID.cols * GRID.cell, GRID.rows * GRID.cell),
      new T.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(
      GRID.ox + (GRID.cols * GRID.cell) / 2,
      7,
      GRID.oz + (GRID.rows * GRID.cell) / 2,
    );
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(state, dt) {
    const vision = visionOf(state, 0),
      k = 1 - Math.exp(-Math.min(0.25, dt) * 5);
    let changed = false,
      fading = false;
    for (let i = 0; i < this.size; i++) {
      // A working radar lifts the whole veil; otherwise only observed cells are clear.
      const goal = vision.radar || vision.grid[i] ? 0 : DARK,
        now = this.alpha[i];
      if (goal === now) continue;
      changed = true;
      if (Math.abs(goal - now) > 0.6) {
        this.alpha[i] = now + (goal - now) * k;
        fading = true;
      } else this.alpha[i] = goal;
      this.data[i * 4 + 3] = Math.round(this.alpha[i]);
    }
    if (changed) this.texture.needsUpdate = true;
    this.mesh.visible = !vision.radar || fading;
  }
}

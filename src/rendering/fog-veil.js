import * as T from '../../vendor/three/three.module.js';
// Legacy adapter only. The live world no longer constructs an observation veil.
export class FogVeil {
  constructor() {
    this.texture = new T.DataTexture(new Uint8Array(4), 1, 1, T.RGBAFormat);
    this.texture.needsUpdate = true;
    this.origin = new T.Vector2();
    this.extent = new T.Vector2(1, 1);
    this.active = false;
  }
  update() {}
}

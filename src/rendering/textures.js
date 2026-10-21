import * as T from '../../vendor/three/three.module.js';
export function makeGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'),
    gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, '#ffffffb0');
  gradient.addColorStop(0.25, '#ffffff65');
  gradient.addColorStop(1, '#ffffff00');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 128, 128);
  return new T.CanvasTexture(c);
}

export function makeFacade() {
  const c = document.createElement('canvas'),
    e = document.createElement('canvas');
  c.width = e.width = 128;
  c.height = e.height = 256;
  const g = c.getContext('2d'),
    glow = e.getContext('2d');
  g.fillStyle = '#89918b';
  g.fillRect(0, 0, 128, 256);
  glow.fillStyle = '#000';
  glow.fillRect(0, 0, 128, 256);
  let seed = 17;
  for (let y = 6; y < 256; y += 23)
    for (let x = 8; x < 128; x += 26) {
      seed = (seed * 16807) % 2147483647;
      const lit = seed % 4 === 0;
      g.fillStyle = lit ? '#e2bd80' : seed % 3 === 0 ? '#617782' : '#354951';
      g.fillRect(x, y, 14, 15);
      g.fillStyle = '#263839';
      g.fillRect(x + 6, y, 1, 15);
      g.fillRect(x, y + 15, 14, 2);
      if (lit) {
        glow.fillStyle = '#ffd798';
        glow.fillRect(x, y, 14, 15);
      }
    }
  this.emission = new T.CanvasTexture(e);
  this.emission.colorSpace = T.SRGBColorSpace;
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

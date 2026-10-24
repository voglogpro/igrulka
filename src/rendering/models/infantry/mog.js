import * as T from '../../../../vendor/three/three.module.js';
import { batchStatic } from '../../mesh-utils.js';
export function mogModel(w, b, content, root, crew = true) {
  const position = new T.Group();
  position.name = 'field-position';
  position.userData.dynamic = true;
  content.add(position);
  const cloth = '#8b8266',
    olive = b.side === 0 ? '#71836a' : '#8a7963';
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 17; i++) {
      const a = ((i + row * 0.5) / 20 + 0.08) * Math.PI * 2,
        x = Math.cos(a) * 7.4,
        z = Math.sin(a) * 7.4,
        bag = new T.Mesh(w.sphereGeo, w.mat(i % 3 === 0 ? '#777258' : cloth, { roughness: 1 }));
      bag.scale.set(1.4, 0.43, 0.85);
      bag.position.set(x, 0.55 + row * 0.8, z);
      bag.rotation.y = -a + Math.PI / 2;
      bag.castShadow = true;
      bag.receiveShadow = true;
      position.add(bag);
    }
  for (const x of [-5, 4]) {
    w.box(position, x, 0.2, 3, 2.6, 1.6, 3, '#57654c');
    w.box(position, x, 1.8, 3, 2.7, 0.15, 3.1, '#8a9675');
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2,
      leg = w.box(position, Math.cos(a) * 1.2, 0.2, Math.sin(a) * 1.2, 0.2, 2.1, 0.2, '#405548');
    leg.rotation.z = Math.sin(a) * 0.5;
    leg.rotation.x = Math.cos(a) * 0.5;
  }
  const turret = new T.Group();
  turret.position.y = 1.1;
  root.userData.turret = turret;
  content.add(turret);
  const pitch = new T.Group();
  pitch.position.y = 1;
  turret.add(pitch);
  root.userData.pitch = pitch;
  pitch.userData.muzzles = [[0, 0.1, -5.8]];
  w.box(pitch, 0, -0.3, 0.6, 0.85, 0.8, 2.5, '#3a4b41');
  w.box(pitch, 0, 0.5, 0.3, 0.4, 0.35, 0.5, '#536959');
  w.box(pitch, 1, -0.5, 1, 1.3, 0.8, 1.5, '#7a8460');
  const barrel = new T.Mesh(w.cylGeo, w.mat('#273b35', { metalness: 0.5 }));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.1, -3);
  barrel.scale.set(0.15, 5.5, 0.15);
  pitch.add(barrel);
  w.box(pitch, 0, -0.2, -1, 0.5, 0.55, 1.8, '#485b4c');
  w.box(pitch, 0, 0.3, -5.5, 0.22, 0.35, 0.2, '#263b32');
  if (crew)
    for (const [x, z, sitting] of [
      [0, 2.8, true],
      [-3.6, 1, true],
      [3, -2, false],
    ]) {
      w.box(content, x, 0.3, z, 0.65, sitting ? 0.5 : 1.1, 0.65, olive);
      w.box(content, x, sitting ? 0.7 : 1.3, z, 1, 1.1, 0.7, olive);
      w.cyl(content, x, sitting ? 1.9 : 2.5, z, 0.32, 0.35, '#b7a083');
      w.cyl(content, x, sitting ? 2.25 : 2.85, z, 0.45, 0.22, olive);
      w.box(content, x - 0.65, sitting ? 0.85 : 1.4, z + 0.35, 0.35, 0.8, 0.5, olive);
      w.box(content, x + 0.65, sitting ? 1 : 1.6, z + 0.35, 0.35, 0.55, 1, olive);
    }
  batchStatic(position);
  batchStatic(pitch);
  batchStatic(turret, new Set([pitch]));
}

import { mogModel } from './infantry/mog.js';
import * as T from '../../../vendor/three/three.module.js';
import { batchStatic } from '../mesh-utils.js';
export function defenseModel(w, b, content, root) {
  if (b.key === 'gun') {
    mogModel(w, b, content, root);
    return;
  }
  const gun = b.key === 'gun',
    sam = b.key === 'sam',
    steel = '#566b60',
    metal = '#34484a',
    olive = '#82917b',
    trim = b.side === 0 ? '#a3c6ac' : '#c8a58d';
  w.cyl(content, 0, 0.75, 0, sam ? 6 : 4.5, 0.9, metal);
  w.cyl(content, 0, 1.65, 0, sam ? 4.8 : 3.3, 1.4, steel);
  if (sam) {
    w.box(content, 0, 1, 0, 13, 1.5, 16, steel);
    for (const x of [-7, 7]) {
      w.box(content, x, 0.8, 0, 2, 2.6, 14, '#2c3d39');
      for (const z of [-5, 0, 5]) {
        const wheel = new T.Mesh(new T.CylinderGeometry(1.2, 1.2, 1.8, 12), w.mat('#586658'));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 2, z);
        content.add(wheel);
      }
      for (let i = 0; i < 8; i++) w.box(content, x, 3.3, -6 + i * 1.7, 2.2, 0.16, 1.1, '#7b8774');
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4,
        x = Math.cos(a) * 4,
        z = Math.sin(a) * 4,
        leg = w.box(content, x, 1, z, 1, 1, 6.5, steel);
      leg.rotation.y = -a + Math.PI / 2;
      w.box(content, x * 1.65, 0.7, z * 1.65, 2, 0.4, 2, metal);
    }
    w.cyl(content, 0, 2.7, 0, gun ? 1.8 : 2.5, 1.3, olive);
  }
  const turret = new T.Group();
  turret.position.y = 3;
  root.userData.turret = turret;
  content.add(turret);
  const level = Math.max(0, Math.min(2, b.level || 0));
  if (level > 0) {
    w.box(turret, -3, 3, 3, 1.7, 1.4, 2, metal);
    w.box(turret, -3, 3.2, 1.9, 1.2, 0.65, 0.15, '#89b5ad');
  }
  if (level > 1) {
    w.cyl(turret, 3, 2, 3, 0.18, 5, steel);
    w.box(turret, 3, 7, 3, 2.3, 0.7, 1.1, trim);
    w.box(content, 0, 0.85, 8, 7, 0.4, 2, trim);
  }
  if (sam) {
    w.box(turret, 0, 0, 0, 8, 2, 9, olive);
    w.cyl(turret, 0, 2, 0, 2.4, 1.4, steel);
    const pods = new T.Group();
    pods.position.y = 4;
    pods.rotation.x = 0.38;
    for (const x of [-4, 0, 4])
      for (const y of [-1, 1]) {
        const tube = new T.Mesh(
          new T.CylinderGeometry(1.15, 1.15, 13, 12),
          w.mat(olive, { metalness: 0.22, roughness: 0.55 }),
        );
        tube.rotation.x = Math.PI / 2;
        tube.position.set(x, y, 0);
        pods.add(tube);
        const cap = new T.Mesh(new T.ConeGeometry(1.05, 1.2, 12), w.mat('#c4c8b3'));
        cap.rotation.x = -Math.PI / 2;
        cap.position.set(x, y, -7);
        pods.add(cap);
        w.box(pods, x, y + 0.95, 0, 1.8, 0.15, 12, steel);
      }
    w.box(pods, 0, -2, 0, 12, 0.6, 8, metal);
    batchStatic(pods);
    turret.add(pods);
    w.box(turret, 5, 2, 4, 2, 3, 3, steel);
  } else {
    w.box(turret, 0, 0, 1, gun ? 4.2 : 5.5, 2.5, 4.5, olive);
    for (const sign of [-1, 1]) {
      const shield = w.box(turret, sign * (gun ? 2.7 : 3.7), 1, 1, 1.1, 3.5, 5, steel);
      shield.rotation.z = sign * 0.12;
      w.box(turret, sign * 3.5, 0, 3, gun ? 1.6 : 2.4, 1.9, 3.4, '#9c9e82');
      w.box(turret, sign * 3.5, 2, 3, gun ? 1.6 : 2.4, 0.15, 3.5, trim);
    }
    const optic = w.box(turret, gun ? 2 : 3, 3, 1, 1.1, 0.8, 1.7, '#304e55');
    w.box(turret, gun ? 2 : 3, 3.2, 0.12, 0.75, 0.35, 0.15, '#7caaa7');
    const pitch = new T.Group();
    pitch.position.y = 5;
    root.userData.pitch = pitch;
    turret.add(pitch);
    w.cyl(pitch, 0, -1.5, 0, 1.1, 2, metal);
    for (const x of gun ? [-0.8, 0.8] : [-1.2, 1.2]) {
      const length = gun ? 8 : 13,
        barrel = new T.Mesh(
          new T.CylinderGeometry(gun ? 0.2 : 0.38, gun ? 0.35 : 0.6, length, 12),
          w.mat(metal, { metalness: 0.65, roughness: 0.4 }),
        );
      barrel.rotation.x = -Math.PI / 2;
      barrel.position.set(x, 0, -length / 2 - 1);
      pitch.add(barrel);
      for (const z of [-2, -4]) {
        const sleeve = new T.Mesh(
          new T.CylinderGeometry(gun ? 0.4 : 0.7, gun ? 0.4 : 0.7, 0.65, 12),
          w.mat(steel, { metalness: 0.5 }),
        );
        sleeve.rotation.x = Math.PI / 2;
        sleeve.position.set(x, 0, z);
        pitch.add(sleeve);
      }
      w.box(pitch, x, -0.3, gun ? -1.4 : -2, gun ? 0.8 : 1.2, 0.65, gun ? 2.5 : 4.5, olive);
      const muzzle = new T.Mesh(
        new T.CylinderGeometry(gun ? 0.29 : 0.54, gun ? 0.29 : 0.54, 1.1, 12, 1, true),
        w.mat('#263a3a', { metalness: 0.7, side: T.DoubleSide }),
      );
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.set(x, 0, -length - 1);
      pitch.add(muzzle);
    }
    batchStatic(pitch);
    batchStatic(turret, new Set([pitch]));
  }
}

export function radarModel(w, content, root) {
  w.box(content, 0, 0.7, 0, 13, 5, 12, '#718474');
  w.box(content, 0, 5.7, 0, 14, 0.6, 13, '#9ba99a');
  w.cyl(content, 0, 6.3, 0, 1.1, 15, '#a8b5a8');
  for (const x of [-5, 5]) {
    w.box(content, x, 1, 6.2, 2.5, 3, 0.35, '#3e5551');
    w.cyl(content, x, 6.5, 0, 0.18, 8, '#788f7d');
  }
  const rotor = new T.Group();
  rotor.position.y = 22;
  root.userData.turret = rotor;
  content.add(rotor);
  const geometry = new T.BufferGeometry(),
    positions = [],
    indices = [],
    steps = 24,
    rings = 6;
  for (let j = 0; j <= rings; j++)
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2,
        r = (j / rings) * 7;
      positions.push(Math.cos(a) * r, Math.sin(a) * r, r * r * 0.045);
    }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < steps; i++) {
      const a = j * (steps + 1) + i,
        b = a + steps + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const dish = new T.Mesh(
    geometry,
    w.mat('#9cac9f', {
      side: T.DoubleSide,
      metalness: 0.3,
      roughness: 0.65,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  rotor.add(dish);
  const wire = new T.LineSegments(
    new T.WireframeGeometry(geometry),
    new T.LineBasicMaterial({ color: '#425f55', transparent: true, opacity: 0.35 }),
  );
  rotor.add(wire);
  w.box(rotor, 0, -1, 1, 1, 1, 6, '#829b89');
  w.box(rotor, 0, -1, 4, 2, 2, 1, '#c0c9b7');
  batchStatic(rotor);
}

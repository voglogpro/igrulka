import * as T from '../../../vendor/three/three.module.js';
import { batchStatic } from '../mesh-utils.js';
function wingGeometry(side, scale) {
  const shape = new T.Shape();
  shape.moveTo(side * 0.6, 1.9);
  shape.lineTo(side * 9.5, -1.3);
  shape.lineTo(side * 9.1, -2.8);
  shape.lineTo(side * 0.7, -0.2);
  shape.closePath();
  const g = new T.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.08,
    bevelSegments: 1,
    steps: 1,
  });
  g.rotateX(Math.PI / 2);
  g.scale(scale, scale, scale);
  return g;
}
function buildTemplate(w, key, side) {
  const g = new T.Group(),
    heavy = key === 'heavy',
    scale = heavy ? 1.35 : 1,
    color = side === 0 ? '#9daea2' : '#aca393',
    dark = '#405351';
  g.userData.template = true;
  const details = new T.Group();
  details.name = 'details';
  details.userData.dynamic = true;
  g.add(details);
  const box = (parent, x, y, z, a, b, c, paint) => w.box(parent, x, y, z, a, b, c, paint);
  if (key === 'fpv') {
    box(g, 0, 0, 0, 1.3, 0.65, 1.8, dark);
    box(g, 0, 0.65, 0, 0.8, 0.5, 1.1, color);
    for (let i = 0; i < 4; i++) {
      const x = i % 2 ? 2.1 : -2.1,
        z = i < 2 ? 2.1 : -2.1;
      const arm = box(g, x / 2, 0.1, z / 2, 0.25, 0.25, 3.1, dark);
      arm.rotation.y = x * z > 0 ? Math.PI / 4 : -Math.PI / 4;
      const rotor = new T.Group();
      rotor.name = 'rotor-' + i;
      rotor.position.set(x, 0.35, z);
      rotor.userData.dynamic = true;
      for (const a of [0, Math.PI / 2]) {
        const blade = box(rotor, 0, 0, 0, 2.3, 0.08, 0.18, '#5c7467');
        blade.rotation.y = a;
      }
      g.add(rotor);
    }
    box(details, 0, -0.2, 1.1, 0.5, 0.5, 0.4, '#203b3a');
  } else if (key === 'drone' || heavy) {
    const profile = [
      new T.Vector2(0, -5.8),
      new T.Vector2(0.45, -5),
      new T.Vector2(0.86, -3.2),
      new T.Vector2(0.98, 0.6),
      new T.Vector2(0.7, 3.5),
      new T.Vector2(0.18, 5.5),
      new T.Vector2(0, 5.8),
    ];
    const body = new T.Mesh(
      new T.LatheGeometry(profile, 20),
      w.mat(color, { metalness: 0.22, roughness: 0.5 }),
    );
    body.rotation.x = Math.PI / 2;
    body.scale.setScalar(scale);
    g.add(body);
    for (const sign of [-1, 1]) {
      const wing = new T.Group();
      wing.name = sign < 0 ? 'wing-left' : 'wing-right';
      wing.userData.dynamic = true;
      const panel = new T.Mesh(
        wingGeometry(sign, scale),
        w.mat(color, { metalness: 0.15, roughness: 0.6 }),
      );
      wing.add(panel);
      box(wing, sign * 6.8 * scale, -0.12, -1.1 * scale, 3.2 * scale, 0.045, 0.11, dark);
      box(wing, sign * 4 * scale, -0.1, -0.2 * scale, 2 * scale, 0.04, 0.08, '#cad0bd');
      const nav = new T.Mesh(
        new T.SphereGeometry(0.15, 6, 4),
        w.mat(sign < 0 ? '#d74b36' : '#4ccf92', {
          emissive: sign < 0 ? '#ff4c26' : '#4bffa1',
          emissiveIntensity: 2.5,
        }),
      );
      nav.position.set(sign * 9.2 * scale, 0.05, -1.5 * scale);
      wing.add(nav);
      batchStatic(wing);
      g.add(wing);
      const fin = box(
        g,
        sign * 1.7 * scale,
        0.2,
        -4.1 * scale,
        0.18,
        1.8 * scale,
        1.9 * scale,
        color,
      );
      fin.rotation.z = sign * 0.35;
      box(details, sign * 0.65 * scale, 0.15, -2 * scale, 0.08, 0.08, 5.5 * scale, dark);
    }
    box(g, 0, 0.1, -4.3 * scale, 5.5 * scale, 0.16, 1.2 * scale, color);
    box(details, 0, 0.8, 0.8 * scale, 1.1, 0.16, 2.3 * scale, '#798b83');
    const cap = new T.Mesh(
      new T.SphereGeometry(0.65, 12, 8),
      w.mat('#485d61', { metalness: 0.48, roughness: 0.24 }),
    );
    cap.position.set(0, 0.15, 4.4 * scale);
    cap.scale.set(0.9, 0.7, 1.2);
    details.add(cap);
    for (let i = 0; i < 4; i++) box(details, 0, -0.55, -1.7 + i * 0.5, 0.7, 0.03, 0.13, '#354b4e');
    const rotor = new T.Group();
    rotor.name = 'rotor';
    rotor.position.z = -6 * scale;
    rotor.userData.dynamic = true;
    for (let i = 0; i < 3; i++) {
      const blade = new T.Mesh(w.boxGeo, w.mat('#3c4e4c'));
      blade.position.set(Math.cos(i * 2.094) * 0.95 * scale, Math.sin(i * 2.094) * 0.95 * scale, 0);
      blade.scale.set(2 * scale, 0.18, 0.07);
      blade.rotation.z = i * 2.094;
      rotor.add(blade);
    }
    g.add(rotor);
    const blur = new T.Mesh(
      new T.CircleGeometry(2 * scale, 16),
      new T.MeshBasicMaterial({
        color: '#a3b6aa',
        transparent: true,
        opacity: 0.09,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    blur.position.z = -6.1 * scale;
    details.add(blur);
    if (heavy) {
      box(g, 0, -0.7, 1, 1.4, 0.6, 5, '#7b8c81');
      for (const sign of [-1, 1]) box(details, sign * 2.8, -0.7, 0, 0.7, 0.8, 4.2, '#7e8c80');
    }
  } else {
    const ballistic = key === 'ballistic',
      r = ballistic ? 1.15 : 0.7,
      len = ballistic ? 12 : 11;
    const body = new T.Mesh(
      new T.CylinderGeometry(r, r * 1.08, len, 16),
      w.mat(color, { metalness: 0.4, roughness: 0.35 }),
    );
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const nose = new T.Mesh(
      new T.ConeGeometry(r, len * 0.27, 16),
      w.mat('#d2d4c7', { metalness: 0.3, roughness: 0.3 }),
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.z = len * 0.63;
    g.add(nose);
    for (const sign of [-1, 1]) {
      const wing = new T.Group();
      wing.name = sign < 0 ? 'wing-left' : 'wing-right';
      wing.userData.dynamic = true;
      box(wing, sign * (ballistic ? 1.6 : 2.7), -0.08, -2, ballistic ? 2.4 : 5, 0.13, 2, color);
      g.add(wing);
    }
    box(g, 0, -1.2, -4, 0.12, 2.5, 2.2, color);
    box(details, 0, 0.9, -1.5, 1, 0.08, 4, dark);
    const nozzle = new T.Mesh(
      new T.CylinderGeometry(r * 0.75, r * 0.6, 1.1, 12),
      w.mat('#293f41', { metalness: 0.7, roughness: 0.35 }),
    );
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = -len * 0.53;
    g.add(nozzle);
  }
  batchStatic(details);
  batchStatic(g);
  g.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
    if (o.geometry) w.sharedGeometries.add(o.geometry);
    if (o.material) w.sharedMaterials.add(o.material);
  });
  return g;
}
export function aircraftModel(world, u) {
  world.aircraftTemplates ||= new Map();
  const modelKey = u.subtype === 'fpv' ? 'fpv' : u.key,
    key = modelKey + '/' + u.side;
  if (!world.aircraftTemplates.has(key))
    world.aircraftTemplates.set(key, buildTemplate(world, modelKey, u.side));
  const g = world.aircraftTemplates.get(key).clone(true);
  g.userData = {
    signature: key,
    props: [],
    wings: [g.getObjectByName('wing-left'), g.getObjectByName('wing-right')],
    details: g.getObjectByName('details'),
  };
  const rotor = g.getObjectByName('rotor');
  if (rotor) g.userData.props.push(rotor);
  for (let i = 0; i < 4; i++) {
    const p = g.getObjectByName('rotor-' + i);
    if (p) g.userData.props.push(p);
  }
  return g;
}

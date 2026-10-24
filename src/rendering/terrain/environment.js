import * as E from '../../game/index.js';
import { clamp } from '../../game/shared/math.js';
import * as T from '../../../vendor/three/three.module.js';
import { batchStatic } from '../mesh-utils.js';
import { tileInstances } from './instance-tiles.js';
// The island with the neutral trading harbour in the middle of the sea. Only the picture raises
// it: in the rules it is open water, so armies cannot walk or build there.
export const ISLAND = { x: 0, z: 0, r: 62 };
const WATER_LEVEL = -1;

export function height(x, z) {
  const sd = E.seaDistance(x, z),
    island = Math.hypot(x - ISLAND.x, z - ISLAND.z),
    islandHeight = island < ISLAND.r + 30 ? 7 * (1 - (island / (ISLAND.r + 30)) ** 2) - 1.5 : -99;
  if (sd < 0) return Math.max(-2.5 - Math.min(1, -sd / 45) * 7.5, islandHeight);
  // Beyond the field the valley rises into wooded mountains.
  const edge = Math.max(0, (Math.abs(x) - E.FIELD.x) / 160, (Math.abs(z) - E.FIELD.z) / 160);
  const mountains = (Math.sin(x * 0.011 + z * 0.007) + Math.sin(z * 0.021) * 0.5 + 1.7) * edge * 14;
  const beach = Math.min(1, sd / 18);
  return -2.5 * (1 - beach) + E.groundHeight(x, z) + Math.min(190, mountains);
}

// Ground colour by place: sand on the shore, darker grass on hills, rock on the mountains.
const SAND = new T.Color('#b3a882'),
  MEADOW = new T.Color('#ffffff'),
  HILL = new T.Color('#9fb48c'),
  ROCK = new T.Color('#8d8f86'),
  BED = new T.Color('#6f7d70');
function groundColor(x, z, y, out) {
  const sd = E.seaDistance(x, z);
  if (sd < 0) return out.copy(BED);
  out.copy(MEADOW).lerp(HILL, Math.min(1, E.groundHeight(x, z) / 12));
  if (y > 20) out.lerp(ROCK, Math.min(1, (y - 20) / 60));
  return out.lerp(SAND, (1 - Math.min(1, Math.max(0, sd / 45))) ** 1.5);
}

function rippleTexture() {
  const size = 256,
    c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'),
    image = g.createImageData(size, size);
  // Tileable height field from a few wave trains, turned into a normal map.
  const h = (x, y) =>
    Math.sin(((x + y * 0.3) / size) * Math.PI * 2 * 6) * 0.5 +
    Math.sin(((y - x * 0.2) / size) * Math.PI * 2 * 9) * 0.35 +
    Math.sin(((x * 0.7 + y) / size) * Math.PI * 2 * 15) * 0.15;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = h(x + 1, y) - h(x - 1, y),
        dy = h(x, y + 1) - h(x, y - 1),
        i = (y * size + x) * 4;
      image.data[i] = 128 + dx * 60;
      image.data[i + 1] = 128 + dy * 60;
      image.data[i + 2] = 255;
      image.data[i + 3] = 255;
    }
  g.putImageData(image, 0, 0);
  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  return tex;
}

// Points on the shoreline found by walking outward from the sea's centre line.
function shoreline(samples = 220) {
  const points = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2,
      dx = Math.cos(a),
      dz = Math.sin(a);
    let lo = 0,
      hi = 1400;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (E.seaDistance(dx * mid, dz * mid) < 0) lo = mid;
      else hi = mid;
    }
    points.push({ x: dx * lo, z: dz * lo, nx: dx, nz: dz });
  }
  return points;
}

export function terrain() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  let seed = 73;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  g.fillStyle = '#78846b';
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 450; i++) {
    const x = rnd() * 1024,
      y = rnd() * 1024,
      r = 15 + rnd() * 100,
      gradient = g.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, i % 2 ? '#aca07430' : '#344e3735');
    gradient.addColorStop(1, '#66775b00');
    g.fillStyle = gradient;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 180000; i++) {
    const x = rnd() * 1024,
      y = rnd() * 1024;
    g.fillStyle = i % 3 === 0 ? 'rgba(196,180,125,.16)' : 'rgba(32,54,34,.15)';
    g.fillRect(x, y, 0.6 + rnd(), 1 + rnd() * 2);
  }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(16, 14);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 8;
  const geo = new T.PlaneGeometry(E.MAP.width + 3400, E.MAP.depth + 3200, 330, 280);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position,
    colors = new Float32Array(p.count * 3),
    color = new T.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i),
      y = this.height(x, z);
    p.setY(i, y);
    groundColor(x, z, y, color).toArray(colors, i * 3);
  }
  geo.setAttribute('color', new T.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  this.ground = new T.Mesh(
    geo,
    new T.MeshStandardMaterial({ map: tex, color: '#c0c6b3', roughness: 1, vertexColors: true }),
  );
  this.ground.receiveShadow = true;
  this.scene.add(this.ground);
  // The sea: one sheet over the whole basin; the terrain hides it everywhere on land.
  this.waterNormals = rippleTexture();
  this.waterNormals.repeat.set(14, 30);
  const sea = new T.PlaneGeometry(1000, 2200, 1, 1);
  sea.rotateX(-Math.PI / 2);
  this.water = new T.Mesh(
    sea,
    new T.MeshStandardMaterial({
      color: '#2c5463',
      metalness: 0.35,
      roughness: 0.12,
      normalMap: this.waterNormals,
      normalScale: new T.Vector2(0.45, 0.45),
      transparent: true,
      opacity: 0.93,
    }),
  );
  this.water.position.set(E.riverX(0), WATER_LEVEL, 0);
  this.water.receiveShadow = true;
  this.water.renderOrder = 1;
  this.scene.add(this.water);
  // Surf: a pale band along the shore that breathes with the waves.
  const shore = shoreline(),
    foamVerts = [],
    foamIdx = [];
  shore.forEach((q, i) => {
    for (const offset of [-4, 1.5])
      foamVerts.push(q.x + q.nx * offset, WATER_LEVEL + 0.08, q.z + q.nz * offset);
    const n = i * 2,
      m = ((i + 1) % shore.length) * 2;
    foamIdx.push(n, m, n + 1, n + 1, m, m + 1);
  });
  const fg = new T.BufferGeometry();
  fg.setAttribute('position', new T.Float32BufferAttribute(foamVerts, 3));
  fg.setIndex(foamIdx);
  this.foam = new T.Mesh(
    fg,
    new T.MeshBasicMaterial({
      color: '#d9e6e4',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  this.foam.renderOrder = 2;
  this.scene.add(this.foam);
  this.island();
}

// Lighthouse, quay and warehouses of the neutral trading harbour.
export function island() {
  const group = new T.Group(),
    { x, z } = ISLAND,
    top = this.height(x, z);
  this.cyl(group, x + 18, top, z - 10, 3.2, 26, '#e9e4d6');
  for (const y of [7, 16]) this.cyl(group, x + 18, top + y, z - 10, 3.3, 3, '#b8423a');
  this.cyl(group, x + 18, top + 26, z - 10, 2.2, 3.5, '#f7e6a8');
  this.box(group, x - 14, top, z + 8, 18, 6, 12, '#a49a86');
  this.box(group, x - 14, top + 6, z + 8, 19, 1, 13, '#6f5a4a');
  this.box(group, x + 4, top, z + 22, 10, 5, 8, '#8e8774');
  // Quays on both sides: ships of either city tie up here.
  for (const side of [-1, 1]) {
    this.box(group, x + side * (ISLAND.r + 8), WATER_LEVEL + 0.4, z, 26, 1.4, 44, '#6d6658');
    for (let i = -2; i <= 2; i++)
      this.cyl(group, x + side * (ISLAND.r + 20), WATER_LEVEL - 1, z + i * 10, 0.7, 4, '#4d4438');
  }
  batchStatic(group);
  this.scene.add(group);
  this.beacon = new T.PointLight('#ffe2a0', 0, 160, 2);
  this.beacon.position.set(x + 18, top + 28, z - 10);
  this.scene.add(this.beacon);
}

export function environment() {
  const sky = new T.Mesh(
    new T.SphereGeometry(5400, 32, 20),
    new T.ShaderMaterial({
      uniforms: { daylight: { value: 0.1 }, overcast: { value: 0 } },
      side: T.BackSide,
      depthWrite: false,
      vertexShader:
        'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:
        'uniform float daylight;uniform float overcast;varying vec3 v;void main(){float h=normalize(v).y;vec3 col=mix(vec3(.40,.31,.30),vec3(.075,.13,.23),smoothstep(-.06,.5,h));float glow=pow(max(0.,dot(normalize(v),normalize(vec3(-1.,.11,-.5)))),24.);col+=vec3(.40,.17,.065)*glow;vec3 night=mix(vec3(.04,.06,.09),vec3(.008,.018,.042),smoothstep(0.,.6,h));vec3 day=mix(vec3(.62,.73,.78),vec3(.12,.31,.55),smoothstep(-.1,.7,h));col=mix(night,mix(col,day,smoothstep(.12,.7,daylight)),smoothstep(0.,.15,daylight));float lum=dot(col,vec3(.3,.5,.2));col=mix(col,vec3(lum*.9+.02),overcast*.75);gl_FragColor=vec4(col,1.);}',
    }),
  );
  this.scene.add(sky);
  this.sky = sky;
  const sun = new T.Mesh(
    new T.SphereGeometry(30, 20, 12),
    new T.MeshBasicMaterial({ color: '#ffd3a0', fog: false }),
  );
  sun.position.set(-2150, 210, -980);
  this.scene.add(sun);
  this.sunDisc = sun;
  // Two kinds of trees: dark firs and rounder broadleaf crowns. Forest patches of the rules are
  // planted densely, so the woods soldiers hide in are the woods the player sees.
  const trunkGeo = new T.CylinderGeometry(0.65, 1, 10, 6),
    positions = [];
  for (let i = 0; i < 4; i++) {
    const part = new T.ConeGeometry(7 - i * 1.4, 11 - i, 9).toNonIndexed();
    part.translate(0, i * 4.2, 0);
    positions.push(...part.attributes.position.array);
    part.dispose();
  }
  const leafGeo = new T.BufferGeometry();
  leafGeo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  leafGeo.computeVertexNormals();
  const crownGeo = new T.IcosahedronGeometry(6.5, 1);
  crownGeo.scale(1, 0.85, 1);
  const LIMIT = 5200,
    kinds = [
      {
        trunks: new T.InstancedMesh(trunkGeo, this.mat('#51483b'), LIMIT),
        leaves: new T.InstancedMesh(leafGeo, this.mat('#4a6953'), LIMIT),
        records: [],
        crown: 10,
        hue: [0.3, 0.05],
      },
      {
        trunks: new T.InstancedMesh(trunkGeo, this.mat('#5a4c3d'), LIMIT),
        leaves: new T.InstancedMesh(crownGeo, this.mat('#6a8a58'), LIMIT),
        records: [],
        crown: 11,
        hue: [0.22, 0.07],
      },
    ];
  let seed = 171;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const dummy = new T.Object3D(),
    color = new T.Color();
  const plant = (x, z, kind) => {
    const k = kinds[kind],
      index = k.records.length;
    if (index >= LIMIT || E.seaDistance(x, z) < 14) return;
    const scale = 0.7 + rnd() * 0.8,
      y = this.height(x, z);
    dummy.position.set(x, y + 4 * scale, z);
    dummy.scale.setScalar(scale);
    dummy.rotation.y = rnd() * 6.28;
    dummy.updateMatrix();
    k.trunks.setMatrixAt(index, dummy.matrix);
    dummy.position.y = y + k.crown * scale;
    dummy.updateMatrix();
    k.leaves.setMatrixAt(index, dummy.matrix);
    k.leaves.setColorAt(
      index,
      color.setHSL(k.hue[0] + rnd() * k.hue[1], 0.16 + rnd() * 0.14, 0.6 + rnd() * 0.26),
    );
    k.records.push({ x, z, index });
  };
  for (const patch of E.COVER_PATCHES) {
    if (!patch.forest) continue;
    const count = Math.round((patch.r * patch.r) / 60),
      fir = rnd() < 0.55;
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2,
        r = Math.sqrt(rnd()) * patch.r * 1.05;
      // A patch is mostly one kind, with a fifth of the other mixed in.
      const mixed = rnd() < 0.2;
      plant(patch.x + Math.cos(a) * r, patch.z + Math.sin(a) * r, fir !== mixed ? 0 : 1);
    }
  }
  // Scattered trees and groves on the open ground, thinned around the city cores.
  for (let i = 0; i < 14000; i++) {
    const x = (rnd() - 0.5) * (E.MAP.width + 2400),
      z = (rnd() - 0.5) * (E.MAP.depth + 2200),
      city = Math.min(Math.hypot(x + E.HQ_X, z), Math.hypot(x - E.HQ_X, z)),
      outside = !E.inField(x, z);
    if (city < 330 || (city < 520 && rnd() > 0.15) || (!outside && rnd() > 0.35)) continue;
    plant(x, z, rnd() < 0.6 ? 0 : 1);
  }
  this.trees = [];
  for (const k of kinds) {
    k.trunks.count = k.leaves.count = k.records.length;
    k.trunks.castShadow = k.leaves.castShadow = true;
    tileInstances(this.scene, [k.trunks, k.leaves], k.records);
    this.trees.push(...k.records);
  }
  // Layered distant hills give the valley a horizon without hiding the battlefield.
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2,
      r = 3300 + (i % 3) * 120;
    const m = new T.Mesh(this.sphereGeo, this.mat(i % 2 ? '#3b4c4b' : '#455351'));
    m.position.set(Math.cos(a) * r, 20, Math.sin(a) * r);
    m.scale.set(260 + (i % 4) * 60, 110 + (i % 5) * 30, 280);
    this.scene.add(m);
  }
}

export function makeCover() {
  const patches = E.COVER_PATCHES,
    bushes = new T.InstancedMesh(
      this.sphereGeo,
      this.mat('#52704d', { roughness: 1 }),
      patches.length * 7,
    ),
    dummy = new T.Object3D();
  let i = 0;
  for (const p of patches)
    for (let j = 0; j < 7; j++) {
      const a = j * 2.399,
        r = Math.sqrt(j / 7) * p.r * 0.8,
        x = p.x + Math.cos(a) * r,
        z = p.z + Math.sin(a) * r;
      dummy.position.set(x, Math.max(0, this.height(x, z)) + 1.5, z);
      dummy.scale.set(4 + (j % 3), 1.8 + (j % 2), 3.8 + (j % 3));
      dummy.rotation.y = a;
      dummy.updateMatrix();
      bushes.setMatrixAt(i++, dummy.matrix);
    }
  bushes.castShadow = bushes.receiveShadow = true;
  this.scene.add(bushes);
  this.contactRings = new T.InstancedMesh(
    new T.RingGeometry(0.97, 1, 32),
    new T.MeshBasicMaterial({
      color: '#ecae7d',
      transparent: true,
      opacity: 0.45,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
    300,
  );
  this.contactRings.frustumCulled = false;
  this.contactRings.count = 0;
  this.scene.add(this.contactRings);
  this.contactDummy = new T.Object3D();
}

// The field border, the old border posts that mark each land corridor and the oil fields.
export function landmarks() {
  const group = new T.Group();
  // Oil fields: a dark seep in the grass with a ring of survey stakes.
  const seep = new T.Mesh(
    new T.CircleGeometry(1, 28),
    new T.MeshStandardMaterial({
      color: '#1d1a17',
      roughness: 0.35,
      metalness: 0.2,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    }),
  );
  seep.rotation.x = -Math.PI / 2;
  for (const f of E.OIL_FIELDS) {
    const y = this.height(f.x, f.z) + 0.12;
    for (let i = 0; i < 4; i++) {
      const m = seep.clone(),
        a = f.id * 1.7 + i * 1.9,
        r = i ? 7 + i * 2 : 0;
      m.position.set(f.x + Math.cos(a) * r, y + i * 0.01, f.z + Math.sin(a) * r);
      m.scale.setScalar(i ? 5 + (i % 2) * 3 : f.r * 0.75);
      this.scene.add(m);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.box(
        group,
        f.x + Math.cos(a) * f.r,
        y,
        f.z + Math.sin(a) * f.r,
        0.35,
        1.6,
        0.35,
        '#c9a24a',
      );
    }
    this.clearTrees(f.x, f.z, f.r + 10);
  }
  for (const z of E.CORRIDORS)
    for (const x of [-24, 24]) {
      const y = this.height(x, z);
      this.box(group, x, y, z, 2.4, 6, 2.4, '#8b8a7c');
      this.box(group, x, y + 6, z, 3.2, 0.8, 3.2, '#6c6a5d');
      // Striped barrier arms, raised: the frontier is open to whoever holds it.
      const arm = this.box(group, x, y + 7, z + Math.sign(x) * 6, 0.5, 0.5, 12, '#c9433a');
      arm.rotation.x = Math.sign(x) * 0.9;
    }
  batchStatic(group);
  this.scene.add(group);
  const points = [],
    { x: fx, z: fz } = E.FIELD;
  for (const z of [-fz, fz])
    for (let x = -fx; x < fx; x += 20) points.push(x, 0.9, z, x + 10, 0.9, z);
  for (const x of [-fx, fx])
    for (let z = -fz; z < fz; z += 20) points.push(x, 0.9, z, x, 0.9, z + 10);
  for (let i = 1; i < points.length; i += 3)
    points[i] = this.height(points[i - 1], points[i + 1]) + 0.9;
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  this.scene.add(
    new T.LineSegments(
      geo,
      new T.LineBasicMaterial({ color: '#cfbf8b', transparent: true, opacity: 0.28 }),
    ),
  );
}

export function clearTrees(x, z, radius) {
  if (!this.trees) return;
  const zero = new T.Matrix4().makeScale(0, 0, 0);
  let changed = false;
  for (const tree of this.trees)
    if (!tree.cleared && Math.hypot(x - tree.x, z - tree.z) < radius) {
      tree.cleared = true;
      for (const mesh of tree.meshes) {
        mesh.setMatrixAt(tree.index, zero);
        mesh.instanceMatrix.needsUpdate = true;
      }
      changed = true;
    }
  if (changed && this.renderer) this.renderer.shadowMap.needsUpdate = true;
}

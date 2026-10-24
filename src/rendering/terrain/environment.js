import * as E from '../../game/index.js';
import { riverDistance, riverX } from '../../game/index.js';
import { clamp } from '../../game/shared/math.js';
import * as T from '../../../vendor/three/three.module.js';
import { batchStatic } from '../mesh-utils.js';
import { tileInstances } from './instance-tiles.js';
export function height(x, z) {
  const edge = Math.max(0, (Math.abs(x) - 900) / 140, (Math.abs(z) - 620) / 160);
  const hills = (Math.sin(x * 0.011 + z * 0.007) + Math.sin(z * 0.021) * 0.5 + 1.7) * edge * 12;
  const distance = riverDistance(x, z);
  if (distance < 44) return -9;
  const blend = clamp((distance - 44) / 24, 0, 1);
  return -9 * (1 - blend) + Math.min(170, hills) * blend;
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
  tex.repeat.set(10, 9);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 8;
  const geo = new T.PlaneGeometry(5600, 5200, 250, 220);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, this.height(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  this.ground = new T.Mesh(
    geo,
    new T.MeshStandardMaterial({ map: tex, color: '#c0c6b3', roughness: 1 }),
  );
  this.ground.receiveShadow = true;
  this.scene.add(this.ground);
  const verts = [],
    indices = [];
  for (let i = 0; i <= 240; i++) {
    const z = -2600 + i * (5200 / 240);
    verts.push(riverX(z) - 75, -2.5, z, riverX(z) + 75, -2.5, z);
    if (i < 240) {
      const n = i * 2;
      indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  }
  const wg = new T.BufferGeometry();
  wg.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
  wg.setIndex(indices);
  wg.computeVertexNormals();
  this.water = new T.Mesh(
    wg,
    new T.MeshStandardMaterial({ color: '#365e71', metalness: 0.48, roughness: 0.22 }),
  );
  this.water.receiveShadow = true;
  this.scene.add(this.water);
  // River follows a carved bed: opaque upward-facing water never overlaps the terrain.
  const bankverts = [],
    bankidx = [];
  for (let side of [-1, 1]) {
    const offset = bankverts.length / 3;
    for (let i = 0; i <= 200; i++) {
      const z = -2600 + i * 26,
        x = riverX(z);
      for (const r of [48, 63])
        bankverts.push(x + side * r, this.height(x + side * r, z) + 0.06, z);
      if (i < 200) {
        const n = offset + i * 2;
        bankidx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
      }
    }
  }
  const bg = new T.BufferGeometry();
  bg.setAttribute('position', new T.Float32BufferAttribute(bankverts, 3));
  bg.setIndex(bankidx);
  bg.computeVertexNormals();
  this.scene.add(
    new T.Mesh(
      bg,
      new T.MeshStandardMaterial({ color: '#7d7962', side: T.DoubleSide, roughness: 1 }),
    ),
  );
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
  const trunks = new T.InstancedMesh(trunkGeo, this.mat('#51483b'), 3200),
    leaves = new T.InstancedMesh(leafGeo, this.mat('#4a6953'), 3200);
  let count = 0,
    seed = 171;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const dummy = new T.Object3D();
  this.trees = [];
  for (let i = 0; i < 8000 && count < 3200; i++) {
    const x = (rnd() - 0.5) * 4400,
      z = (rnd() - 0.5) * 4000;
    if (riverDistance(x, z) < 75 || Math.hypot(x + 615, z) < 310 || Math.hypot(x - 615, z) < 310)
      continue;
    if (Math.abs(x) < 750 && Math.abs(z) < 430 && rnd() > 0.22) continue;
    const scale = 0.7 + rnd() * 0.8,
      y = this.height(x, z);
    dummy.position.set(x, y + 4 * scale, z);
    dummy.scale.setScalar(scale);
    dummy.rotation.y = rnd() * 6.28;
    dummy.updateMatrix();
    trunks.setMatrixAt(count, dummy.matrix);
    dummy.position.y = y + 10 * scale;
    dummy.updateMatrix();
    leaves.setMatrixAt(count, dummy.matrix);
    leaves.setColorAt(
      count,
      new T.Color().setHSL(0.28 + rnd() * 0.06, 0.16 + rnd() * 0.12, 0.63 + rnd() * 0.24),
    );
    this.trees.push({ x, z, index: count });
    count++;
  }
  trunks.count = leaves.count = count;
  trunks.castShadow = leaves.castShadow = true;
  this.forest = tileInstances(this.scene, [trunks, leaves], this.trees);
  // Layered distant hills give the valley a horizon without hiding the battlefield.
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2,
      r = 2200 + (i % 3) * 80;
    const m = new T.Mesh(this.sphereGeo, this.mat(i % 2 ? '#3b4c4b' : '#455351'));
    m.position.set(Math.cos(a) * r, 20, Math.sin(a) * r);
    m.scale.set(180 + (i % 4) * 45, 70 + (i % 5) * 22, 190);
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

export function bridges() {
  const group = new T.Group();
  for (const z of E.BRIDGES) {
    const x = E.riverX(z);
    this.box(group, x, -0.5, z, 250, 2, 46, '#626b64');
    for (const offset of [-24, 24]) {
      this.box(group, x, 2, z + offset, 250, 1.6, 1, '#a0a28b');
      for (let i = -120; i <= 120; i += 20)
        this.box(group, x + i, 3, z + offset, 0.6, 2, 0.6, '#98a18d');
    }
    for (const dx of [-70, 0, 70])
      for (const dz of [-18, 18]) this.box(group, x + dx, -10, z + dz, 6, 11, 6, '#747c70');
    for (let i = -110; i < 110; i += 12) this.box(group, x + i, 1.55, z, 6, 0.03, 0.25, '#c9c3a4');
    for (const offset of [-115, 115]) this.clearTrees(x + offset, z, 36);
  }
  batchStatic(group);
  this.scene.add(group);
  const points = [];
  for (const z of [-600, 600])
    for (let x = -880; x < 880; x += 20)
      if (E.riverDistance(x, z) > 80) points.push(x, 0.9, z, x + 10, 0.9, z);
  for (const x of [-880, 880])
    for (let z = -600; z < 600; z += 20) points.push(x, 0.9, z, x, 0.9, z + 10);
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

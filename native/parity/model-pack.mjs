import * as T from '../../vendor/three/three.module.js';
import { markNativeImmutableGeometry } from './immutable-geometry.mjs';

// Runtime-independent mesh bank. Rest meshes remain in the original CPU scene,
// so its raycaster, aiming hierarchy and vehicle batching see the same art.
const decode = (data) => {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(data);
  const text = globalThis.atob(data),
    bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
};
export function packedAttribute(value) {
  const bytes = decode(value.data);
  const array =
    value.type === 'u32' ? new Uint32Array(bytes.buffer) : new Float32Array(bytes.buffer);
  return new T.BufferAttribute(array, value.size);
}
export class NativeModelPack {
  constructor(pack, { paintScale = 1 } = {}) {
    this.pack = pack;
    this.paintScale = paintScale;
    this.geometries = new Map();
    this.materials = new Map();
    this.textures = new Map();
  }
  geometry(key, nodeIndex, partIndex) {
    const part = this.pack.models[key].nodes[nodeIndex].parts[partIndex];
    const id = `${key}/${part.geometryKey ?? nodeIndex + '/' + partIndex}`;
    if (this.geometries.has(id)) return this.geometries.get(id);
    const geometry = new T.BufferGeometry();
    for (const [name, value] of Object.entries(part.attributes))
      geometry.setAttribute(name, packedAttribute(value));
    geometry.setIndex(packedAttribute(part.index));
    geometry.userData.nativeLods = part.lods.map((l) => ({
      distance: l.distance,
      index: packedAttribute(l.index),
    }));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    markNativeImmutableGeometry(geometry);
    this.geometries.set(id, geometry);
    return geometry;
  }
  texture(name, srgb = false) {
    const source = this.pack.textures[name] || this.pack.textures[name?.replace(/\.[^.]+$/, '')];
    if (!source) return null;
    const id = name + '/' + srgb;
    if (!this.textures.has(id)) {
      const texture = new T.DataTexture(
        decode(source.data),
        source.width,
        source.height,
        T.RGBAFormat,
      );
      texture.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
      texture.flipY = false;
      texture.needsUpdate = true;
      this.textures.set(id, texture);
    }
    return this.textures.get(id);
  }
  material(key, index, side) {
    const model = this.pack.models[key],
      source = model.materials[index] || {},
      id = key + '/' + index + '/' + side;
    if (this.materials.has(id)) return this.materials.get(id);
    const pbr = source.pbrMetallicRoughness || {},
      color = pbr.baseColorFactor || [1, 1, 1, 1];
    const team = /team|insignia/i.test(source.name || '');
    const material = new T.MeshStandardMaterial({
      color: team ? ['#74836b', '#8d7965', '#627f96', '#96805a'][side] : new T.Color(...color),
      roughness: pbr.roughnessFactor ?? 1,
      metalness: pbr.metallicFactor ?? 1,
      vertexColors: true,
      side: source.doubleSided ? T.DoubleSide : T.FrontSide,
    });
    if (!team) material.color.multiplyScalar(this.paintScale);
    const map = (info, srgb = false) => {
      if (info?.index === undefined) return null;
      const image = model.images[model.textures[info.index]?.source];
      return this.texture(image?.name || image?.uri, srgb);
    };
    material.map = map(pbr.baseColorTexture, true);
    material.normalMap = map(source.normalTexture);
    material.normalScale.setScalar(source.normalTexture?.scale ?? 0.45);
    material.roughnessMap = material.metalnessMap = map(pbr.metallicRoughnessTexture);
    material.aoMap = map(source.occlusionTexture);
    material.name = `native04/${key}/${source.name || index}`;
    this.materials.set(id, material);
    return material;
  }
  create(key, side, level = 0) {
    const model = this.pack.models[key];
    if (!model) return null;
    const nodes = model.nodes.map((n, i) => {
      const root = new T.Group();
      root.name = n.name;
      root.userData = { ...n.extras };
      if (n.matrix) {
        root.matrix.fromArray(n.matrix);
        root.matrix.decompose(root.position, root.quaternion, root.scale);
      } else {
        root.position.fromArray(n.position);
        root.quaternion.fromArray(n.quaternion);
        root.scale.fromArray(n.scale);
      }
      if (n.extras.min_level > level) root.visible = false;
      for (let j = 0; j < n.parts.length; j++) {
        const mesh = new T.Mesh(
          this.geometry(key, i, j),
          this.material(key, n.parts[j].material, side),
        );
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.dynamic = true;
        root.add(mesh);
      }
      return root;
    });
    const container = new T.Group();
    for (const [i, n] of model.nodes.entries())
      (n.parent < 0 ? container : nodes[n.parent]).add(nodes[i]);
    container.userData.nativeArt = key;
    return container;
  }
}

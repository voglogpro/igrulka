// Godot owns drawing. These descriptors retain the original Three scene and CPU rules.
import { captureVisualBindings } from './visual-bindings.mjs';
export const SCENE_PROTOCOL = 1;

const TYPES = new Map([
  [Float32Array, 'f32'],
  [Float64Array, 'f64'],
  [Uint32Array, 'u32'],
  [Int32Array, 'i32'],
  [Uint16Array, 'u16'],
  [Int16Array, 'i16'],
  [Uint8Array, 'u8'],
  [Uint8ClampedArray, 'u8'],
  [Int8Array, 'i8'],
]);
const standaloneIds = new WeakMap();
let standaloneSerial = 0;
const standaloneIdentity = (attribute) => {
  if (!attribute) return null;
  if (!standaloneIds.has(attribute)) standaloneIds.set(attribute, `a${++standaloneSerial}`);
  return standaloneIds.get(attribute);
};
export function encodeBytes(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  if (globalThis.Buffer) return globalThis.Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return globalThis.btoa(binary);
}
export function encodeAttribute(
  attribute,
  count = attribute?.count ?? 0,
  identity = standaloneIdentity(attribute),
) {
  if (!attribute) return null;
  const size = attribute.itemSize;
  let values;
  if (attribute.isInterleavedBufferAttribute) {
    values = new attribute.data.array.constructor(count * size);
    for (let i = 0; i < count; i++)
      for (let c = 0; c < size; c++)
        values[i * size + c] =
          attribute.data.array[i * attribute.data.stride + attribute.offset + c];
  } else values = attribute.array.subarray(0, count * size);
  return {
    identity,
    type: TYPES.get(values.constructor) || 'f32',
    itemSize: size,
    count,
    data: encodeBytes(values),
    normalized: !!attribute.normalized,
    instanced: !!attribute.isInstancedBufferAttribute,
    version: attribute.version ?? attribute.data?.version ?? 0,
  };
}

const color = (value, fallback = [1, 1, 1]) =>
  value?.isColor ? [value.r, value.g, value.b] : fallback;
const vector = (value) => (value?.toArray ? value.toArray() : value);
const MAPS = [
  'map',
  'normalMap',
  'alphaMap',
  'emissiveMap',
  'bumpMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
];
export function shaderFamily(material) {
  if (material.isShaderMaterial || material.isRawShaderMaterial) {
    const vertex = material.vertexShader || '',
      fragment = material.fragmentShader || '';
    if (vertex.includes('aSeed') && vertex.includes('aDensity')) return 'weather';
    if (material.uniforms?.daylight && material.uniforms?.overcast) return 'sky';
    if (material.uniforms?.kind && material.uniforms?.clock) return 'particle';
    if (fragment.includes('float bowl') && fragment.includes('float rim')) return 'scar';
    if (fragment.includes('float across') && vertex.includes('aTint')) return 'streak';
    throw Error(`Unsupported original shader: ${material.name || material.uuid}`);
  }
  if (material.isSpriteMaterial) return 'sprite';
  if (material.isLineBasicMaterial || material.isLineDashedMaterial) return 'line';
  if (material.isMeshBasicMaterial) return 'basic';
  if (material.isPointsMaterial) return 'points';
  return 'standard';
}

export function pngTexture(texture) {
  const image = texture.image;
  if (!image) return null;
  if (image.toDataURL) return image.toDataURL('image/png');
  const width = image.width || image.naturalWidth,
    height = image.height || image.naturalHeight;
  if (!width || !height || image.complete === false) return null;
  if (!globalThis.document) return null;
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (image.data) {
    const pixels = context.createImageData(width, height),
      input = image.data;
    const channels = Math.max(1, input.length / (width * height));
    const floating = input instanceof Float32Array || input instanceof Float64Array;
    for (let i = 0; i < width * height; i++)
      for (let c = 0; c < 4; c++) {
        const value =
          c === 3 && channels < 4
            ? floating
              ? 1
              : 255
            : input[i * channels + Math.min(c, channels - 1)];
        pixels.data[i * 4 + c] = Math.max(0, Math.min(255, floating ? value * 255 : value));
      }
    context.putImageData(pixels, 0, 0);
  } else context.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}
const wrap = (value) => (value === 1000 ? 'repeat' : value === 1002 ? 'mirror' : 'clamp');
const objectType = (object) =>
  object.isInstancedMesh
    ? 'instanced'
    : object.isSprite
      ? 'sprite'
      : object.isPoints
        ? 'points'
        : object.isLineSegments
          ? 'segments'
          : object.isLine
            ? 'line'
            : 'mesh';
const matrixEqual = (a, b) => {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
};
const materialEqual = (raw, previous) => {
  if (Array.isArray(raw)) {
    if (raw.length !== previous.materials.length) return false;
    for (let i = 0; i < raw.length; i++)
      if (raw[i] !== previous.materials[i] || raw[i].uuid !== previous.materialIds[i]) return false;
    return true;
  }
  return (
    previous.materials.length === 1 &&
    raw === previous.materials[0] &&
    raw.uuid === previous.materialIds[0]
  );
};

export class SceneExporter {
  constructor({ encodeTexture = pngTexture, clock = () => globalThis.performance.now() } = {}) {
    this.encodeTexture = encodeTexture;
    this.geometryCache = new Map();
    this.materialCache = new Map();
    this.textureCache = new Map();
    this.objectCache = new Map();
    this.instanceCache = new Map();
    this.attributeIds = new WeakMap();
    this.attributeSerial = 0;
    this.frameGeometries = new Set();
    this.frameMaterials = new Set();
    this.frameTextures = new Map();
    this.clock = clock;
    this.profile = {};
  }
  attributeSignature(attribute, count = attribute?.count) {
    if (!attribute) return '-';
    const owner = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
    return `${this.attributeIdentity(attribute)}/${owner.version || 0}/${count}`;
  }
  attributeIdentity(attribute) {
    if (!attribute) return null;
    if (!this.attributeIds.has(attribute))
      this.attributeIds.set(attribute, `a${++this.attributeSerial}`);
    return this.attributeIds.get(attribute);
  }
  encodeAttribute(attribute, count = attribute?.count ?? 0) {
    return encodeAttribute(attribute, count, this.attributeIdentity(attribute));
  }
  texture(texture, packet) {
    if (!texture?.isTexture) return null;
    if (this.frameTextures.has(texture.uuid)) return this.frameTextures.get(texture.uuid);
    const started = this.clock();
    const id = texture.uuid,
      sourceVersion = `${texture.version}/${texture.source?.version || 0}`;
    const image = texture.image;
    const record = {
      id,
      width: image?.width || image?.naturalWidth || 0,
      height: image?.height || image?.naturalHeight || 0,
      repeat: vector(texture.repeat),
      offset: vector(texture.offset),
      rotation: texture.rotation || 0,
      center: vector(texture.center),
      wrapS: wrap(texture.wrapS),
      wrapT: wrap(texture.wrapT),
      minFilter: texture.minFilter,
      magFilter: texture.magFilter,
      flipY: texture.flipY,
      colorSpace: texture.colorSpace || '',
    };
    const signature = JSON.stringify(record),
      previous = this.textureCache.get(id);
    if (!previous || previous.sourceVersion !== sourceVersion || !previous.ready) {
      const data = this.encodeTexture(texture);
      if (data) {
        record.data = data;
        (previous ? packet.frame.textureUpdates : packet.definitions.textures).push(record);
        this.textureCache.set(id, { signature, sourceVersion, ready: true });
      }
    } else if (previous.signature !== signature) {
      packet.frame.textureUpdates.push(record);
      this.textureCache.set(id, { ...previous, signature });
    }
    const result = this.textureCache.has(id) ? id : null;
    this.frameTextures.set(id, result);
    this.profile.textureMs = (this.profile.textureMs || 0) + this.clock() - started;
    return result;
  }
  material(material, packet) {
    if (this.frameMaterials.has(material.uuid)) return material.uuid;
    const started = this.clock();
    this.frameMaterials.add(material.uuid);
    const id = material.uuid,
      maps = {};
    for (const name of MAPS) if (material[name]) maps[name] = this.texture(material[name], packet);
    const uniforms = {};
    for (const [key, uniform] of Object.entries(material.uniforms || {})) {
      const value = uniform.value;
      if (value?.isTexture) uniforms[key] = { texture: this.texture(value, packet) };
      else if (value?.isColor) uniforms[key] = color(value);
      else if (value?.toArray) uniforms[key] = value.toArray();
      else if (typeof value === 'number' || typeof value === 'boolean' || value === null)
        uniforms[key] = value;
    }
    const record = {
      id,
      type: shaderFamily(material),
      color: color(material.color),
      opacity: material.opacity,
      roughness: material.roughness ?? 1,
      metalness: material.metalness ?? 0,
      emissive: color(material.emissive, [0, 0, 0]),
      emissiveIntensity: material.emissiveIntensity ?? 0,
      transparent: !!material.transparent,
      alphaTest: material.alphaTest || 0,
      side: material.side === 2 ? 'double' : material.side === 1 ? 'back' : 'front',
      depthTest: material.depthTest !== false,
      depthWrite: material.depthWrite !== false,
      blending: material.blending === 2 ? 'additive' : 'normal',
      wireframe: !!material.wireframe,
      vertexColors: !!material.vertexColors,
      fog: material.fog !== false,
      toneMapped: material.toneMapped !== false,
      normalScale: vector(material.normalScale),
      bumpScale: material.bumpScale ?? 1,
      rotation: material.rotation || 0,
      size: material.size ?? 1,
      dashSize: material.dashSize,
      gapSize: material.gapSize,
      polygonOffset: !!material.polygonOffset,
      polygonOffsetFactor: material.polygonOffsetFactor || 0,
      maps,
      uniforms,
    };
    const signature = JSON.stringify(record),
      previous = this.materialCache.get(id);
    if (previous !== signature) {
      (previous ? packet.frame.materialUpdates : packet.definitions.materials).push(record);
      this.materialCache.set(id, signature);
    }
    this.profile.materialMs = (this.profile.materialMs || 0) + this.clock() - started;
    return id;
  }
  geometry(geometry, packet) {
    if (this.frameGeometries.has(geometry.uuid)) return geometry.uuid;
    const started = this.clock();
    this.frameGeometries.add(geometry.uuid);
    const id = geometry.uuid,
      previous = this.geometryCache.get(id),
      signatures = {};
    const record = { id, attributes: {}, groups: geometry.groups.map((g) => ({ ...g })) };
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      signatures[name] = this.attributeSignature(attribute);
      if (!previous || previous[name] !== signatures[name]) {
        record.attributes[name] = this.encodeAttribute(attribute);
        attribute.clearUpdateRanges?.();
      }
    }
    signatures.groups = JSON.stringify(record.groups);
    signatures.index = this.attributeSignature(geometry.index);
    if (!previous || previous.index !== signatures.index)
      record.index = this.encodeAttribute(geometry.index);
    if (
      !previous ||
      Object.keys(record.attributes).length ||
      Object.hasOwn(record, 'index') ||
      previous.groups !== signatures.groups
    )
      (previous ? packet.frame.geometryUpdates : packet.definitions.geometries).push(record);
    this.geometryCache.set(id, signatures);
    this.profile.geometryMs = (this.profile.geometryMs || 0) + this.clock() - started;
    return id;
  }
  capture(scene, camera, seq, { time = 0, exposure = 1, post = {} } = {}) {
    const captureStarted = this.clock();
    this.profile = {
      matrixMs: 0,
      traversalMs: 0,
      materialMs: 0,
      geometryMs: 0,
      textureMs: 0,
      resourcesMs: 0,
      objectRecordsMs: 0,
      removalMs: 0,
      leaves: 0,
      unchangedLeaves: 0,
      changedLeaves: 0,
    };
    this.frameGeometries.clear();
    this.frameMaterials.clear();
    this.frameTextures.clear();
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    this.profile.matrixMs = this.clock() - captureStarted;
    const packet = {
      kind: 'scene',
      protocol: SCENE_PROTOCOL,
      seq,
      reset: seq === 1,
      definitions: { geometries: [], materials: [], textures: [] },
      frame: {
        mode: 'delta',
        time,
        camera: {
          matrix: camera.matrixWorld.toArray(),
          projection: camera.projectionMatrix.toArray(),
          fov: camera.fov || 45,
          near: camera.near,
          far: camera.far,
          aspect: camera.aspect,
          orthographic: !!camera.isOrthographicCamera,
        },
        environment: {
          background: color(scene.background, [0, 0, 0]),
          exposure,
          fog: scene.fog
            ? {
                type: scene.fog.isFogExp2 ? 'exp2' : 'linear',
                color: color(scene.fog.color),
                density: scene.fog.density,
                near: scene.fog.near,
                far: scene.fog.far,
              }
            : null,
          post,
        },
        lights: [],
        objects: [],
        removed: [],
        geometryUpdates: [],
        materialUpdates: [],
        textureUpdates: [],
      },
    };
    const visualBindings = captureVisualBindings(scene, seq === 1);
    if (visualBindings) packet.frame.visualBindings = visualBindings;
    const present = new Set();
    const traversalStarted = this.clock();
    scene.traverseVisible((object) => {
      if (object.isLight) {
        packet.frame.lights.push({
          id: object.uuid,
          type: object.isDirectionalLight
            ? 'directional'
            : object.isHemisphereLight
              ? 'hemisphere'
              : object.isAmbientLight
                ? 'ambient'
                : 'point',
          matrix: object.matrixWorld.toArray(),
          color: color(object.color),
          intensity: object.intensity,
          groundColor: color(object.groundColor, [0, 0, 0]),
          distance: object.distance || 0,
          decay: object.decay ?? 2,
          target: object.target?.getWorldPosition(object.position.clone()).toArray(),
          castShadow: !!object.castShadow,
        });
        return;
      }
      if (!object.geometry || !object.material || object.material.visible === false) return;
      if (object.isInstancedMesh && object.count <= 0) return;
      const count = Number.isFinite(object.geometry.drawRange.count)
        ? object.geometry.drawRange.count
        : (object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0);
      // The source marks its empty tracer arrays dirty even while paused. No
      // vertices means no draw: defer both descriptors and buffers until used.
      if (count <= 0) return;
      present.add(object.uuid);
      this.profile.leaves++;
      const geometryId = this.geometry(object.geometry, packet);
      if (Array.isArray(object.material)) {
        for (const material of object.material) this.material(material, packet);
      } else this.material(object.material, packet);
      const type = objectType(object),
        start = object.geometry.drawRange.start,
        renderOrder = object.renderOrder || 0;
      const flags =
        (object.castShadow ? 1 : 0) |
        (object.receiveShadow ? 2 : 0) |
        (object.frustumCulled !== false ? 4 : 0) |
        (object.isLineLoop ? 8 : 0);
      const matrix = object.matrixWorld.elements,
        previous = this.objectCache.get(object.uuid);
      const instanceMatrix = object.isInstancedMesh ? object.instanceMatrix : null;
      const instanceColor = object.isInstancedMesh ? object.instanceColor : null;
      const matrixVersion = instanceMatrix?.version ?? -1,
        colorVersion = instanceColor?.version ?? -1;
      const instanceCount = object.isInstancedMesh ? object.count : 0;
      const centerX = object.isSprite ? object.center?.x : undefined,
        centerY = object.isSprite ? object.center?.y : undefined;
      const matrixChanged =
        !previous ||
        previous.instanceMatrix !== instanceMatrix ||
        previous.matrixVersion !== matrixVersion ||
        previous.instanceCount !== instanceCount;
      const colorChanged =
        !previous ||
        previous.instanceColor !== instanceColor ||
        previous.colorVersion !== colorVersion ||
        previous.instanceCount !== instanceCount;
      if (
        previous &&
        previous.object === object &&
        previous.geometry === object.geometry &&
        previous.geometryId === geometryId &&
        previous.type === type &&
        previous.name === object.name &&
        previous.start === start &&
        previous.count === count &&
        previous.renderOrder === renderOrder &&
        previous.flags === flags &&
        previous.centerX === centerX &&
        previous.centerY === centerY &&
        !matrixChanged &&
        !colorChanged &&
        materialEqual(object.material, previous) &&
        matrixEqual(matrix, previous.matrix)
      ) {
        this.profile.unchangedLeaves++;
        return;
      }
      const materials = Array.isArray(object.material)
        ? object.material.map((material) => material.uuid)
        : [object.material.uuid];
      const record = {
        id: object.uuid,
        type,
        name: object.name,
        geometry: geometryId,
        materials,
        matrix: Array.from(matrix),
        castShadow: !!object.castShadow,
        receiveShadow: !!object.receiveShadow,
        frustumCulled: object.frustumCulled !== false,
        renderOrder,
        loop: !!object.isLineLoop,
        drawRange: { start, count },
        center: object.isSprite ? vector(object.center) : undefined,
      };
      if (object.isInstancedMesh) {
        record.instances = { count: object.count };
        if (matrixChanged) {
          record.instances.matrix = this.encodeAttribute(object.instanceMatrix, object.count);
          object.instanceMatrix.clearUpdateRanges?.();
        }
        if (colorChanged)
          record.instances.color = this.encodeAttribute(object.instanceColor, object.count);
        this.instanceCache.set(object.uuid, {
          matrix: instanceMatrix,
          color: instanceColor,
          matrixVersion,
          colorVersion,
          count: instanceCount,
        });
      }
      packet.frame.objects.push(record);
      this.profile.changedLeaves++;
      this.objectCache.set(record.id, {
        object,
        geometry: object.geometry,
        geometryId,
        type,
        name: object.name,
        materials: Array.isArray(object.material) ? object.material.slice() : [object.material],
        materialIds: materials,
        matrix: record.matrix,
        start,
        count,
        renderOrder,
        flags,
        centerX,
        centerY,
        instanceMatrix,
        instanceColor,
        matrixVersion,
        colorVersion,
        instanceCount,
      });
    });
    this.profile.traversalMs = this.clock() - traversalStarted;
    this.profile.resourcesMs = this.profile.materialMs + this.profile.geometryMs;
    this.profile.objectRecordsMs = Math.max(0, this.profile.traversalMs - this.profile.resourcesMs);
    const removalStarted = this.clock();
    for (const id of this.objectCache.keys())
      if (!present.has(id)) {
        packet.frame.removed.push(id);
        this.objectCache.delete(id);
        this.instanceCache.delete(id);
      }
    this.profile.removalMs = this.clock() - removalStarted;
    this.profile.totalMs = this.clock() - captureStarted;
    return packet;
  }
  diagnostics() {
    return { ...this.profile };
  }
}

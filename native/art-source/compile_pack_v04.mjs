import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Offline conversion only. The browser simulation never imports GLTFLoader or
// downloads art while a soldier fires. A node/material is one shared mesh bank.
const WIDTH = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
export function parseGlb(bytes) {
  if (
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw Error('Invalid GLB header');
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset),
      type = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + length > bytes.length) throw Error('GLB chunk overflow');
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (!json || !binary) throw Error('GLB needs JSON and BIN');
  function accessor(id) {
    const a = json.accessors[id],
      view = json.bufferViews[a?.bufferView];
    if (!a || !view || a.sparse || view.buffer !== 0) throw Error('Unsupported GLB accessor');
    const width = WIDTH[a.componentType],
      size = SIZE[a.type];
    if (!width || !size) throw Error('Unknown GLB component');
    const result = new Float32Array(a.count * size),
      stride = view.byteStride || width * size;
    const start = (view.byteOffset || 0) + (a.byteOffset || 0);
    const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
    const method = {
      5120: 'getInt8',
      5121: 'getUint8',
      5122: 'getInt16',
      5123: 'getUint16',
      5125: 'getUint32',
      5126: 'getFloat32',
    }[a.componentType];
    if (
      a.count &&
      start + (a.count - 1) * stride + size * width > (view.byteOffset || 0) + view.byteLength
    )
      throw Error('GLB accessor overflow');
    for (let i = 0; i < a.count; i++)
      for (let c = 0; c < size; c++) {
        let value = data[method](start + i * stride + c * width, true);
        if (a.normalized && a.componentType !== 5126) {
          const signed = a.componentType === 5120 || a.componentType === 5122;
          value = signed
            ? Math.max(-1, value / (2 ** (width * 8 - 1) - 1))
            : value / (2 ** (width * 8) - 1);
        }
        if (!Number.isFinite(value)) throw Error('Non-finite GLB vertex');
        result[i * size + c] = value;
      }
    return { array: result, size, count: a.count };
  }
  return { json, accessor };
}
const encode = (array, size) => ({
  data: Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64'),
  type: array instanceof Uint32Array ? 'u32' : 'f32',
  size,
});
const ATTRIBUTES = {
  POSITION: ['position', 3],
  NORMAL: ['normal', 3],
  TANGENT: ['tangent', 4],
  TEXCOORD_0: ['uv', 2],
  TEXCOORD_1: ['uv2', 2],
  COLOR_0: ['color', 4],
};
export function compileModelLods(buffers) {
  const levels = buffers.map(parseGlb),
    base = levels[0].json;
  const names = new Set();
  const maps = levels.map(({ json }) => new Map((json.nodes || []).map((n) => [n.name, n])));
  const nodes = (base.nodes || []).map((n, index) => {
    if (!n.name || names.has(n.name)) throw Error('Art nodes need stable unique names');
    names.add(n.name);
    const parent = base.nodes.findIndex((p) => p.children?.includes(index));
    const node = {
      name: n.name,
      parent,
      position: n.translation || [0, 0, 0],
      quaternion: n.rotation || [0, 0, 0, 1],
      scale: n.scale || [1, 1, 1],
      matrix: n.matrix,
      extras: n.extras || {},
      parts: [],
    };
    if (n.mesh === undefined) return node;
    for (const [partIndex, primitive] of base.meshes[n.mesh].primitives.entries()) {
      const banks = levels.map((level, lod) => {
        const other = maps[lod].get(n.name);
        const p =
          other?.mesh === undefined ? null : level.json.meshes[other.mesh].primitives[partIndex];
        if (!p) return null;
        if ((p.mode ?? 4) !== 4) throw Error('Only triangle art meshes');
        const attributes = Object.fromEntries(
          Object.entries(p.attributes)
            .filter(([key]) => ATTRIBUTES[key])
            .map(([key, id]) => [key, level.accessor(id)]),
        );
        const count = attributes.POSITION?.count;
        if (!count || !attributes.NORMAL) throw Error('Art needs positions and normals');
        const indices =
          p.indices === undefined
            ? Float32Array.from({ length: count }, (_, i) => i)
            : level.accessor(p.indices).array;
        if (indices.length % 3 || !indices.every((v) => Number.isInteger(v) && v >= 0 && v < count))
          throw Error('Invalid art triangle indices');
        return { attributes, count, indices };
      });
      const offsets = [],
        total = banks.reduce((sum, b, i) => {
          offsets[i] = sum;
          return sum + (b?.count || 0);
        }, 0);
      const attributes = {};
      for (const [semantic, [name, size]] of Object.entries(ATTRIBUTES)) {
        if (!banks.some((b) => b?.attributes[semantic])) continue;
        const values = new Float32Array(total * size);
        for (const [lod, b] of banks.entries())
          if (b) {
            const source = b.attributes[semantic];
            for (let i = 0; i < b.count; i++)
              for (let c = 0; c < size; c++)
                values[(offsets[lod] + i) * size + c] = source
                  ? c < source.size
                    ? source.array[i * source.size + c]
                    : 1
                  : semantic === 'COLOR_0'
                    ? 1
                    : 0;
          }
        attributes[name] = encode(values, size);
      }
      const indices = banks.map((b, i) =>
        b?.indices.length
          ? Uint32Array.from(b.indices, (v) => v + offsets[i])
          : Uint32Array.of(0, 0, 0),
      );
      node.parts.push({
        geometryKey:
          levels.map((_, lod) => maps[lod].get(n.name)?.mesh ?? 'empty').join('/') +
          '/' +
          partIndex,
        material: primitive.material ?? -1,
        attributes,
        index: encode(indices[0], 1),
        lods: indices.slice(1).map((a, i) => ({ distance: [0.35, 1.25][i], index: encode(a, 1) })),
        triangles: indices.map((a) => a.length / 3),
      });
    }
    return node;
  });
  return {
    nodes,
    materials: base.materials || [],
    textures: base.textures || [],
    images: base.images || [],
  };
}
export async function compilePack(manifestPath, outputPath) {
  const source = JSON.parse(await readFile(manifestPath, 'utf8')),
    directory = path.dirname(manifestPath),
    models = {};
  for (const entry of source.models) {
    const files = entry.lods.map((l) => (typeof l === 'string' ? l : l.file));
    const model = compileModelLods(
      await Promise.all(files.map((f) => readFile(path.resolve(directory, f)))),
    );
    models[entry.key] = { ...model, contract: entry.contract || {} };
  }
  const textures = {};
  for (const t of source.textures || []) {
    const bytes = await readFile(path.resolve(directory, t.rgba));
    if (bytes.length !== t.width * t.height * 4) throw Error('RGBA texture size mismatch');
    textures[t.name] = { width: t.width, height: t.height, data: bytes.toString('base64') };
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({ version: 4, models, textures }));
  return { models: Object.keys(models), bytes: (await readFile(outputPath)).length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  console.log(JSON.stringify(await compilePack(process.argv[2], process.argv[3])));

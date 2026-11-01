import { build, transform } from 'esbuild';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nativeInviteTransform } from '../native/parity/invite-host-transform.mjs';
import { nativePresentationTransform } from '../native/parity/presentation-transform.mjs';
import { nativeModelTransform } from '../native/parity/model-transform.mjs';
import { nativeStaticSceneryTransform } from '../native/parity/static-scenery-transform.mjs';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const native = path.join(root, 'native/parity');
export function parityAliases() {
  const originalThree = path.join(root, 'vendor/three/three.module.js');
  const shim = path.join(native, 'three-godot.mjs');
  return {
    name: 'original-game-godot-backend',
    setup(plugin) {
      plugin.onResolve({ filter: /^skyfront-native-presentation$/ }, () => ({
        path: path.join(native, 'trench-presentation.mjs'),
      }));
      plugin.onResolve({ filter: /^skyfront-native-(vehicles|infantry)$/ }, ({ path: name }) => ({
        path: path.join(native, name.endsWith('vehicles') ? 'vehicle-art.mjs' : 'infantry-art.mjs'),
      }));
      plugin.onResolve({ filter: /^skyfront-native-static-scenery$/ }, () => ({
        path: path.join(native, 'static-scenery-cache.mjs'),
      }));
      plugin.onLoad(
        { filter: /src[\\/]rendering[\\/]terrain[\\/]environment\.js$/ },
        async ({ path: sourcePath }) => ({
          contents: nativeStaticSceneryTransform(
            sourcePath.replaceAll('\\', '/'),
            await readFile(sourcePath, 'utf8'),
          ),
          loader: 'js',
          resolveDir: path.dirname(sourcePath),
        }),
      );
      plugin.onLoad(
        {
          filter:
            /src[\\/]rendering[\\/](models[\\/]infantry[\\/]soldiers|models[\\/]ground|input[\\/]build-tools|sync|effects[\\/]tracer-path|performance[\\/]contact-shadows)\.js$/,
        },
        async ({ path: sourcePath }) => ({
          contents: nativeModelTransform(
            sourcePath.replaceAll('\\', '/'),
            nativePresentationTransform(
              sourcePath.replaceAll('\\', '/'),
              await readFile(sourcePath, 'utf8'),
            ),
          ),
          loader: 'js',
          resolveDir: path.dirname(sourcePath),
        }),
      );
      plugin.onResolve({ filter: /three\.module\.js$/ }, ({ importer }) => ({
        path: importer === shim ? originalThree : shim,
      }));
      plugin.onResolve(
        {
          filter:
            /rendering[\\/]effects[\\/]post-processing\.js$|^\.\/effects\/post-processing\.js$/,
        },
        () => ({ path: path.join(native, 'native-post.mjs') }),
      );
      plugin.onResolve({ filter: /startup-prewarm\.js$/ }, () => ({
        path: path.join(native, 'native-warmup.mjs'),
      }));
      plugin.onLoad(
        { filter: /src[\\/]network[\\/]invite\.js$/ },
        async ({ path: sourcePath }) => ({
          contents: nativeInviteTransform(await readFile(sourcePath, 'utf8')),
          loader: 'js',
          resolveDir: path.dirname(sourcePath),
        }),
      );
    },
  };
}

export async function buildNativeParityWeb(output = path.join(root, 'native/build/parity-web')) {
  output = path.resolve(output);
  await mkdir(output, { recursive: true });
  const worker = await build({
    entryPoints: [path.join(root, 'src/audio/pcm-worker.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    write: false,
    charset: 'utf8',
    metafile: true,
  });
  const bundle = await build({
    entryPoints: [path.join(native, 'entry.mjs')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: false,
    write: false,
    charset: 'utf8',
    legalComments: 'inline',
    metafile: true,
    plugins: [parityAliases()],
    define: { __SKYFRONT_AUDIO_WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) },
  });
  await writeFile(path.join(output, 'game.js'), bundle.outputFiles[0].text, 'utf8');
  let fonts = (await readFile(path.join(root, 'src/ui/fonts.css'), 'utf8')).replace(/^\uFEFF/, '');
  for (const match of [...fonts.matchAll(/url\(([^)]+)\)/g)]) {
    const name = match[1].replace(/^['"]|['"]$/g, ''),
      fontPath = path.resolve(root, 'src/ui', name);
    if (path.relative(root, fontPath).startsWith('..')) throw Error('Font outside project');
    const bytes = await readFile(fontPath),
      mime = fontPath.endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
    fonts = fonts.replace(match[0], `url(data:${mime};base64,${bytes.toString('base64')})`);
  }
  const styles = await Promise.all(
    ['style', 'army', 'multiplayer', 'districts', 'recruitment', 'frontline'].map((name) =>
      readFile(path.join(root, `src/ui/${name}.css`), 'utf8'),
    ),
  );
  const css =
    (fonts + '\n' + styles.join('\n')).replace(/@import\s+url\([^)]*\)\s*;/g, '') +
    '\n/* Only the native 3D backing surface changes; all original controls retain their CSS. */\nhtml,body,#app,#game,#world{background:transparent!important}';
  await writeFile(
    path.join(output, 'style.css'),
    (await transform(css, { loader: 'css', minify: true, charset: 'utf8' })).code,
    'utf8',
  );
  let html = await readFile(path.join(root, 'index.html'), 'utf8');
  html = html
    .replace(/<link rel="stylesheet"[^>]*>/g, '')
    .replace('<script type="module" src="src/main.js"></script>', '')
    .replace('</head>', '<link rel="stylesheet" href="style.css"></head>')
    .replace('</body>', '<script defer src="game.js"></script></body>');
  await writeFile(path.join(output, 'index.html'), html, 'utf8');
  await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
  await cp(
    path.join(root, 'vendor/three/THREE-LICENSE.txt'),
    path.join(output, 'THREE-LICENSE.txt'),
  );
  const sourceNames = new Set(
    [
      ...Object.keys(bundle.metafile.inputs),
      ...Object.keys(worker.metafile.inputs),
      'index.html',
      'src/ui/fonts.css',
      ...['style', 'army', 'multiplayer', 'districts', 'recruitment', 'frontline'].map(
        (name) => `src/ui/${name}.css`,
      ),
    ].filter(
      (name) => name.startsWith('src/') || name.startsWith('src\\') || name === 'index.html',
    ),
  );
  const sourceInputs = await Promise.all(
    [...sourceNames].sort().map(async (name) => {
      const bytes = await readFile(path.resolve(root, name));
      return {
        path: name.replaceAll('\\', '/'),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
  );
  const manifest = {
    renderer: 'Godot',
    originalEntry: 'src/main.js',
    ui: 'original DOM/CSS',
    simulation: 'original src/game',
    network: 'original src/network',
    audio: 'original src/audio',
    adaptations: [
      'Three.WebGLRenderer -> native scene protocol',
      'post GPU backend -> Godot',
      'GPU warmup -> CPU models/navigation + Godot material draw + first-frame acknowledgement',
      'native asset origin default server address',
      'read-only terrain/fortification bindings and shared trench presentation floor',
      'authored ground/infantry art with original aiming, shared LOD banks and pose state',
      'exact static-tree residents, immutable owned geometry and active draw-range transport',
    ],
    sceneProtocol: 1,
    sourceInputs,
    sourceAdaptations: [
      'src/network/invite.js: native virtual hostname default endpoint only',
      'src/rendering/models/infantry/soldiers.js: presentation floor, crew and corpse poses',
      'src/rendering/models/ground.js: MOG presentation floor',
      'src/rendering/input/build-tools.js: matching presentation picking/box projection',
      'src/rendering/sync.js: matching visual muzzle flash',
      'src/rendering/effects/tracer-path.js: matching visual projectile endpoints',
      'src/rendering/performance/contact-shadows.js: matching presentation floor',
      'src/rendering/terrain/environment.js: exact tree-buffer dirty notifications',
      'src/rendering/models/ground.js: native-only authored vehicle factory and original drive phase',
      'src/rendering/models/infantry/soldiers.js: native-only authored rig and normalized hip/leg pose',
    ],
    nativeArt: await Promise.all(
      ['ground-v04.json', 'infantry-v04.json'].map(async (name) => {
        const bytes = await readFile(path.join(root, 'native/art-assets', name)),
          data = JSON.parse(bytes);
        return {
          path: 'native/art-assets/' + name,
          version: data.version,
          models: Object.keys(data.models),
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      }),
    ),
    output,
    bundleBytes: Buffer.byteLength(bundle.outputFiles[0].text),
  };
  await writeFile(
    path.join(output, 'PARITY-BUILD.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  console.log(JSON.stringify(await buildNativeParityWeb(process.argv[2]), null, 2));

import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(process.argv[2] || path.join(root, 'native/build/network'));
await mkdir(path.join(output, 'client'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'native/network/server.mjs')],
  outfile: path.join(output, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  minify: false,
  sourcemap: false,
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire as __nativeCreateRequire } from 'node:module'; const require = __nativeCreateRequire(import.meta.url);",
  },
  plugins: [
    {
      name: 'library-dev-server-without-launcher',
      setup(api) {
        api.onLoad({ filter: /[\\/]scripts[\\/]dev-server\.mjs$/ }, async ({ path: filename }) => {
          const original = await readFile(filename, 'utf8');
          const guard =
            'if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {';
          if (!original.includes(guard))
            throw Error(
              'Original dev-server entry guard changed; review bundled launcher isolation',
            );
          return {
            contents: original.replace(guard, 'if (false) {'),
            loader: 'js',
            resolveDir: path.dirname(filename),
          };
        });
      },
    },
  ],
});
await copyFile(process.execPath, path.join(output, 'node.exe'));
await mkdir(path.join(output, 'licenses'), { recursive: true });
await copyFile(
  path.join(root, 'native/licenses/NODE-LICENSE.txt'),
  path.join(output, 'licenses/NODE-LICENSE.txt'),
);
await copyFile(
  path.join(root, 'node_modules/ws/LICENSE'),
  path.join(output, 'licenses/WS-LICENSE.txt'),
);
const browser = await readFile(path.join(root, 'play/Skyfront.html'));
await writeFile(path.join(output, 'client/Skyfront.html'), browser);
const manifest = {
  scope: 'Unchanged original room authority + standalone original browser peer page; loopback only',
  rules: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version,
  node: process.version,
  browserSha256: createHash('sha256').update(browser).digest('hex'),
  originalFilesModified: false,
  bundleOnlyAdaptation:
    'Disabled scripts/dev-server.mjs CLI auto-launch guard; HTTP API and room authority unchanged',
};
await writeFile(path.join(output, 'network-build.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output, ...manifest }));

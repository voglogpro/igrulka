import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve(process.argv[2] ?? 'native/build/windows/runtime');
await mkdir(output, { recursive: true });
await build({
  entryPoints: ['native/runtime/bridge.mjs'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: path.join(output, 'bridge.mjs'),
  sourcemap: false,
  minify: false,
});
await copyFile(process.execPath, path.join(output, 'node.exe'));
console.log(`Offline rules runtime: ${output}`);

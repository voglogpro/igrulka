import { build, transform } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(process.argv[2] || path.join(root, 'play/Skyfront.html'));
const audioWorker = await build({
  entryPoints: [path.join(root, 'src/audio/pcm-worker.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  charset: 'utf8',
  write: false,
});
const bundle = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  charset: 'utf8',
  legalComments: 'inline',
  write: false,
  define: { __SKYFRONT_AUDIO_WORKER_SOURCE__: JSON.stringify(audioWorker.outputFiles[0].text) },
});

let fonts = (await readFile(path.join(root, 'src/ui/fonts.css'), 'utf8')).replace(/^\uFEFF/, '');
for (const match of [...fonts.matchAll(/url\(([^)]+)\)/g)]) {
  const name = match[1].replace(/^['"]|['"]$/g, '');
  const fontPath = path.resolve(root, 'src/ui', name);
  if (path.relative(root, fontPath).startsWith('..')) throw Error('Font outside project.');
  const bytes = await readFile(fontPath);
  const mime = fontPath.endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
  fonts = fonts.replace(match[0], `url(data:${mime};base64,${bytes.toString('base64')})`);
}
const base = (
  await Promise.all(
    [
      'src/ui/style.css',
      'src/ui/army.css',
      'src/ui/multiplayer.css',
      'src/ui/districts.css',
      'src/ui/recruitment.css',
      'src/ui/frontline.css',
    ].map(async (file) => (await readFile(path.join(root, file), 'utf8')).replace(/^\uFEFF/, '')),
  )
)
  .join('\n')
  .replace(/@import\s+url\([^)]*\)\s*;/g, '');
const css = (await transform(fonts + '\n' + base, { loader: 'css', minify: true, charset: 'utf8' }))
  .code;
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let html = await readFile(path.join(root, 'index.html'), 'utf8');
html = html
  .replace(/<link rel="stylesheet"[^>]*>/g, '')
  .replace(/^[\t ]+$/gm, '')
  .replace(/<script type="module" src="src\/main.js"><\/script>/, '')
  .replace(
    '</head>',
    () => `<meta name="skyfront-distribution" content="standalone"><style>${css}</style></head>`,
  )
  .replace('</body>', () => `<script>${js}</script></body>`);
const licenses = await Promise.all(
  [
    'vendor/three/THREE-LICENSE.txt',
    'assets/fonts/golostext-OFL.txt',
    'assets/fonts/manrope-OFL.txt',
    'assets/audio/LICENSE.md',
    'assets/audio/CC0-1.0.txt',
  ].map((name) => readFile(path.join(root, name), 'utf8')),
);
html +=
  '\n<!-- Included third-party licenses\n' + licenses.join('\n\n').replace(/--/g, '—') + '\n-->\n';
for (const inline of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
  await transform(inline[1], { loader: 'js', target: 'es2022' });
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, html, 'utf8');
console.log(JSON.stringify({ file: output, bytes: Buffer.byteLength(html), externalResources: 0 }));

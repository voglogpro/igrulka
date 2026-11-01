import { createInterface } from 'node:readline';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createRoomServer } from '../../server/rooms.mjs';
import { PROTOCOL_VERSION } from '../../src/network/commands.js';

// The original room authority, command allowlist, snapshots, AI and game rules
// are bundled unchanged. Only process lifetime and packaged static files differ.
const compress = promisify(gzip);
const defaultClient = fileURLToPath(new URL('./client/', import.meta.url));
const clientRoot = path.resolve(
  process.argv.find((arg) => arg.startsWith('--client-root='))?.slice(14) || defaultClient,
);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};
const cache = new Map();
let closing = false;
const server = createRoomServer({
  standalone: false,
  compression: false,
  maxRooms: 4,
  serverInfo: () => ({ publicUrl: null, clientUrl: null, status: 'local', retryCount: 0 }),
});
const originalRequests = server.http.listeners('request');
server.http.removeAllListeners('request');
server.http.on('request', async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) {
      if (req.headers.origin === 'http://skyfront.localhost') {
        res.setHeader('Access-Control-Allow-Origin', 'http://skyfront.localhost');
        res.setHeader('Vary', 'Origin');
      }
      for (const handler of originalRequests) handler.call(server.http, req, res);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const requested = pathname === '/' || pathname === '/index.html' ? '/Skyfront.html' : pathname;
    if (requested.split('/').some((part) => part.startsWith('.'))) {
      res.writeHead(404).end();
      return;
    }
    const filename = path.resolve(clientRoot, '.' + requested);
    const relative = path.relative(clientRoot, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(404).end();
      return;
    }
    const info = await stat(filename);
    if (!info.isFile()) {
      res.writeHead(404).end();
      return;
    }
    const zipped =
      ['.html', '.js', '.css', '.ttf', '.txt', '.json'].includes(path.extname(filename)) &&
      /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const key = filename + ':' + zipped;
    let content = cache.get(key);
    if (!content || content.modified !== info.mtimeMs) {
      let bytes = await readFile(filename);
      if (zipped) bytes = await compress(bytes);
      content = {
        modified: info.mtimeMs,
        bytes,
        etag: '"' + createHash('sha256').update(bytes).digest('hex') + '"',
      };
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(key, content);
    }
    if (req.headers['if-none-match'] === content.etag) {
      res
        .writeHead(304, {
          ETag: content.etag,
          Vary: 'Accept-Encoding',
          'Cache-Control': 'no-cache',
        })
        .end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
      'Content-Length': content.bytes.length,
      'Cache-Control': 'no-cache',
      ETag: content.etag,
      Vary: 'Accept-Encoding',
      ...(zipped ? { 'Content-Encoding': 'gzip' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : content.bytes);
  } catch {
    res.writeHead(404).end();
  }
});
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
async function close(code = 0) {
  if (closing) return;
  closing = true;
  input.close();
  process.stdin.pause();
  await server.close();
  process.exitCode = code;
}
input.on('line', (line) => {
  try {
    if (line.length > 4096) throw Error('Control line too large');
    const message = JSON.parse(line);
    if ([message.cmd, message.kind, message.type].includes('shutdown')) void close();
    else throw Error('Only shutdown is supported');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    void close(1);
  }
});
input.on('close', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
process.once('SIGINT', () => {
  void close();
});
try {
  await new Promise((resolve, reject) => {
    server.http.once('error', reject);
    server.http.listen(0, '127.0.0.1', resolve);
  });
  if (!closing)
    process.stdout.write(
      JSON.stringify({
        kind: 'server-ready',
        url: `http://127.0.0.1:${server.http.address().port}`,
        protocol: PROTOCOL_VERSION,
      }) + '\n',
    );
} catch (error) {
  process.stderr.write('Native network startup failed: ' + error.message + '\n');
  await close(1);
}

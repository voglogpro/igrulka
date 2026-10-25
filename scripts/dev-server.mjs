import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const compress = promisify(gzip);
const connectionProbe = Buffer.alloc(32768, 83);

const root = fileURLToPath(new URL('..', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function createGameServer({ serverInfo, standalone = false } = {}) {
  const representations = new Map();
  return http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/api/tunnel-probe' && serverInfo) {
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.writeHead(405, { Allow: 'GET, HEAD' }).end();
          return;
        }
        const size = Number(new URL(req.url, 'http://localhost').searchParams.get('size'));
        if (!Number.isInteger(size) || size < 2048 || size > 32768) {
          res.writeHead(400).end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Content-Length': size,
          'X-Skyfront-Probe': 'tunnel-v1',
        });
        res.end(req.method === 'HEAD' ? undefined : connectionProbe.subarray(0, size));
        return;
      }
      if (pathname === '/api/connection-check' && serverInfo) {
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.writeHead(405, { Allow: 'GET, HEAD' }).end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Content-Length': connectionProbe.length,
          'X-Skyfront-Probe': '32k-v1',
        });
        res.end(req.method === 'HEAD' ? undefined : connectionProbe);
        return;
      }
      if (pathname === '/api/server-info' && serverInfo) {
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.writeHead(405, { Allow: 'GET, HEAD' }).end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify(serverInfo()));
        return;
      }
      const resource =
        pathname === '/' || pathname === '/index.html'
          ? standalone
            ? '/play/Skyfront.html'
            : '/index.html'
          : pathname;
      if (
        !(standalone && resource === '/play/Skyfront.html') &&
        !['/index.html', '/src/', '/assets/', '/vendor/'].some(
          (prefix) =>
            resource === prefix ||
            resource.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'),
        )
      ) {
        res.writeHead(404).end('Not found');
        return;
      }
      const file = path.resolve(root, '.' + resource);
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        res.writeHead(404).end('Not found');
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      const compressed =
        standalone &&
        ['.html', '.js', '.css', '.ttf', '.txt'].includes(path.extname(file)) &&
        /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const cacheKey = `${file}:${compressed}`;
      let cached = representations.get(cacheKey);
      if (!cached || cached.modified !== info.mtimeMs) {
        let bytes = await readFile(file);
        if (standalone && resource === '/play/Skyfront.html') {
          // The portable file keeps all fonts for offline use. Online, let the
          // browser load only the used faces with font-display:swap, so half a
          // megabyte of unused embedded fonts cannot delay the first game frame.
          bytes = Buffer.from(
            bytes
              .toString('utf8')
              .replace(/@font-face\{[^}]*\}/g, '')
              .replace('</head>', '<link rel="stylesheet" href="/src/ui/fonts.css"></head>')
              .replace(
                '<div id="app"></div>',
                '<div id="app"><div style="position:fixed;inset:0;display:grid;place-content:center;gap:14px;padding:24px;text-align:center;color:#dce6df;background:#142022;font-family:system-ui"><b style="font-size:24px;letter-spacing:2px">НЕБЕСНЫЙ РУБЕЖ</b><span style="font-size:13px;color:#a9bdb4">Загружаем город. Первая загрузка может занять немного времени…</span></div></div>',
              ),
          );
        }
        if (compressed) bytes = await compress(bytes);
        cached = {
          modified: info.mtimeMs,
          bytes,
          etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
        };
        if (representations.size >= 32) representations.delete(representations.keys().next().value);
        representations.set(cacheKey, cached);
      }
      const cacheControl = resource.startsWith('/assets/fonts/')
        ? 'public, max-age=86400'
        : 'no-cache';
      if (req.headers['if-none-match'] === cached.etag) {
        res
          .writeHead(304, {
            ETag: cached.etag,
            'Cache-Control': cacheControl,
            Vary: 'Accept-Encoding',
          })
          .end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': cacheControl,
        ETag: cached.etag,
        ...(standalone ? { Vary: 'Accept-Encoding' } : {}),
        ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
        'Content-Length': cached.bytes.length,
      });
      res.end(req.method === 'HEAD' ? undefined : cached.bytes);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createGameServer();
  let port = Number(process.argv.find((arg) => arg.startsWith('--port='))?.split('=')[1] ?? 8787);
  let attempts = 0;
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempts++ < 20) server.listen(++port, '127.0.0.1');
    else {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
  server.on('listening', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    console.log(`Skyfront: ${url}\nKeep this process running. Ctrl+C stops the server.`);
    if (!process.argv.includes('--no-open') && process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' }).unref();
    }
  });
  server.listen(port, '127.0.0.1');
}

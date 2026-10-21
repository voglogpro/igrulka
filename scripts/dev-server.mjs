import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function createGameServer() {
  return http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const resource = pathname === '/' ? '/index.html' : pathname;
      if (
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
      if (relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(file)).isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(await readFile(file));
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

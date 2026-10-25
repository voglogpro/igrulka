import { pathToFileURL } from 'node:url';
import { createRoomServer } from './rooms.mjs';
import { clientPageUrl } from './client-page.mjs';

export function hostedConfig(env = process.env) {
  let publicUrl;
  try {
    publicUrl = new URL(clientPageUrl(env.PUBLIC_URL));
    if (!env.PUBLIC_URL || publicUrl.pathname !== '/') throw Error();
  } catch {
    throw Error(
      'PUBLIC_URL must be an explicit HTTPS origin without credentials, path, query or fragment',
    );
  }
  const port = Number(env.PORT ?? 8080);
  const maxRooms = Number(env.MAX_ROOMS ?? 2);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid PORT');
  if (!Number.isInteger(maxRooms) || maxRooms < 1 || maxRooms > 16)
    throw Error('MAX_ROOMS must be 1..16');
  if (env.HOST && !['0.0.0.0', '127.0.0.1', '::', '::1'].includes(env.HOST))
    throw Error('Invalid HOST bind address');
  return {
    host: env.HOST || '0.0.0.0',
    port,
    maxRooms,
    publicUrl: publicUrl.origin,
    clientUrl: env.CLIENT_URL ? clientPageUrl(env.CLIENT_URL) : null,
  };
}

export function createHostedServer(config = hostedConfig()) {
  const server = createRoomServer({
    standalone: true,
    compression: true,
    maxRooms: config.maxRooms,
    serverInfo: () => ({
      publicUrl: config.publicUrl,
      clientUrl: config.clientUrl,
      status: 'ready',
      retryCount: 0,
    }),
  });
  // Keep the existing HTTP/static and WS upgrade implementation. Only the hosted
  // entrypoint adds this cheap route, before the static file request handler.
  const handlers = server.http.listeners('request');
  server.http.removeAllListeners('request');
  server.http.on('request', (req, res) => {
    if (req.url?.split('?')[0] === '/healthz') {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : '{"ok":true}');
      }
      return;
    }
    for (const handler of handlers) handler.call(server.http, req, res);
  });
  return server;
}

export async function startHostedServer(env = process.env) {
  const config = hostedConfig(env),
    server = createHostedServer(config);
  try {
    await new Promise((resolve, reject) => {
      server.http.once('error', reject);
      server.http.listen(config.port, config.host, resolve);
    });
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = await startHostedServer();
    console.log(`Hosted Skyfront listening on port ${server.http.address().port}`);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      await server.close();
    };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
  } catch {
    console.error(
      'Hosted startup failed. Check PUBLIC_URL, CLIENT_URL, HOST and PORT configuration.',
    );
    process.exitCode = 1;
  }
}

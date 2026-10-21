import { createRoomServer } from './rooms.mjs';
import { networkInterfaces } from 'node:os';

const host = process.argv.find((a) => a.startsWith('--host='))?.slice(7) || '127.0.0.1';
const port = Number(process.argv.find((a) => a.startsWith('--port='))?.slice(7) || 8788);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
const server = createRoomServer();
server.http.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.http.listen(port, host, () => {
  const boundPort = server.http.address().port;
  const localHost = ['0.0.0.0', '::'].includes(host)
    ? '127.0.0.1'
    : host.includes(':')
      ? `[${host}]`
      : host;
  console.log(`Skyfront multiplayer: http://${localHost}:${boundPort}`);
  if (['0.0.0.0', '::'].includes(host))
    for (const address of Object.values(networkInterfaces())
      .flat()
      .filter((a) => a?.family === 'IPv4' && !a.internal))
      console.log(`Local network: http://${address.address}:${boundPort}`);
  console.log('Open the same server in two browsers. Ctrl+C stops the session.');
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    server.close().then(() => process.exit());
  });

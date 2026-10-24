import { createRoomServer } from './rooms.mjs';
import { startInternetTunnel } from './internet.mjs';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';

const internet = process.argv.includes('--internet');
const host = internet
  ? '127.0.0.1'
  : process.argv.find((a) => a.startsWith('--host='))?.slice(7) || '127.0.0.1';
const port = Number(
  process.argv.find((a) => a.startsWith('--port='))?.slice(7) || (internet ? 0 : 8788),
);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
let publicUrl = null,
  tunnel = null,
  closing = false;
const startup = new AbortController();
const server = createRoomServer({
  serverInfo: () => ({ publicUrl }),
  standalone: internet,
  compression: internet,
});
async function close(code = 0) {
  if (closing) return;
  closing = true;
  startup.abort();
  publicUrl = null;
  tunnel?.stop();
  await server.close();
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close());
try {
  await new Promise((resolve, reject) => {
    server.http.once('error', reject);
    server.http.listen(port, host, resolve);
  });
  const boundPort = server.http.address().port;
  const localHost = ['0.0.0.0', '::'].includes(host)
    ? '127.0.0.1'
    : host.includes(':')
      ? `[${host}]`
      : host;
  const localUrl = `http://${localHost}:${boundPort}`;
  console.log(`Skyfront multiplayer: ${localUrl}`);
  if (internet) {
    console.log('Подключаю интернет-игру. Окно сервера нужно оставить открытым.');
    tunnel = await startInternetTunnel({
      localUrl,
      signal: startup.signal,
      onProgress: console.log,
      onPublicUrl: (value) => {
        if (publicUrl && value && publicUrl !== value)
          console.log('Интернет-адрес обновился. Скопируйте новое приглашение в меню комнаты.');
        publicUrl = value;
      },
      onExit: () => {
        console.error(
          'Интернет-соединение сервера закрыто. Перезапустите «Играть через интернет» и отправьте новое приглашение.',
        );
        close(1);
      },
    });
    if (closing) tunnel.stop();
    else {
      const entry = `${publicUrl}/?multiplayer=1`;
      const hostEntry = `${localUrl}/?multiplayer=1`;
      console.log(`\nИНТЕРНЕТ-ИГРА: ${entry}`);
      console.log(`ХОЗЯИН ИГРАЕТ ЗДЕСЬ: ${hostEntry}`);
      console.log('Создайте комнату → «Копировать приглашение» → отправьте ссылку другу.');
      console.log(
        'Другу нужен только браузер. Временный адрес может меняться; копируйте приглашение в меню комнаты. Ctrl+C — остановить.',
      );
      if (!process.argv.includes('--no-open') && process.platform === 'win32')
        spawn('cmd.exe', ['/c', 'start', '', hostEntry], {
          windowsHide: true,
          stdio: 'ignore',
        }).unref();
    }
  } else {
    if (['0.0.0.0', '::'].includes(host))
      for (const address of Object.values(networkInterfaces())
        .flat()
        .filter((a) => a?.family === 'IPv4' && !a.internal))
        console.log(`Local network: http://${address.address}:${boundPort}`);
    console.log(
      'Для игры через интернет откройте «Играть через интернет.cmd». Ctrl+C останавливает сервер.',
    );
  }
} catch (error) {
  console.error(`Не удалось запустить сетевую игру: ${error.message}`);
  await close(1);
}

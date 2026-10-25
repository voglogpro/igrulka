import { createRoomServer } from './rooms.mjs';
import { createInternetSession } from './internet-session.mjs';
import { clientPageUrl } from './client-page.mjs';
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
const clientUrl = internet
  ? clientPageUrl(process.argv.find((a) => a.startsWith('--client-url='))?.slice(13))
  : null;
let internetSession = null,
  closing = false;
const startup = new AbortController();
const server = createRoomServer({
  serverInfo: () => ({
    ...(internetSession?.state || {
      publicUrl: null,
      status: internet ? 'recovering' : 'local',
      retryCount: 0,
    }),
    clientUrl,
  }),
  standalone: internet,
  compression: internet,
});
async function close(code = 0) {
  if (closing) return;
  closing = true;
  startup.abort();
  await internetSession?.stop();
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
    let previousUrl = null;
    internetSession = createInternetSession({
      localUrl,
      signal: startup.signal,
      onProgress: console.log,
      onChange: ({ publicUrl: value, status }) => {
        if (status !== 'ready' || !value) return;
        if (previousUrl && value !== previousUrl)
          console.log('Интернет-адрес обновился. Скопируйте новое приглашение в меню комнаты.');
        if (value !== previousUrl) console.log(`\nИНТЕРНЕТ-ИГРА: ${value}/?multiplayer=1`);
        previousUrl = value;
      },
    });
    if (closing) await internetSession.stop();
    else {
      const hostEntry = `${localUrl}/?multiplayer=1`;
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

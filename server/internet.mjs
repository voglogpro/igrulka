import { startSshTunnel } from './ssh-tunnel.mjs';
import { startQuickTunnel, waitForPublicServer } from './tunnel.mjs';

// Registration and public routing are separate: keep the authoritative room
// server and private match state outside the choice of a forwarding provider.
export async function startInternetTunnel({
  localUrl,
  signal,
  onProgress = () => {},
  onPublicUrl = () => {},
  onExit = () => {},
  providers = [startSshTunnel, startQuickTunnel],
  check = waitForPublicServer,
} = {}) {
  let lastError;
  for (let index = 0; index < providers.length; index++) {
    signal?.throwIfAborted();
    let candidate,
      accepted = false,
      exited = false,
      discarded = false,
      latestURL = null,
      revision = 0;
    try {
      candidate = await providers[index]({
        localUrl,
        signal,
        onProgress,
        onExit: (code) => {
          if (discarded) return;
          exited = true;
          if (accepted) onExit(code);
        },
        onUrlChange: (value) => {
          if (discarded || exited || value === latestURL) return;
          latestURL = value;
          revision++;
          onPublicUrl(value);
        },
      });
      if (!latestURL) {
        latestURL = candidate.url;
        onPublicUrl(latestURL);
      }
      onProgress('Проверяю доступность игры через интернет…');
      for (let attempt = 0; attempt < 3; attempt++) {
        const checkingRevision = revision;
        let failure;
        try {
          await check(latestURL, { signal, successes: 3 });
        } catch (error) {
          failure = error;
        }
        signal?.throwIfAborted();
        if (exited) throw Error('Интернет-соединение закрылось во время проверки.');
        if (checkingRevision !== revision) continue;
        if (failure) throw failure;
        accepted = true;
        return {
          ...candidate,
          get url() {
            return latestURL;
          },
          stop() {
            discarded = true;
            candidate.stop();
          },
        };
      }
      throw Error('Интернет-адрес меняется во время проверки. Повторите запуск.');
    } catch (error) {
      discarded = true;
      candidate?.stop();
      onPublicUrl(null);
      signal?.throwIfAborted();
      lastError = error;
      if (index < providers.length - 1)
        onProgress('Основной интернет-маршрут недоступен. Пробую резервное подключение…');
    }
  }
  throw lastError || Error('Не удалось запустить интернет-подключение.');
}

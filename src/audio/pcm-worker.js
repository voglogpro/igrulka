import { pcmCatalog } from './pcm-catalog.js';
// One outstanding preset per worker message keeps priority switching possible.
const catalogs = new Map();
self.onmessage = ({ data: { rate, index } }) => {
  try {
    if (!catalogs.has(rate)) catalogs.set(rate, pcmCatalog(rate));
    const job = catalogs.get(rate)[index],
      output = job.make();
    const channels = Array.isArray(output) ? output : [output];
    self.postMessage(
      { rate, index, channels },
      channels.map((channel) => channel.buffer),
    );
  } catch {
    self.postMessage({ rate, index, error: true });
  }
};

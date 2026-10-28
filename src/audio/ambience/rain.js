import { encodedRain } from '../samples/rain-recording.js';

const contexts = new WeakMap();
// Decode once per context during loading. Bundled bytes work offline/file://;
// failed codec support leaves ambience silent, never substitutes synthetic rain.
export function prepareRecordedRain(context) {
  if (contexts.has(context)) return contexts.get(context);
  const ready = Promise.resolve()
    .then(async () => {
      const binary = atob(encodedRain),
        bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const buffer = await context.decodeAudioData(bytes.buffer);
      return context.state === 'closed' ? null : buffer;
    })
    .catch(() => null);
  contexts.set(context, ready);
  return ready;
}

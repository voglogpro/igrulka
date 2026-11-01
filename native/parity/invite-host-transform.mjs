export function nativeInviteTransform(source) {
  const original =
    "return normalizeServerAddress(page.protocol === 'file:' ? fallback : page.origin, pageURL);";
  if (!source.includes(original))
    throw Error('Original invite default endpoint contract changed; review native host adaptation');
  return source.replace(
    original,
    `// Only the native virtual asset origin needs a separate actual game server.
  const nativeServer = globalThis.__SKYFRONT_NATIVE__?.serverAddress || globalThis.__SKYFRONT_NATIVE__?.server || fallback;
  return normalizeServerAddress(page.hostname === 'skyfront.localhost' ? nativeServer : page.protocol === 'file:' ? fallback : page.origin, pageURL);`,
  );
}

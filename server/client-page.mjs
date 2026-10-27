export const DEFAULT_CLIENT_URL = 'https://voglogpro.github.io/igrulka/releases/8.12.0/';

export function clientPageUrl(value = DEFAULT_CLIENT_URL) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    /[\s\\]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw Error('Client page must be an HTTPS URL without credentials, query or fragment');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('Invalid client page URL');
  }
  if (
    url.href.length > 2048 ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value.includes('?') ||
    value.includes('#')
  )
    throw Error('Client page must be an HTTPS URL without credentials, query or fragment');
  return url.href;
}

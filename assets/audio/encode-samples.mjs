import { readFile, writeFile } from 'node:fs/promises';

for (const name of [
  'fpv-rotor',
  'prop-engine',
  'footstep-1',
  'footstep-2',
  'footstep-3',
  'truck-engine',
]) {
  const wav = await readFile(new URL(`./${name}.wav`, import.meta.url));
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
    throw Error('Expected a WAV file');
  let pcm, rate;
  for (let at = 12; at + 8 <= wav.length;) {
    const size = wav.readUInt32LE(at + 4),
      kind = wav.toString('ascii', at, at + 4);
    if (kind === 'fmt ') {
      if (
        wav.readUInt16LE(at + 8) !== 1 ||
        wav.readUInt16LE(at + 10) !== 1 ||
        wav.readUInt16LE(at + 22) !== 16
      )
        throw Error('Expected mono PCM16');
      rate = wav.readUInt32LE(at + 12);
    }
    if (kind === 'data') pcm = wav.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  if (!pcm || !rate) throw Error('Incomplete WAV');
  const encoded = pcm.toString('base64'),
    chunks = encoded.match(/.{1,120}/g);
  const source = [
    `// Generated PCM16LE from assets/audio/${name}.wav; CC0 provenance: assets/audio/LICENSE.md.`,
    '// Keep bundled: offline/file:// playback must not fetch or decode external media.',
    `export const sampleRate = ${rate};`,
    'export const pcm = [',
    ...chunks.map((chunk) => `  '${chunk}',`),
    "].join('');",
    '',
  ].join('\n');
  await writeFile(new URL(`../../src/audio/samples/${name}.js`, import.meta.url), source);
}

import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// No synthesis, network access, source replacement or download at build time.
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'native/Skyfront.Client/Assets/audio');
const check = process.argv.includes('--check');
const rainOnly = process.argv.includes('--rain-only');
// InspectorJ / Freesound #401277, CC-BY-4.0; see copied LICENSE.md and rain-sources.json.
// Source already contains the approved 56.5s loop crossfade and -2dB processing.
// Transcode only: retain duration, sample rate, stereo channels and decoded gain;
// lossy Vorbis re-encoding is not a bit-exact preservation of Opus sample values.
const rainSourceHash = '894e73679f77ce9b160959718d2d16d3449b725cee741a6c7812adb83fd2bb24';
// FFmpeg 9.0.2 libvorbis q5, bitexact container flags. Revalidate if changing the encoder.
const rainOutputHash = '24f554e09640f338f64074495c90a1ccffa02c437b700db3c6baf87f848fe6e1';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rainSource = path.join(root, 'assets/audio/rain-inspectorj.opus');
if (sha256(await readFile(rainSource)) !== rainSourceHash)
  throw Error('Approved rain recording checksum mismatch');
const clips = [
  {
    source: 'impact-592000.mp3',
    output: 'impact-recording.wav',
    sha256: 'fbc04a0bcbdba5647d5546d33c853d3ba2ef4cd2e24095bb62113202076f93ef',
    args: [],
  },
  {
    source: 'rifle-238916.mp3',
    output: 'rifle-recording.wav',
    sha256: '5d0fdc6b392289ca0bc1f14092c2f027e53998f015c4c92ecb23e25d19dfc463',
    args: ['-t', '0.24', '-af', 'afade=t=out:st=0.21:d=0.03'],
  },
];
for (const clip of rainOnly ? [] : clips) {
  const source = path.join(root, 'native/audio-sources', clip.source);
  const bytes = await readFile(source);
  if (createHash('sha256').update(bytes).digest('hex') !== clip.sha256)
    throw Error(`Source recording checksum mismatch: ${clip.source}`);
}
if (!check) {
  await mkdir(output, { recursive: true });
  for (const name of await readdir(path.join(root, 'assets/audio')))
    if (/\.(wav|opus|json|txt|md)$/i.test(name))
      if (
        !rainOnly ||
        ['rain-inspectorj.opus', 'rain-sources.json', 'LICENSE.md', 'CC-BY-4.0.txt'].includes(name)
      )
        await copyFile(path.join(root, 'assets/audio', name), path.join(output, name));
  for (const clip of rainOnly ? [] : clips) {
    const result = spawnSync(
      process.env.FFMPEG_PATH || 'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-i',
        path.join(root, 'native/audio-sources', clip.source),
        ...clip.args,
        '-map_metadata',
        '-1',
        '-ac',
        '1',
        '-ar',
        '44100',
        '-c:a',
        'pcm_s16le',
        '-fflags',
        '+bitexact',
        '-flags:a',
        '+bitexact',
        path.join(output, clip.output),
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    );
    if (result.error || result.status !== 0)
      throw Error(`FFmpeg recording conversion failed: ${result.error?.message || result.stderr}`);
  }
  const rain = spawnSync(
    process.env.FFMPEG_PATH || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-i',
      rainSource,
      '-map_metadata',
      '-1',
      '-c:a',
      'libvorbis',
      '-q:a',
      '5',
      '-fflags',
      '+bitexact',
      '-flags:a',
      '+bitexact',
      path.join(output, 'rain.ogg'),
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 },
  );
  if (rain.error || rain.status !== 0)
    throw Error(`FFmpeg rain transcode failed: ${rain.error?.message || rain.stderr}`);
}
const stagedOpus = await readFile(path.join(output, 'rain-inspectorj.opus'));
if (sha256(stagedOpus) !== rainSourceHash) throw Error('Staged Opus recording checksum mismatch');
const stagedRain = await readFile(path.join(output, 'rain.ogg'));
if (
  stagedRain.toString('ascii', 0, 4) !== 'OggS' ||
  !stagedRain.includes(Buffer.from('\x01vorbis'))
)
  throw Error('Expected staged Ogg Vorbis rain');
if (sha256(stagedRain) !== rainOutputHash)
  throw Error(`Rain encoder output differs from pinned FFmpeg 9.0.2: ${sha256(stagedRain)}`);
console.log(
  `rain.ogg: ${stagedRain.length} bytes; SHA256 ${sha256(stagedRain)}; InspectorJ CC-BY-4.0; unchanged 56.5s loop, Vorbis transcode only`,
);
for (const clip of rainOnly ? [] : clips) {
  const wav = await readFile(path.join(output, clip.output));
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
    throw Error(`Invalid staged WAV: ${clip.output}`);
  console.log(
    `${clip.output}: ${wav.length} bytes; SHA256 ${createHash('sha256').update(wav).digest('hex')}`,
  );
}
// Keep the source note beside the originals when packaged/copied independently.
if (!check && !rainOnly)
  await writeFile(
    path.join(root, 'native/audio-sources/README.md'),
    await readFile(path.join(output, 'README.md')),
  );

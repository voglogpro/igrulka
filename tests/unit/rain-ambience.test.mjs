import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepareRecordedRain } from '../../src/audio/ambience/rain.js';
import { encodedRain } from '../../src/audio/samples/rain-recording.js';
import { pcmCatalog } from '../../src/audio/pcm-catalog.js';

test('real rain is bundled exactly and synthetic worker rain is removed', async () => {
  const data = Buffer.from(encodedRain, 'base64');
  const metadata = JSON.parse(
    await readFile(new URL('../../assets/audio/rain-sources.json', import.meta.url)),
  );
  assert.equal(data.subarray(0, 4).toString(), 'OggS');
  assert.equal(createHash('sha256').update(data).digest('hex'), metadata.sha256);
  assert.equal(metadata.synthesized, false);
  assert.equal(metadata.author, 'InspectorJ');
  assert.equal(metadata.license, 'CC-BY-4.0');
  const jobs = pcmCatalog(8000);
  assert.equal(jobs.length, 41);
  assert.ok(!jobs.some((job) => job.name === 'rain'));
});

test('rain decoding is shared per context; closed and unsupported contexts stay silent', async () => {
  let calls = 0;
  const buffer = { duration: 56.5 };
  const context = {
    state: 'suspended',
    decodeAudioData(bytes) {
      calls++;
      assert.equal(new Uint8Array(bytes)[0], 79);
      return Promise.resolve(buffer);
    },
  };
  const pending = prepareRecordedRain(context);
  assert.equal(prepareRecordedRain(context), pending);
  assert.equal(await pending, buffer);
  assert.equal(calls, 1);
  context.state = 'closed';
  assert.equal(
    await prepareRecordedRain({ state: 'closed', decodeAudioData: context.decodeAudioData }),
    null,
  );
  assert.equal(
    await prepareRecordedRain({
      decodeAudioData() {
        throw new Error('codec');
      },
    }),
    null,
  );
});

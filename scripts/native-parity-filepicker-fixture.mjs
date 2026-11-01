// Read ONLY the explicitly verified own export; never enumerate Downloads.
// The generated raw fixture is ignored. This source prints metadata only.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../src/game/index.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const verifiedPath = path.resolve(
  repo,
  process.argv[2] || 'artifacts/native/input-export-auto-1/file-utf8-reverified.json',
);
const output = path.resolve(repo, process.argv[3] || 'artifacts/native/real-filepicker-qa.js');
const verified = JSON.parse(await readFile(verifiedPath, 'utf8'));
assert.equal(verified.passed, true);
assert.ok(verified.file.path && !verified.file.path.includes('\ufffd'));
assert.match(verified.file.filename, /^skyfront-city-\d+(?: \(\d+\))?\.json$/);
const bytes = await readFile(verified.file.path);
const sha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(bytes.length, verified.file.bytes);
assert.equal(sha256, verified.file.sha256);
assert.equal(bytes.length, 4609, 'This scoped proof uses only the already accepted own export');
assert.equal(sha256, '1bd1e6e19afd9876faebb625ce53cbbb26e4ec02428d0bb20028e37c0aa2a734');
// Exact ORIGINAL importFile E.load -> campaignStore game.save -> page load E.load.
const expected = JSON.parse(E.save(E.load(E.save(E.load(bytes.toString('utf8'))))));
const fixture = {
  filePath: verified.file.path,
  filename: verified.file.filename,
  bytes: bytes.length,
  sha256,
  verifiedReport: verifiedPath,
  expected,
  expectedOriginalContinue: expected.time > 0 || expected.buildings.length > expected.sides.length,
  sourceContract:
    'original importFile E.load -> campaignStore game.save -> original page load E.load',
};
const template = await readFile(
  new URL('./native-parity-filepicker-qa.js', import.meta.url),
  'utf8',
);
const script =
  'window.__SKYFRONT_REAL_FILEPICKER_FIXTURE__ = ' + JSON.stringify(fixture) + ';\n' + template;
new Function(script);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, script, 'utf8');
await writeFile(
  output + '.fixture-metadata.json',
  JSON.stringify(
    {
      filePath: fixture.filePath,
      filename: fixture.filename,
      bytes: fixture.bytes,
      sha256,
      verifiedReport: verifiedPath,
      expectedTime: expected.time,
      expectedRevision: expected.networkRevision,
      expectedOriginalContinue: fixture.expectedOriginalContinue,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    output,
    bytes: bytes.length,
    sha256,
    expectedTime: expected.time,
    expectedRevision: expected.networkRevision,
    rawSavePrinted: false,
  }),
);

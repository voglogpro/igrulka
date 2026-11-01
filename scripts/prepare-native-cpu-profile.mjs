import { readFile, writeFile } from 'node:fs/promises';
const input = process.argv[2] || 'artifacts/native/battle-qa/native-battle-qa.generated.js';
const output = process.argv[3] || 'artifacts/native/native04-profile-qa.js';
let source = await readFile(input, 'utf8');
const before = '    const began = performance.now();';
if (source.split(before).length !== 2) throw Error('Battle profile injection point changed');
source = source.replace(
  before,
  `    fixture.battleSeconds=15;\n    post({kind:'qa-cpu-profile',action:'start'});\n    post({kind:'qa-result',stage:'base64-capabilities',nativeBase64:typeof Uint8Array.prototype.toBase64});\n${before}`,
);
source = source.replace(
  '    observer?.disconnect();',
  "    post({kind:'qa-cpu-profile',action:'stop'});\n    await delay(500);\n    observer?.disconnect();",
);
await writeFile(output, source);
console.log(
  JSON.stringify({ output, scope: '15s diagnostic CPU sample; not a normal60s acceptance run' }),
);

import { readFile, writeFile } from 'node:fs/promises';
const file = process.argv[2] || 'artifacts/native/native04-cpu-profile.out.log';
const lines = (await readFile(file, 'utf8')).split(/\r?\n/),
  prefix = 'SKYFRONT_PARITY_CPU_PROFILE ';
const line = lines.find((l) => l.startsWith(prefix));
if (!line) throw Error('No native CPU profile result');
const profile = JSON.parse(line.slice(prefix.length)).profile.profile;
const nodes = new Map(profile.nodes.map((n) => [n.id, { ...n, self: 0, total: 0 }])),
  parents = new Map();
for (const n of nodes.values()) for (const child of n.children || []) parents.set(child, n.id);
for (const [i, id] of profile.samples.entries()) {
  const time = profile.timeDeltas[i] || 0;
  nodes.get(id).self += time;
  for (let current = id; current !== undefined; current = parents.get(current))
    nodes.get(current).total += time;
}
const summary = [...nodes.values()].map((n) => ({
  name: n.callFrame.functionName || '(anonymous)',
  line: n.callFrame.lineNumber + 1,
  url: n.callFrame.url,
  selfMs: n.self / 1000,
  totalMs: n.total / 1000,
}));
const result = {
  durationMs: (profile.endTime - profile.startTime) / 1000,
  samples: profile.samples.length,
  self: [...summary].sort((a, b) => b.selfMs - a.selfMs).slice(0, 24),
  inclusive: [...summary].sort((a, b) => b.totalMs - a.totalMs).slice(0, 24),
};
await writeFile(file + '.cpuprofile', JSON.stringify(profile));
await writeFile(file + '.summary.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

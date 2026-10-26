import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const here = fileURLToPath(import.meta.url),
  root = path.resolve(path.dirname(here), '../..');
const option = (name) =>
  process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
if (option('measure')) {
  const target = path.resolve(option('measure')),
    E = await import(pathToFileURL(path.join(target, 'src/game/index.js')));
  const results = [];
  for (const [name, count] of [
    ['defend', 40],
    ['move', 90],
    ['move', 500],
  ]) {
    const s = E.createGame(8112);
    s.rules.rear = false;
    s.rules.oil = false;
    const ids = [];
    for (let i = 0; i < count; i++) {
      const u = E.makeGround(
        s,
        0,
        'machinegunner',
        -1200 + (i % 20) * 8,
        -180 + Math.floor(i / 20) * 6,
      );
      s.groundUnits.push(u);
      ids.push(u.id);
    }
    const at = performance.now();
    const accepted =
      name === 'defend'
        ? E.applyStance(s, 0, ids, { mode: 'defend', post: 'auto' })
        : E.orderGround(s, 0, ids, { x: 850, z: -1350, mode: 'attackmove' });
    results.push({
      name,
      count,
      accepted,
      handlerMs: performance.now() - at,
      paths: s.groundUnits.filter((u) => u.path.length).length,
      pending: s.groundUnits.filter((u) => u.routeState).length,
    });
  }
  console.log(JSON.stringify({ target, results }));
} else {
  const baseline = option('baseline-root'),
    report = {
      conditions:
        'Fictional stress armies inserted in memory; handler wall time only, shared machine, no GPU/FPS claim',
      cases: {},
    };
  for (const [label, target] of [
    ...(baseline ? [['baseline', path.resolve(baseline)]] : []),
    ['candidate', root],
  ]) {
    const text = execFileSync(process.execPath, [here, `--measure=${target}`], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 240000,
    });
    report.cases[label] = JSON.parse(text);
    console.log(JSON.stringify({ label, ...report.cases[label] }));
  }
  mkdirSync(path.join(root, 'artifacts/qa'), { recursive: true });
  writeFileSync(
    path.join(root, 'artifacts/qa/input-cost8112.json'),
    JSON.stringify(report, null, 2),
  );
}

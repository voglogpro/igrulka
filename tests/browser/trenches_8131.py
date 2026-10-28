"""Controlled visual trench fixtures, not paid-economy or cover/balance evidence.

Own ephemeral Node port-0 server and fresh Chromium session. Produces four PNGs
for human review; geometry lengths/world vertices are verified by art unit tests.
"""
import ctypes
import json
import os
import subprocess
import sys
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

sys.stdout.reconfigure(encoding='utf8')
if os.name == 'nt':
    ctypes.windll.kernel32.SetPriorityClass(ctypes.c_void_p(-1), 0x4000)

report = {'fixture': 'controlled persistent stage-3 trenches and E.makeGround soldiers; '
          'no simulation/economy/cover proof, no terrain overrides, no FPS claims',
          'errors': [], 'scenes': []}
server = subprocess.Popen(
    ['node', 'scripts/dev-server.mjs', '--port=0', '--no-open'], cwd=ROOT,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf8',
    creationflags=(subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS)
    if os.name == 'nt' else 0)

INSTALL = r'''async ({kind, hour}) => {
  const E = skyfront.engine, w = skyfront.getWorld();
  const s = E.createGame(8131, {mode: 'multiplayer'});
  // clock.js: hour = (18.5 + time / 50) % 24.
  s.time = ((hour - 18.5 + 24) % 24) * 50;
  let origin = {x: -850, z: -180, yaw: 0};
  if (kind === 'slope') {
    let best = null;
    // Bounded sampling of the actual shipped land heightfield. No terrain edits.
    for (let z = -1400; z <= 1400; z += 32)
      for (let x = -1700; x <= -350; x += 32) {
        const yaw = Math.PI / 4, dx = Math.cos(yaw)*9, dz = -Math.sin(yaw)*9;
        const points = [[x,z],[x-dx,z-dz],[x+dx,z+dz]];
        if (points.some(([px,pz]) => E.isWater(px,pz) || E.riverDistance(px,pz)<100)) continue;
        const heights = points.map(([px,pz]) => E.groundHeight(px,pz));
        const rise = Math.abs(heights[2]-heights[1]);
        if (heights[0] > 1 && heights[0] < 12 && rise > 0.6 && rise < 3 &&
            (!best || rise > best.rise)) best = {x,z,yaw,rise,heights};
      }
    if (!best) throw Error('No real dry rotated slope fixture found');
    origin = best;
  }
  const trench = (x,z,yaw) => {
    const t = {id:s.nextId++,side:0,x,z,yaw,progress:1,fortificationWork:90};
    s.trenches.push(t);
    return t;
  };
  const a = trench(origin.x,origin.z,origin.yaw);
  if (kind === 'link') trench(origin.x+80,origin.z,origin.yaw);
  for (const along of [-6,0,6]) {
    const x=a.x+Math.cos(a.yaw)*along,z=a.z-Math.sin(a.yaw)*along;
    const u=E.makeGround(s,0,'infantry',x,z);
    Object.assign(u,{y:E.groundHeight(x,z),yaw:a.yaw,trenchId:a.id,guard:{x,z},holdFire:true});
    s.groundUnits.push(u);
  }
  Object.assign(w.state,s);
  w.previousSimTime=s.time;
  w.select(null);
  w.sync();
  const controls=w.controls;
  controls.rotate((controls.yaw-(-0.35))/0.005,(Math.PI*0.32-controls.pitch)/0.004);
  w.focus(origin.x+(kind==='link'?40:0),origin.z,kind==='link'?165:100,{instant:true});
  w.updateDaylight();
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const snapshot=()=>({
    diagnostics:w.diagnostics().fortifications,
    matrices:[...w.fortifications.pools,...w.fortifications.links.pools]
      .map(p=>({version:p.instanceMatrix.version,count:p.count})),
    // Only use an existing counter if the renderer exposes it.
    heightReads:w.fortifications.heightReads??null,
    linkHeightReads:w.fortifications.links.heightReads??null
  });
  const before=snapshot();
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const after=snapshot();
  return {kind,hour,day:E.dayPhase(s.time),origin,
    trenches:s.trenches.map(t=>({...t,actualTerrainHeight:E.groundHeight(t.x,t.z)})),
    soldiers:s.groundUnits.map(u=>({id:u.id,x:u.x,z:u.z,trenchId:u.trenchId})),
    requestedPostLength:18,requestedLinkSpan:kind==='link'?80:null,
    before,after,paused:skyfront.isPaused(),camera:w.controls.diagnostics()};
}'''

try:
    line = server.stdout.readline().strip()
    assert line.startswith('Skyfront: http://127.0.0.1:'), line
    report['url'] = line.split('Skyfront: ', 1)[1] + '/'
    with sync_playwright() as playwright:
        # launch_browser launches a new Chromium process with its own disposable
        # temporary profile; this context has no existing tabs/account state.
        browser = launch_browser(playwright)
        try:
            if os.name == 'nt':
                script = f'$tree=@(Get-CimInstance Win32_Process);$owned=@({os.getpid()});for($i=0;$i -lt 5;$i++){{$owned+=@($tree|Where-Object{{$owned -contains $_.ParentProcessId -and $owned -notcontains $_.ProcessId}}|ForEach-Object{{$_.ProcessId}})}};$owned|Sort-Object -Unique|ForEach-Object{{try{{(Get-Process -Id $_).PriorityClass="BelowNormal"}}catch{{}}}}'
                subprocess.run(['powershell', '-NoProfile', '-Command', script],
                    creationflags=subprocess.CREATE_NO_WINDOW, check=True)
            context = browser.new_context(viewport={'width': 1440, 'height': 900})
            page = context.new_page()
            page.set_default_timeout(60000)
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.on('console', lambda message: report['errors'].append(message.text)
                    if message.type == 'error' else None)
            page.goto(report['url'], wait_until='load')
            page.wait_for_function('window.skyfront && skyfront.getWorld().shadersReady',
                                   polling=100, timeout=60000)
            page.locator('[data-action="start"]').click()
            if not page.evaluate('skyfront.isPaused()'):
                page.keyboard.press('Space')
            for name, kind, hour in [
                ('standalone-day', 'standalone', 12),
                ('longlink-day', 'link', 12),
                ('longlink-evening', 'link', 18.5),
                ('rotated-slope-day', 'slope', 12),
            ]:
                scene = page.evaluate(INSTALL, {'kind': kind, 'hour': hour})
                report['scenes'].append(scene)
                assert scene['paused'], scene
                assert len(scene['soldiers']) == 3, scene
                assert abs(scene['day']['hour'] - hour) < 1e-8, scene
                before, after = scene['before'], scene['after']
                assert before['matrices'] == after['matrices'], scene
                assert before['heightReads'] == after['heightReads'], scene
                assert before['linkHeightReads'] == after['linkHeightReads'], scene
                diagnostic = after['diagnostics']
                assert diagnostic['batches'] == 6, scene
                assert diagnostic['positions'] == (2 if kind == 'link' else 1), scene
                assert diagnostic['capacity'] >= diagnostic['positions'], scene
                assert diagnostic['terrainDeviation'] >= 0, scene
                assert diagnostic['links']['links'] == (1 if kind == 'link' else 0), scene
                assert diagnostic['stages'] == ([2, 2, 2] if kind == 'link' else [1, 1, 1]), scene
                scene['screenshot'] = 'trenches-8131-' + name + '.png'
                page.screenshot(path=str(ARTIFACTS / scene['screenshot']))
            assert not report['errors'], report['errors']
        finally:
            browser.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait(timeout=5)
    (ARTIFACTS / 'trenches-8131.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(report, ensure_ascii=False, indent=2))

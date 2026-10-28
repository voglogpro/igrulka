"""One bounded source-world coverage check; no frame-rate claims."""
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
server = subprocess.Popen(['node', 'scripts/dev-server.mjs', '--port=0', '--no-open'], cwd=ROOT,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf8',
    creationflags=(subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS) if os.name == 'nt' else 0)
line = server.stdout.readline().strip()
assert line.startswith('Skyfront: http://127.0.0.1:'), line
report = {'url': line.split('Skyfront: ', 1)[1]+'/', 'errors': []}
try:
    with sync_playwright() as p:
        browser = launch_browser(p)
        if os.name == 'nt':
            script = f'$tree=@(Get-CimInstance Win32_Process);$owned=@({os.getpid()});for($i=0;$i -lt 5;$i++){{$owned+=@($tree|Where-Object{{$owned -contains $_.ParentProcessId -and $owned -notcontains $_.ProcessId}}|ForEach-Object{{$_.ProcessId}})}};$owned|Sort-Object -Unique|ForEach-Object{{try{{(Get-Process -Id $_).PriorityClass="BelowNormal"}}catch{{}}}}'
            subprocess.run(['powershell','-NoProfile','-Command',script], creationflags=subprocess.CREATE_NO_WINDOW, check=True)
        try:
            page = browser.new_page(viewport={'width':1366,'height':768})
            page.on('pageerror', lambda e: report['errors'].append(str(e)))
            page.set_default_timeout(60000)
            page.goto(report['url'], wait_until='load')
            page.wait_for_function('window.skyfront && skyfront.getWorld().shadersReady', polling=100, timeout=60000)
            page.locator('[data-action="start"]').click()
            if not page.evaluate('skyfront.isPaused()'):
                page.keyboard.press('Space')
            report['circles'] = page.evaluate('''()=>{
              const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(813,{mode:'multiplayer'});
              Object.assign(s.sides[0],{credits:100000,materials:10000});
              const radar=E.build(s,0,'radar',-1080,-10);if(typeof radar==='string')throw Error(radar);
              radar.progress=1;radar.hp=radar.maxHp;
              const d=E.BUILDINGS.gun,gun={id:s.nextId++,side:0,key:'gun',x:-1000,z:-10,hp:d.hp,maxHp:d.hp,progress:1,level:0};
              s.buildings.push(gun);Object.assign(w.state,s);w.previousSimTime=s.time;w.sync();
              skyfront.select(radar.id);const detection={visible:w.coverage.visible,radius:w.coverage.scale.x,type:w.coverage.geometry.type};
              skyfront.select(gun.id);const aa={visible:w.coverage.visible,radius:w.coverage.scale.x};
              gun.level=1;w.sync();const upgraded={visible:w.coverage.visible,radius:w.coverage.scale.x,expected:E.defenseStats(s.sides[0],gun).range*1.3};
              skyfront.select(radar.id);w.focus(radar.x,radar.z,1900,{instant:true});
              return {detection,aa,upgraded};
            }''')
            c=report['circles']
            assert c['detection']['visible'] and c['detection']['radius']==850 and c['detection']['type']=='RingGeometry',c
            assert c['aa']['visible'] and abs(c['aa']['radius']-240.5)<1e-9,c
            assert abs(c['upgraded']['radius']-c['upgraded']['expected'])<1e-9,c
            page.screenshot(path=str(ARTIFACTS/'selection-coverage-813.png'))
            assert not report['errors'],report['errors']
        finally:
            browser.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait(timeout=5)
    (ARTIFACTS/'selection-coverage-813.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))

"""Source 8.13 UI integration, isolated port/profile, functional checks only."""
import ctypes
import sys
sys.stdout.reconfigure(encoding="utf-8")
import json
import os
import subprocess
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

if os.name == 'nt':
    ctypes.windll.kernel32.SetPriorityClass(ctypes.c_void_p(-1), 0x4000)

server = subprocess.Popen(['node', 'scripts/dev-server.mjs', '--port=0', '--no-open'],cwd=ROOT,
    stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf8',
    creationflags=(subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS) if os.name=='nt' else 0)
first_line=server.stdout.readline().strip()
assert first_line.startswith('Skyfront: http://127.0.0.1:'), first_line
source_url=first_line.split('Skyfront: ',1)[1]+'/'
report = {'url':source_url,'failedRequests': [],'errors': [], 'screens': [], 'conditions': 'Source 8.13, isolated port/profile, BelowNormal, SwiftShader; no timing claim'}
try:
    with sync_playwright() as p:
        print('Launching isolated source browser', flush=True)
        browser = launch_browser(p)
        if os.name == 'nt':
            script = f'$uiTree = @(Get-CimInstance Win32_Process); $uiOwned = @({os.getpid()}); for ($i=0;$i -lt 5;$i++) {{ $uiOwned += @($uiTree | Where-Object {{ $uiOwned -contains $_.ParentProcessId -and $uiOwned -notcontains $_.ProcessId }} | ForEach-Object {{ $_.ProcessId }}) }}; $uiOwned | Sort-Object -Unique | ForEach-Object {{ try {{ (Get-Process -Id $_).PriorityClass = "BelowNormal" }} catch {{}} }}'
            subprocess.run(['powershell','-NoProfile','-Command',script],creationflags=subprocess.CREATE_NO_WINDOW,check=True)

        try:
            page = browser.new_page(viewport={'width': 1366, 'height': 768})
            page.on('pageerror', lambda e: (report['errors'].append(str(e)),print('PAGE ERROR: '+str(e),flush=True)))
            pending=set()
            page.on('request',lambda r:pending.add(r.url))
            page.on('requestfinished',lambda r:pending.discard(r.url))
            page.on('requestfailed',lambda r:(pending.discard(r.url),report['failedRequests'].append({'url':r.url,'failure':r.failure})))
            report['consoleErrors']=[]
            page.on('console',lambda m:report['consoleErrors'].append(m.text[:2000]) if m.type=='error' else None)
            page.set_default_timeout(120000)
            print('Navigating source', flush=True)
            page.goto(source_url, wait_until='load')
            print('Waiting startup readiness', flush=True)
            diagnose="()=>({url:location.href,readyState:document.readyState,skyfront:!!window.skyfront,status:window.skyfront?.getWorld()?.shaderWarmupStatus,progress:window.skyfront?.getWorld()?.shaderWarmupProgress,shadersReady:window.skyfront?.getWorld()?.shadersReady,text:document.body.innerText.slice(0,2000)})"
            report['startupBefore']=page.evaluate(diagnose)
            print(json.dumps(report['startupBefore'],ensure_ascii=False),flush=True)
            try:
                page.wait_for_function('Boolean(window.skyfront) && skyfront.getWorld().shadersReady', timeout=45000,polling=100)
            except Exception:
                report['startupTimeout']=page.evaluate(diagnose)
                report['pendingRequests']=sorted(pending)
                print(json.dumps(report['startupTimeout'],ensure_ascii=False),flush=True)
                page.screenshot(path=str(ARTIFACTS/'ui813-startup-pending.png'))
                raise
            print('Starting game', flush=True)
            page.locator('[data-action="start"]').click(timeout=180000)
            if not page.evaluate('skyfront.isPaused()'):
                page.keyboard.press('Space')
            print('Installing controlled fixture', flush=True)
            report['fixture'] = page.evaluate('''()=>{
              const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(813,{mode:'multiplayer'});
              s.rules.rear=false;s.weather.kind='clear';s.weather.amount=0;
              for(const f of s.sides){f.credits=100000;f.materials=10000;f.oil=1000;f.components=100;}
              const add=(key,side,x,z)=>{const d=E.BUILDINGS[key],b={id:s.nextId++,key,side,x,z,hp:d.hp,maxHp:d.hp,progress:1,level:0,queue:[],rotation:0};s.buildings.push(b);return b;};
              const factory=add('factory',0,-1210,-10),launcher=add('launcher',0,-1080,-10),silo=add('silo',0,-950,70);
              add('power',0,-1210,-80);const electronics=add('electronics',0,-1080,-80);electronics.componentProgress=0.5;add('radar',0,-1080,70);
              factory.launchStore={drone:2,heavy:0,cruise:0,ballistic:0};
              launcher.launchStore={drone:1,heavy:0};silo.launchStore={cruise:0,ballistic:2};
              s.ammoVehicles.push({id:s.nextId++,side:0,depotId:factory.id,targetId:silo.id,targetKind:'building',x:-1150,z:70,y:0,yaw:0,hp:80,maxHp:80,status:'outbound',cargo:{kind:'weapon',key:'cruise',amount:1},path:[{x:-950,z:70}],pickup:null});
              for(let i=0;i<40;i++){
                const u=E.makeGround(s,0,'machinegunner',-420,(i%2?-1:1)*(1320+Math.floor(i/2)*5));
                u.autoDefense=true;u.stance={mode:'defend',post:'auto'};u.guard={x:u.x,z:u.z};
                u.defensePost={corridorId:i%2?'north':'south',slot:i%3,row:Math.floor(i/6)*2};s.groundUnits.push(u);
              }
              const foe=add('launcher',1,1100,-10);foe.launchStore={drone:1};
              E.launch(s,1,'drone',{x:-1145,z:0},1,foe.id);
              Object.assign(s.units[0],{x:-700,z:0,y:50,prevX:-700,prevY:50,prevZ:0,vx:-38,vz:0,launched:true,delay:0});
              Object.assign(w.state,s);w.previousSimTime=s.time;w.sync();
              return {factory:factory.id,launcher:launcher.id,silo:silo.id,electronics:electronics.id,attack:E.defenseAttackStatus(s,0),warning:E.radarAirWarning(s,0)};
            }''')
            page.wait_for_function("document.querySelector('#stock').textContent==='6'",polling=100)
            report['physicalStockCounter']=page.locator('#stock').inner_text()
            assert report['fixture']['attack']['count'] == 12, report['fixture']
            assert report['fixture']['warning']['eta'] is not None, report['fixture']
            for width, height in [(1366,768),(1024,600)]:
                print(f'UI viewport {width}x{height}', flush=True)
                page.set_viewport_size({'width':width,'height':height})
                page.evaluate("skyfront.openPanel('army',true)")
                page.wait_for_timeout(200)
                page.locator('#panel').evaluate('e=>e.scrollTop=0')
                page.wait_for_function("document.querySelector('[data-action=\"defense-attack\"]').textContent.includes('('+skyfront.engine.defenseAttackStatus(skyfront.getWorld().state,0).count+')')")
                attack = page.locator('[data-action="defense-attack"]')
                assert attack.is_visible() and not attack.is_disabled()
                for selector in ['[data-action="defense-attack"]','[data-action="attack-recall"]','#attack-living']:
                    r=page.locator(selector).bounding_box()
                    assert r and r['x']>=0 and r['y']>=0 and r['x']+r['width']<=width and r['y']+r['height']<=height,(selector,width,height,r)
                if width == 1366:
                    attack.click()
                    page.wait_for_function('skyfront.engine.defenseAttackStatus(skyfront.getWorld().state,0).active===12')
                    page.wait_for_function("document.querySelector('#attack-living').textContent.includes('12')")
                    assert not page.locator('[data-action="attack-recall"]').is_disabled()
                    report['activeAttack']=page.evaluate('skyfront.engine.defenseAttackStatus(skyfront.getWorld().state,0)')
                    page.screenshot(path=str(ARTIFACTS/'ui813-attack-active-1366.png'))

                page.locator('#panel').evaluate('e=>e.scrollTop=0')
                page.screenshot(path=str(ARTIFACTS/f'ui813-army-{width}.png'))
                report['screens'].append(f'ui813-army-{width}.png')
                if width == 1024:
                    page.locator('[data-action="attack-recall"]').click()
                    page.wait_for_function('skyfront.engine.defenseAttackStatus(skyfront.getWorld().state,0).returning===12')
                    report['recalledAttack']=page.evaluate('skyfront.engine.defenseAttackStatus(skyfront.getWorld().state,0)')
                page.locator('[data-tab="oil"]').click()
                electronics=page.locator('[data-build="electronics"]')
                assert electronics.is_visible()
                page.evaluate('skyfront.select('+str(report['fixture']['silo'])+')')
                before=page.evaluate('JSON.stringify(skyfront.getWorld().state.buildings.map(b=>[b.id,b.weaponDemand]))')
                if not page.locator('.inspector-more').evaluate('e=>e.open'):
                    page.locator('.inspector-more summary').click()
                page.wait_for_timeout(650)
                page.evaluate('skyfront.select('+str(report['fixture']['factory'])+')')
                page.evaluate('skyfront.select('+str(report['fixture']['silo'])+')')
                assert page.evaluate('JSON.stringify(skyfront.getWorld().state.buildings.map(b=>[b.id,b.weaponDemand]))') == before
                assert page.locator('.inspector-more').evaluate('e=>e.open'), 'per-entity details openness survives'
                report[f'inspector{width}']=page.locator('#inspector').inner_text()
                assert 'Едет 1' in report[f'inspector{width}'] and '≈' in report[f'inspector{width}']
                for button in page.locator('#inspector .inspect-primary button').all():
                    r=button.bounding_box()
                    assert r and r['x']>=0 and r['y']>=0 and r['x']+r['width']<=width and r['y']+r['height']<=height,(width,height,r)

                page.screenshot(path=str(ARTIFACTS/f'ui813-silo-{width}.png'))
                report['screens'].append(f'ui813-silo-{width}.png')
                page.evaluate('skyfront.select('+str(report['fixture']['electronics'])+')')
                assert '100/120' in page.locator('.inspect-key-status').inner_text()
                if not page.locator('.inspector-more').evaluate('e=>e.open'):
                    page.locator('.inspector-more summary').click()
                assert '0.3 нефти' in page.locator('#equipment-detail').inner_text()
                report[f'electronics{width}']=page.locator('#inspector').inner_text()
                page.screenshot(path=str(ARTIFACTS/f'ui813-electronics-{width}.png'))

                page.evaluate("skyfront.openPanel('attack',true)")
                assert 'эл.' in page.locator('[data-weapon="cruise"] small').inner_text()
                page.locator('#panel [data-weapon="cruise"]').click()
                page.wait_for_timeout(350)
                # User weapon selection requests supply; reopening aiming controls is read-only.
                before=page.evaluate('JSON.stringify(skyfront.getWorld().state.buildings.map(b=>[b.id,b.weaponDemand]))')
                page.evaluate("skyfront.openPanel('attack',true)")
                page.locator('[data-action="aim"]').click()
                page.wait_for_timeout(350)
                assert page.evaluate('JSON.stringify(skyfront.getWorld().state.buildings.map(b=>[b.id,b.weaponDemand]))') == before
                report[f'strike{width}']=page.locator('#strike-controls').inner_text()
                assert page.locator('#components').inner_text().endswith('эл.')
                report[f'mission{width}']=page.locator('#mission').inner_text()
                page.keyboard.press('Escape')
                page.evaluate('skyfront.getWorld().controls.focusInput()')
                before_pan=page.evaluate('({x:skyfront.getWorld().controls.desired.x,z:skyfront.getWorld().controls.desired.z})')
                page.keyboard.down('w')
                page.wait_for_function('p=>Math.hypot(skyfront.getWorld().controls.desired.x-p.x,skyfront.getWorld().controls.desired.z-p.z)>2',arg=before_pan)
                page.keyboard.up('w')

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
    (ARTIFACTS/'ui813-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))

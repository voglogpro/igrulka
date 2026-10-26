"""Offline 8.11.2: physical defensive deployment, continuous trenches and real army clicks."""
import contextlib
import ctypes
import json
import os
import re
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser


if os.name == 'nt':
    ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)

game = ROOT / 'play' / 'Skyfront.html'
title = re.search(r'<title>(.*?)</title>', game.read_text(encoding='utf8'), re.DOTALL).group(1)
assert '8.11.2' in title, title
report = {
    'title': title,
    'errors': [],
    'consoleErrors': [],
    'conditions': 'Fresh isolated offline Chrome profile, SwiftShader, 1280x800; functional test, no FPS claim',
}

with sync_playwright() as p:
    browser = launch_browser(p)
    page = None
    try:
        page = browser.new_page(viewport={'width': 1280, 'height': 800}, offline=True)
        page.set_default_timeout(120000)
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.on('console', lambda message: report['consoleErrors'].append(message.text[:2000])
                if message.type == 'error' or 'GL_INVALID_' in message.text or 'GL_OUT_OF_MEMORY' in message.text else None)
        page.goto(game.as_uri(), wait_until='load', timeout=180000)
        page.wait_for_function('Boolean(window.skyfront) && skyfront.getWorld().shadersReady')
        page.locator('[data-action="start"]').click()
        if not page.evaluate('skyfront.isPaused()'):
            page.keyboard.press('Space')
        assert page.evaluate('skyfront.isPaused()')
        report['fixture'] = page.evaluate('''()=>{
          const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(8112,{mode:'multiplayer'});
          s.rules.rear=false;s.rules.oil=false;
          for(const ai of [s.ai,...Object.values(s.aiBySide||{})])
            ai.nextBuild=ai.nextArmy=ai.nextAttack=1e9;
          for(const f of s.sides){f.credits=100000;f.materials=10000;f.oil=10000;}
          s.weather.kind='clear';s.weather.amount=0;
          for(const d of s.districts){d.owner=0;d.hp=E.DISTRICTS.find(c=>c.id===d.id).hp;}
          const ids=[];
          for(let i=0;i<40;i++){
            const north=i%2===0,n=Math.floor(i/2);
            const u=E.makeGround(s,0,'machinegunner',-220+(n%4)*10,(north?-1:1)*(1290+Math.floor(n/4)*12));
            s.groundUnits.push(u);ids.push(u.id);
          }
          const result=E.applyStance(s,0,ids,{mode:'defend',post:'auto'});
          Object.assign(w.state,s);w.previousSimTime=s.time;w.sync();
          return {units:ids.length,standingOrder:result,initialPaths:s.groundUnits.filter(u=>u.path?.length).length,
            initialPositions:s.groundUnits.map(u=>({id:u.id,x:u.x,z:u.z})),time:s.time};
        }''')
        assert report['fixture']['standingOrder'] == 40
        assert report['fixture']['initialPaths'] == 0
        report['deployment'] = []
        for _ in range(14):
            report['deployment'].append(page.evaluate('''()=>{
              const E=skyfront.engine,w=skyfront.getWorld(),s=w.state;
              E.advance(s,5);w.sync();
              const own=s.groundUnits.filter(u=>u.side===0),count=id=>own.filter(u=>u.defensePost?.corridorId===id).length;
              return {time:s.time,north:count('north'),south:count('south'),moving:own.filter(u=>u.path?.length).length,
                trenches:s.trenches.length,completed:s.trenches.filter(t=>t.progress>=1).length,
                linkRendering:w.fortifications.links.diagnostics()};
            }'''))
        report['defense'] = page.evaluate('''()=>{
          const E=skyfront.engine,w=skyfront.getWorld(),s=w.state,own=s.groundUnits.filter(u=>u.side===0);
          w.focus(130,-1390,400,{instant:true});w.sync();
          return {time:s.time,north:own.filter(u=>u.defensePost?.corridorId==='north').length,
            south:own.filter(u=>u.defensePost?.corridorId==='south').length,
            uniquePosts:new Set(own.map(u=>u.guard&&`${u.guard.x.toFixed(1)},${u.guard.z.toFixed(1)}`)).size,
            positions:own.map(u=>({id:u.id,x:u.x,z:u.z,guard:u.guard,path:u.path.length})),
            completed:s.trenches.filter(t=>t.progress>=1).length,rendering:w.fortifications.diagnostics(),
            attack:E.defenseAttackStatus(s,0)};
        }''')
        assert report['defense']['north'] == 20 and report['defense']['south'] == 20, report['defense']
        assert report['defense']['uniquePosts'] == 40, report['defense']
        assert report['defense']['completed'] > 0, report['defense']
        assert report['defense']['rendering']['links']['links'] > 0, report['defense']
        assert report['defense']['attack']['count'] == 12, report['defense']['attack']
        page.screenshot(path=str(ARTIFACTS / 'defense8112-continuous-front.png'), timeout=120000)

        page.keyboard.press('f')
        attack = page.locator('[data-action="defense-attack"]')
        page.wait_for_function('document.querySelector(\'[data-action="defense-attack"]\')?.textContent.includes("(12)")')
        assert attack.is_visible() and not attack.is_disabled()
        report['attackBefore'] = page.evaluate('''()=>{
          const s=skyfront.getState(),f=s.sides[0];
          return {credits:f.credits,materials:f.materials,oil:f.oil,ammoStock:structuredClone(f.ammoStock),
            queues:s.buildings.reduce((n,b)=>n+(b.armyQueue?.length||0),0),ground:s.groundUnits.length};
        }''')
        attack.click()
        page.wait_for_function('skyfront.getState().groundUnits.filter(u=>u.stance?.mode==="attack").length===12')
        report['attackQueued'] = page.evaluate('''()=>{
          const s=skyfront.getState(),f=s.sides[0],attackers=s.groundUnits.filter(u=>u.stance?.mode==='attack');
          return {credits:f.credits,materials:f.materials,oil:f.oil,ammoStock:structuredClone(f.ammoStock),
            queues:s.buildings.reduce((n,b)=>n+(b.armyQueue?.length||0),0),ground:s.groundUnits.length,
            attackers:attackers.length,paths:attackers.filter(u=>u.path.length).length,
            queuedRoutes:attackers.filter(u=>u.routeState&&u.routeQueue.length===1).length,
            north:s.groundUnits.filter(u=>u.autoDefense&&u.defensePost?.corridorId==='north').length,
            south:s.groundUnits.filter(u=>u.autoDefense&&u.defensePost?.corridorId==='south').length};
        }''')
        for key, value in report['attackBefore'].items():
            assert report['attackQueued'][key] == value, (key, report['attackBefore'], report['attackQueued'])
        assert report['attackQueued']['north'] == 14 and report['attackQueued']['south'] == 14
        assert report['attackQueued']['paths'] == 0 and report['attackQueued']['queuedRoutes'] == 12
        report['attackMoving'] = page.evaluate('''()=>{
          const E=skyfront.engine,w=skyfront.getWorld(),s=w.state;
          E.advance(s,.5);w.sync();const attackers=s.groundUnits.filter(u=>u.stance?.mode==='attack');
          return {attackers:attackers.length,withPaths:attackers.filter(u=>u.path.length).length,
            north:s.groundUnits.filter(u=>u.autoDefense&&u.defensePost?.corridorId==='north').length,
            south:s.groundUnits.filter(u=>u.autoDefense&&u.defensePost?.corridorId==='south').length};
        }''')
        assert report['attackMoving'] == {'attackers': 12, 'withPaths': 12, 'north': 14, 'south': 14}, report['attackMoving']
        page.screenshot(path=str(ARTIFACTS / 'defense8112-attack-controls.png'), timeout=120000)

        page.keyboard.press('Escape')
        mog = page.evaluate('''()=>{
          const E=skyfront.engine,w=skyfront.getWorld(),s=w.state;
          const u=E.makeGround(s,0,'mog',90,-1390);u.setup=1;s.groundUnits.push(u);
          w.sync();skyfront.selectArmy([u.id]);
          return {id:u.id,credits:s.sides[0].credits,firstCost:E.upgradeStatus(s,0,u.id).cost};
        }''')
        upgrade = page.locator('[data-upgrade="'+str(mog['id'])+'"]')
        assert upgrade.is_visible()
        upgrade.click()
        page.wait_for_function('skyfront.getState().groundUnits.find(u=>u.id==='+str(mog['id'])+').level===1')
        page.wait_for_function('document.querySelector(\'[data-upgrade="'+str(mog['id'])+'"]\')?.textContent.includes("500")')
        page.locator('#army-controls .army-details summary').click()
        page.wait_for_function('document.querySelector("#army-controls").innerText.includes("Охлаждение / нагрев")')
        report['mogInspector'] = page.locator('#army-controls').inner_text()
        assert 'Охлаждение / нагрев' in report['mogInspector'] and '500' in report['mogInspector']
        assert page.evaluate('skyfront.getState().sides[0].credits') == mog['credits']-mog['firstCost']
        page.screenshot(path=str(ARTIFACTS / 'defense8112-mog-cooling.png'), timeout=120000)
        report['graphics'] = page.evaluate('''()=>{
          const w=skyfront.getWorld(),gl=w.renderer.getContext();
          return {glError:gl.getError(),shaderWarmup:w.shaderWarmupStatus,fortifications:w.fortifications.diagnostics()};
        }''')
        assert report['graphics']['glError'] == 0, report['graphics']
        assert not report['errors'] and not report['consoleErrors'], report
        report['passed'] = True
        print('Offline 8.11.2 physical deployment, continuous trenches, real 30% attack and MOG cooling UI passed', flush=True)
    except Exception as error:
        report['passed'] = False
        report['failure'] = str(error)
        if page:
            with contextlib.suppress(Exception):
                page.screenshot(path=str(ARTIFACTS / 'defense8112-failure.png'), timeout=30000)
        raise
    finally:
        browser.close()
        (ARTIFACTS / 'defense8112-browser.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')

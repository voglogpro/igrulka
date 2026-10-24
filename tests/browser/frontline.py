"""Real rendered fortifications, frontline controls and pause-safe army commands."""
import json
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

report = {'errors': [], 'consoleErrors': []}
with sync_playwright() as p:
    browser = launch_browser(p)
    page = browser.new_page(viewport={'width': 1024, 'height': 768}, offline=True)
    page.set_default_timeout(90000)
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda e: report['consoleErrors'].append(e.text[:2000]) if e.type == 'error' else None)
    page.goto((ROOT / 'play/Skyfront.html').as_uri(), wait_until='load', timeout=120000)
    page.wait_for_function('Boolean(window.skyfront)')
    page.locator('[data-action="start"]').click()
    page.keyboard.press('Space')
    ids = page.evaluate('''()=>{
      const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(8601);
      s.rules.rear=false;s.ai.nextBuild=s.ai.nextAttack=s.ai.nextResearch=s.ai.nextArmy=1e9;
      s.sides[0].credits=30000;s.sides[0].materials=4000;
      for(let i=0;i<8;i++) {
        const u=E.makeGround(s,0,'infantry',-750+i%4*14,-170+Math.floor(i/4)*20);
        s.groundUnits.push(u);E.guardGround(s,0,[u.id],u);
        const t={id:s.nextId++,side:0,x:u.x,z:u.z,yaw:0,progress:1,fortificationWork:i<3?0:i<6?30:90};
        s.trenches.push(t);u.trenchId=t.id;
      }
      E.advance(s,1);
      Object.assign(w.state,s);w.focus(-700,-160,190);w.controls.update(3);w.sync();
      const ids=s.groundUnits.filter(u=>u.side===0).map(u=>u.id);
      skyfront.selectArmy(ids);return ids;
    }''')
    assert not page.evaluate('skyfront.getWorld().frontlineView.enabled')
    page.keyboard.press('Escape')
    page.locator('.frontline-summary').click()
    page.wait_for_function('skyfront.getWorld().frontlineView.report?.sectors.length===2')
    assert page.evaluate('skyfront.getWorld().frontlineView.segments') == 24
    page.evaluate('ids=>skyfront.selectArmy(ids)', ids)
    page.evaluate('ids=>skyfront.command("auto-defense",{ids,enabled:true})',ids)
    page.wait_for_function('skyfront.getState().groundUnits.filter(u=>u.side===0).every(u=>u.autoDefense)')
    assert page.evaluate('skyfront.isPaused()')
    assert page.evaluate('skyfront.engine.frontlineReport(skyfront.getState(),0).counts.reserves') == 8
    page.locator('.army-details summary').click()
    assert 'Защита позиции' in page.locator('#army-detail-text').inner_text()
    page.locator('.army-details summary').click()
    page.keyboard.press('Escape')
    page.locator('.frontline-open').click()
    assert page.locator('[data-front-sector]').count() == 2
    for selector in ['#frontline-hud', '.frontline-detail']:
        box = page.locator(selector).bounding_box()
        assert box and box['x'] >= 0 and box['y'] >= 0 and box['x']+box['width']<=1024 and box['y']+box['height']<=768, (selector,box)
    assert page.evaluate('''()=>{const r=document.querySelector('.frontline-detail').getBoundingClientRect();return Boolean(document.elementFromPoint(r.right-12,r.bottom-12)?.closest('#frontline-hud'));}'''), 'construction dock must not cover the open front report'
    page.locator('.frontline-summary').click()
    assert not page.evaluate('skyfront.getWorld().frontlineView.solid.visible')
    page.locator('.frontline-summary').click()
    assert page.evaluate('skyfront.getWorld().frontlineView.solid.visible')
    page.locator('.frontline-open').click()
    page.screenshot(path=str(ARTIFACTS/'frontline89-positions-close.png'),timeout=120000)
    page.locator('[data-front-sector="north"]').click()
    page.evaluate('skyfront.getWorld().controls.update(3)')
    page.screenshot(path=str(ARTIFACTS/'frontline89-fortifications.png'),timeout=120000)
    report['rendering'] = page.evaluate('''()=>({fortifications:skyfront.getWorld().fortifications.diagnostics(),frontline:skyfront.getWorld().frontlineView.diagnostics(),calls:skyfront.getWorld().renderer.info.render.calls})''')
    assert report['rendering']['fortifications']['stages'] == [8,5,2], report
    page.evaluate('ids=>skyfront.selectArmy(ids)', ids)
    page.locator('[data-troop="stop"]').click()
    page.wait_for_function('skyfront.getState().groundUnits.filter(u=>u.side===0).every(u=>!u.autoDefense&&!u.defenseTask)')
    assert page.evaluate('skyfront.engine.frontlineReport(skyfront.getState(),0).counts.reserves') == 0
    page.keyboard.press('Escape')
    page.evaluate('''()=>{
      const E=skyfront.engine,s=skyfront.getWorld().state;
      for(const [key,x,z] of [['barracks',-1080,-10],['vehiclebase',-960,-80],['factory',-1080,-80],['launcher',-940,160]]){
        const b=E.build(s,0,key,x,z);if(typeof b==='string')throw Error(b);b.progress=1;b.hp=b.maxHp;
        if(key==='launcher')Object.assign(E.initLaunchStore(b),{drone:4,heavy:2});
      }
      s.sides[0].inventory.drone=0;s.sides[0].inventory.heavy=0;
      skyfront.getWorld().sync();skyfront.openPanel('army',true);
    }''')
    page.locator('[data-army-target="infantry"]').fill('6')
    page.locator('[data-army-target="infantry"]').press('Tab')
    page.wait_for_function('skyfront.getState().sides[0].armyComposition.targets.infantry===6')
    report['composition'] = page.evaluate('''()=>{
      const E=skyfront.engine,s=skyfront.getWorld().state;
      E.advance(s,.1);
      const queued=()=>s.buildings.reduce((n,b)=>n+(b.armyQueue?.filter(q=>q.key==='infantry').length||0),0);
      const before=queued();
      const own=s.groundUnits.filter(u=>u.side===0&&u.key==='infantry');
      for(let i=0;i<own.length;i++)own[i].hp=i<5?own[i].maxHp:0;
      E.advance(s,4.1);
      return {before,replaced:queued(),target:s.sides[0].armyComposition.targets.infantry};
    }''')
    assert report['composition']=={'before':0,'replaced':1,'target':6},report['composition']
    page.locator('[data-army-target="infantry"]').fill('0')
    page.locator('[data-army-target="infantry"]').press('Tab')
    page.wait_for_function('!skyfront.getState().sides[0].armyComposition.targets.infantry')
    page.locator('[data-army-category="vehicles"]').click()
    assert page.locator('[data-army-target="leopard"]').is_visible()
    assert page.locator('[data-research]').count()==0
    page.screenshot(path=str(ARTIFACTS/'composition89-live.png'),timeout=120000)
    page.keyboard.press('Escape')
    page.evaluate('''()=>{skyfront.armStrike('drone');const w=skyfront.getWorld();w.focus(900,100,300);w.controls.update(3);w.scene.updateMatrixWorld(true);}''')
    print('Actual army composition goal, paid casualty replacement and retired research UI passed',flush=True)
    def point(x,z):
        return page.evaluate('''p=>{const w=skyfront.getWorld(),v=w.camera.position.clone().set(p.x,0,p.z).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''',{'x':x,'z':z})
    page.locator('[data-action="route"]').click()
    waypoint=point(890,100)
    page.mouse.click(waypoint['x'],waypoint['y'])
    assert len(page.evaluate('skyfront.getOrder().waypoints'))==1, page.evaluate('p=>({point:p,element:document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,180),order:skyfront.getOrder(),aiming:skyfront.getWorld().aiming})',waypoint)
    page.locator('[data-action="route"]').click()
    target=point(910,130)
    page.mouse.move(target['x'],target['y'])
    page.screenshot(path=str(ARTIFACTS/'strike89-live-route.png'),timeout=120000)
    page.mouse.click(target['x'],target['y'])
    page.wait_for_function('skyfront.engine.weaponStock(skyfront.getState(),0,"drone")===3')
    page.locator('#quick-weapons [data-weapon="heavy"]').click()
    page.mouse.click(target['x']+15,target['y'])
    page.wait_for_function('skyfront.engine.weaponStock(skyfront.getState(),0,"heavy")===1')
    assert page.evaluate('skyfront.getWorld().aiming')
    page.mouse.click(target['x'],target['y'],button='right')
    assert not page.evaluate('skyfront.getWorld().aiming')
    report['compositionAndStrike']='actual composition goal, paid casualty replacement, route point, click launch, quick heavy switch, right-click cancellation'
    assert not report['errors'] and not report['consoleErrors'], report
    browser.close()
(ARTIFACTS/'frontline89-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False),flush=True)

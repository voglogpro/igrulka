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
        const u=E.makeGround(s,0,'infantry',-350+i%4*14,-170+Math.floor(i/4)*20);
        s.groundUnits.push(u);E.guardGround(s,0,[u.id],u);
        const t={id:s.nextId++,side:0,x:u.x,z:u.z,yaw:0,progress:1,fortificationWork:i<3?0:i<6?30:90};
        s.trenches.push(t);u.trenchId=t.id;
      }
      E.advance(s,1);
      Object.assign(w.state,s);w.focus(-300,-160,190);w.controls.update(3);w.sync();
      const ids=s.groundUnits.filter(u=>u.side===0).map(u=>u.id);
      skyfront.selectArmy(ids);return ids;
    }''')
    page.wait_for_function('skyfront.getWorld().frontlineView.report?.sectors.length===5')
    page.wait_for_function('document.querySelector("#army-controls [data-action=auto-defense]")&&!document.querySelector("#army-controls [data-action=auto-defense]").disabled')
    page.locator('[data-action="auto-defense"]').click()
    page.wait_for_function('skyfront.getState().groundUnits.filter(u=>u.side===0).every(u=>u.autoDefense)')
    assert page.evaluate('skyfront.isPaused()')
    assert page.evaluate('skyfront.engine.frontlineReport(skyfront.getState(),0).counts.reserves') == 8
    page.locator('.army-details summary').click()
    assert 'Защита позиции' in page.locator('#army-detail-text').inner_text()
    page.locator('.army-details summary').click()
    page.keyboard.press('Escape')
    page.locator('.frontline-summary').click()
    assert page.locator('[data-front-sector]').count() == 5
    for selector in ['#frontline-hud', '.frontline-detail']:
        box = page.locator(selector).bounding_box()
        assert box and box['x'] >= 0 and box['y'] >= 0 and box['x']+box['width']<=1024 and box['y']+box['height']<=768, (selector,box)
    page.locator('#frontline-hud input').uncheck()
    assert not page.evaluate('skyfront.getWorld().frontlineView.solid.visible')
    page.locator('#frontline-hud input').check()
    assert page.evaluate('skyfront.getWorld().frontlineView.solid.visible')
    page.screenshot(path=str(ARTIFACTS/'frontline86-positions-close.png'),timeout=120000)
    page.locator('[data-front-sector="north"]').click()
    page.evaluate('skyfront.getWorld().controls.update(3)')
    page.screenshot(path=str(ARTIFACTS/'frontline86-fortifications.png'),timeout=120000)
    report['rendering'] = page.evaluate('''()=>({fortifications:skyfront.getWorld().fortifications.diagnostics(),frontline:skyfront.getWorld().frontlineView.diagnostics(),calls:skyfront.getWorld().renderer.info.render.calls})''')
    assert report['rendering']['fortifications']['stages'] == [8,5,2], report
    page.evaluate('ids=>skyfront.selectArmy(ids)', ids)
    page.locator('[data-troop="stop"]').click()
    page.wait_for_function('skyfront.getState().groundUnits.filter(u=>u.side===0).every(u=>!u.autoDefense&&!u.defenseTask)')
    assert page.evaluate('skyfront.engine.frontlineReport(skyfront.getState(),0).counts.reserves') == 0
    page.keyboard.press('Escape')
    page.evaluate('''()=>{
      const E=skyfront.engine,s=skyfront.getWorld().state;
      const lab=E.build(s,0,'lab',-680,-10);
      if(typeof lab==='string')throw Error(lab);
      lab.progress=1;lab.hp=lab.maxHp;s.sides[0].science=2000;
      const site=E.build(s,0,'launcher',-540,160);
      if(typeof site==='string')throw Error(site);
      site.progress=1;site.hp=site.maxHp;
      s.sides[0].inventory.drone=4;s.sides[0].inventory.heavy=2;
      skyfront.getWorld().sync();skyfront.openPanel('research',true);
    }''')
    page.locator('[data-research="lightArmor"]').click()
    page.wait_for_function('skyfront.getState().sides[0].research?.key==="lightArmor"')
    page.locator('[data-research-filter="aviation"]').click()
    assert page.locator('[data-research-branch="army"]').is_hidden()
    assert page.locator('[data-research-branch="aviation"]').is_visible()
    box=page.locator('#panel').bounding_box()
    assert box and box['x']>=0 and box['x']+box['width']<=1024 and box['y']+box['height']<=768,box
    page.screenshot(path=str(ARTIFACTS/'research86-live.png'),timeout=120000)
    page.keyboard.press('Escape')
    page.evaluate('''()=>{skyfront.getWorld().state.sides[0].tech=Object.keys(skyfront.engine.TECH);skyfront.armStrike('drone');const w=skyfront.getWorld();w.focus(500,100,300);w.controls.update(3);w.scene.updateMatrixWorld(true);}''')
    def point(x,z):
        return page.evaluate('''p=>{const w=skyfront.getWorld(),v=w.camera.position.clone().set(p.x,0,p.z).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''',{'x':x,'z':z})
    page.locator('[data-action="route"]').click()
    waypoint=point(490,100)
    page.mouse.click(waypoint['x'],waypoint['y'])
    assert len(page.evaluate('skyfront.getOrder().waypoints'))==1, page.evaluate('p=>({point:p,element:document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,180),order:skyfront.getOrder(),aiming:skyfront.getWorld().aiming})',waypoint)
    page.locator('[data-action="route"]').click()
    target=point(510,130)
    page.mouse.move(target['x'],target['y'])
    page.screenshot(path=str(ARTIFACTS/'strike86-live-route.png'),timeout=120000)
    page.mouse.click(target['x'],target['y'])
    page.wait_for_function('skyfront.getState().sides[0].inventory.drone===3')
    page.locator('#quick-weapons [data-weapon="heavy"]').click()
    page.mouse.click(target['x']+15,target['y'])
    page.wait_for_function('skyfront.getState().sides[0].inventory.heavy===1')
    assert page.evaluate('skyfront.getWorld().aiming')
    page.mouse.click(target['x'],target['y'],button='right')
    assert not page.evaluate('skyfront.getWorld().aiming')
    report['researchAndStrike']='actual research, branch filter, route point, click launch, quick heavy switch, right-click cancellation'
    assert not report['errors'] and not report['consoleErrors'], report
    browser.close()
(ARTIFACTS/'frontline86-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False),flush=True)

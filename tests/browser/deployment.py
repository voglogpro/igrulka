"""Real clicks: pay only at destination, queued waves, squad cards, cancelling, AT and persistence."""
import json
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

report = {'errors': [], 'consoleErrors': []}
with sync_playwright() as p:
    browser = launch_browser(p)
    page = browser.new_page(viewport={'width':1024,'height':768},offline=True)
    page.set_default_timeout(90000)
    page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.on('console',lambda e:report['consoleErrors'].append(e.text[:1500]) if e.type=='error' else None)
    page.goto((ROOT/'play/Skyfront.html').as_uri(),wait_until='load',timeout=120000)
    page.wait_for_function('Boolean(window.skyfront)')
    page.locator('[data-action="start"]').click();page.keyboard.press('Space')
    fixture=page.evaluate('''()=>{
      const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(830);s.rules.rear=false;
      s.ai.nextBuild=s.ai.nextAttack=s.ai.nextResearch=s.ai.nextArmy=1e9;
      for(const f of s.sides){f.credits=50000;f.materials=5000;f.tech=Object.keys(E.TECH);}
      const b=E.build(s,0,'barracks',-680,-10);if(typeof b==='string')throw Error(b);b.progress=1;b.hp=b.maxHp;
      Object.assign(w.state,s);w.previousSimTime=s.time;w.focus(-495,-70,320);w.controls.update(3);w.sync();w.scene.updateMatrixWorld(true);
      return {site:b.id,credits:s.sides[0].credits,unitCost:E.GROUND_UNITS.infantry.cost};
    }''')
    def pt(x,z):
        return page.evaluate('''p=>{const w=skyfront.getWorld(),v=w.camera.position.clone().set(p.x,0,p.z).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''',{'x':x,'z':z})
    page.keyboard.press('b');page.locator('[data-recruit-count="5"]').click()
    page.locator('#panel [data-recruit="infantry"]').click()
    assert page.locator('#panel').is_hidden()
    assert page.locator('#deployment-hud').is_visible()
    assert page.evaluate('skyfront.getState().sides[0].credits')==fixture['credits']
    a=pt(-430,-100);page.mouse.move(a['x'],a['y'])
    page.wait_for_function('skyfront.getWorld().deploymentPreview.root.visible && skyfront.getWorld().deploymentPreview.line.geometry.drawRange.count>1')
    page.screenshot(path=str(ARTIFACTS/'83-deployment-preview.png'),timeout=120000)
    page.mouse.click(a['x'],a['y'])
    page.wait_for_function('skyfront.getState().buildings.find(b=>b.key==="barracks").armyQueue.length===5')
    assert page.evaluate('skyfront.getState().sides[0].credits')==fixture['credits']-5*fixture['unitCost']
    assert not page.evaluate('skyfront.getState().groundUnits.length')
    # Change the paid batch size while keeping the placement tool active.
    page.locator('[data-deploy-count="1"]').click()
    b=pt(-480,-175);page.mouse.click(b['x'],b['y'])
    page.wait_for_function('skyfront.getState().buildings.find(b=>b.key==="barracks").armyQueue.length===6')
    goals=page.evaluate('skyfront.getState().buildings.find(b=>b.key==="barracks").armyQueue.map(q=>({id:q.squadId,x:q.destination.x,z:q.destination.z}))')
    assert goals[0]['id']!=goals[-1]['id']
    assert abs(goals[0]['x']+430)<2 and abs(goals[-1]['x']+480)<2
    # Right click releases the tool without cancelling an already paid queue.
    page.mouse.click(b['x'],b['y'],button='right')
    assert page.locator('#deployment-hud').is_hidden()
    assert page.evaluate('skyfront.getWorld().groundTargeting') is None
    assert page.evaluate('skyfront.getState().buildings.find(b=>b.key==="barracks").armyQueue.length')==6
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,4.2)')
    page.wait_for_function('document.querySelector("[data-squad]:not(:disabled)")')
    field=page.evaluate('skyfront.getState().groundUnits')
    assert field and all(u['x']<-550 for u in field), 'Units must walk out from barracks; no teleport to destination'
    page.locator('[data-squad]:not(:disabled)').first.click()
    assert page.locator('#army-controls').is_visible()
    assert not page.locator('#groups-bar [data-group]').count()
    c=pt(-380,-150);page.mouse.click(c['x'],c['y'],button='right')
    redirected=page.evaluate('skyfront.getState().buildings.find(b=>b.key==="barracks").armyQueue.filter(q=>q.squadId==='+str(goals[0]['id'])+').map(q=>q.destination)')
    assert redirected and all(abs(q['x']+380)<3 for q in redirected)
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,35)')
    page.wait_for_function('skyfront.getState().groundUnits.length===6')
    all_units=page.evaluate('skyfront.getState().groundUnits')
    first=[u for u in all_units if u['squadId']==goals[0]['id']]
    assert len(first)==5
    assert len(set((round(u['x']),round(u['z'])) for u in first))==5
    assert all(abs(u['x']+380)<30 and abs(u['z']+150)<30 for u in first)
    # Select the entire automatically formed wave with a single card.
    page.locator('[data-squad="'+str(goals[0]['id'])+'"]').click()
    assert len(page.evaluate('skyfront.getOrder().armySelection'))==5
    page.screenshot(path=str(ARTIFACTS/'83-squad-controls.png'),timeout=120000)
    page.keyboard.press('Escape');page.keyboard.press('b')
    assert page.locator('[data-recruit="atgm"]').is_visible()
    page.locator('[data-recruit="atgm"]').click()
    page.locator('#deployment-key').select_option('tankdestroyer')
    assert page.locator('#deployment-hud').is_visible()
    assert page.locator('#deployment-key').input_value()=='tankdestroyer'
    d=pt(-460,-210);page.mouse.click(d['x'],d['y'])
    assert page.evaluate('skyfront.getState().buildings.find(b=>b.key==="barracks").armyQueue.at(-1).key')=='tankdestroyer'
    page.keyboard.press('Escape');page.evaluate('skyfront.save()')
    before=page.evaluate('skyfront.getState().buildings.find(b=>b.key==="barracks").armyQueue')
    page.reload(wait_until='load',timeout=120000);page.wait_for_function('Boolean(window.skyfront)')
    assert page.evaluate('skyfront.getState().buildings.find(b=>b.key==="barracks").armyQueue')==before
    page.locator('[data-action="start"]').click();page.keyboard.press('Space')
    page.evaluate('''()=>{const w=skyfront.getWorld(),E=skyfront.engine,s=w.state;s.groundUnits=[];for(const [key,x,z] of [['atgm',-448,-112],['tankdestroyer',-425,-115],['leopard',-445,-88],['mog',-464,-100]]){const u=E.makeGround(s,0,key,x,z);u.setup=1;s.groundUnits.push(u);}w.focus(-440,-101,100);w.controls.update(3);w.sync();w.scene.updateMatrixWorld(true);w.post.render(w.scene,w.camera,w.elapsed);}''')
    page.screenshot(path=str(ARTIFACTS/'83-anti-tank-models.png'),timeout=120000)
    assert not report['errors'] and not report['consoleErrors'],report
    report.update({'queueGoals':goals,'units':all_units,'diagnostics':page.evaluate('skyfront.diagnostics()')})
    (ARTIFACTS/'deployment83-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print('Real recruitment destination clicks, x1/x5, path preview, non-teleporting spawn, squad selection, pending redirects, AT switching and save/load passed',flush=True)
    browser.close()

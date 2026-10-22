import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from support import ROOT as root, ARTIFACTS, launch_browser
report={'errors':[],'consoleErrors':[]}
with sync_playwright() as p:
    browser=launch_browser(p)
    context=browser.new_context(offline=True,viewport={'width':1280,'height':800},device_scale_factor=1)
    page=context.new_page();page.set_default_timeout(60000)
    page.on('pageerror',lambda e:(report['errors'].append(str(e)),print('PAGE ERROR '+str(e),flush=True)))
    page.on('console',lambda e:report['consoleErrors'].append(e.text[:2000]) if e.type=='error' else None)
    page.goto(((root/'play/Skyfront.html')).as_uri(),wait_until='load',timeout=120000);page.wait_for_function('Boolean(window.skyfront)',timeout=60000)
    page.locator('[data-action="start"]').click();page.keyboard.press('Space')
    fixture=page.evaluate('''()=>{
      const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(815);s.ai.nextBuild=s.ai.nextAttack=s.ai.nextResearch=s.ai.nextArmy=1e9;
      for(const f of s.sides){f.credits=30000;f.materials=3000;f.science=3000;f.tech=Object.keys(E.TECH);}
      for(const [key,x,z]of [['power',-670,-80],['housing',-615,-80],['barracks',-680,-10],['gun',-390,100],['sam',-450,120],['launcher',-400,-180]]){const b=E.build(s,0,key,x,z);if(typeof b==='string')throw Error(b);b.hp=b.maxHp;b.progress=1;}
      const keys=['infantry','infantry','machinegunner','sniper','engineer','operator','assault','mog','apc','gepard','shilka','leopard'];
      const units=keys.map((key,i)=>{const u=E.makeGround(s,0,key,-510+(i%6)*18,-100+Math.floor(i/6)*34);u.setup=1;s.groundUnits.push(u);return {id:u.id,key,x:u.x,z:u.z};});
      Object.assign(w.state,s);w.previousSimTime=s.time;w.controls.focus(-465,-65,250);w.controls.update(3);w.sync();w.scene.updateMatrixWorld(true);w.post.render(w.scene,w.camera,w.elapsed);
      return {units,barracks:s.buildings.find(b=>b.key==='barracks').id,gun:s.buildings.find(b=>b.key==='gun').id};
    }''')
    print('All infantry roles, MOG and vehicles render',flush=True)
    def pt(x,z,y=2):
        return page.evaluate('''p=>{const w=skyfront.getWorld(),v=w.camera.position.clone().set(p.x,p.y,p.z).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''',{'x':x,'z':z,'y':y})
    points=[pt(u['x'],u['z']) for u in fixture['units'][:2]]
    x1=min(p['x'] for p in points)-9;x2=max(p['x'] for p in points)+9;y1=min(p['y'] for p in points)-10;y2=max(p['y'] for p in points)+10
    page.mouse.move(x1,y1);page.mouse.down();page.mouse.move(x2,y2,steps=7);page.mouse.up()
    assert len(page.evaluate('skyfront.getOrder().armySelection'))>=2
    selection=page.evaluate('skyfront.getOrder().armySelection')
    page.keyboard.press('Control+1');page.keyboard.press('Escape');assert not page.evaluate('skyfront.getOrder().armySelection');page.keyboard.press('1')
    assert page.evaluate('skyfront.getOrder().armySelection')==selection
    assert page.evaluate('skyfront.getWorld().buildKey') is None
    target=pt(-450,-170);page.mouse.click(target['x'],target['y'],button='right');assert page.evaluate('skyfront.getState().groundUnits.filter(u=>u.path.length).length')>=2
    assert page.evaluate('skyfront.getOrder().armySelection')==selection
    page.locator('[data-troop="stop"]').click();page.locator('[data-troop="dig"]').click()
    assert page.evaluate('skyfront.getState().trenches.length')>=2
    page.evaluate('''()=>{const w=skyfront.getWorld();skyfront.engine.advance(w.state,13);w.sync();}''')
    assert page.evaluate('skyfront.getState().trenches.every(t=>t.progress===1)')
    page.locator('[data-troop="camo"]').click();assert page.evaluate('skyfront.getState().groundUnits.filter(u=>u.camouflaged).length')>=2
    page.locator('[data-troop="fire"]').click();assert page.evaluate('skyfront.getState().groundUnits.filter(u=>u.holdFire).length')>=2
    page.screenshot(path=str((ARTIFACTS/'infantry8-soldiers.png')),timeout=120000)
    print('Real rectangle selection, saved keyboard group, movement, entrenching, camouflage and fire control passed',flush=True)
    apc=next(u for u in fixture['units'] if u['key']=='apc')
    page.evaluate('''ids=>{const w=skyfront.getWorld(),s=w.state;for(const id of ids){const u=s.groundUnits.find(u=>u.id===id);u.x=-450;u.z=-40;u.digging=false;u.trenchId=null;}w.controls.focus(-450,-40,250);w.controls.update(3);w.sync();w.scene.updateMatrixWorld(true);}''',[selection[0],apc['id']])
    page.evaluate('(id)=>skyfront.selectArmy([id])',selection[0]);page.locator('[data-troop="board"]').click();point=pt(-450,-40);page.mouse.click(point['x'],point['y'])
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,1)')
    assert page.evaluate('(id)=>skyfront.getState().groundUnits.find(u=>u.id===id).carrierId',selection[0])==apc['id']
    page.wait_for_function('(id)=>skyfront.getOrder().armySelection.includes(id)',arg=apc['id'])
    assert page.locator('[data-troop="unload"]').is_enabled()
    page.locator('[data-troop="unload"]').click()
    assert page.evaluate('(id)=>skyfront.getState().groundUnits.find(u=>u.id===id).carrierId',selection[0]) is None
    operator=next(u for u in fixture['units'] if u['key']=='operator')
    page.evaluate('(id)=>skyfront.selectArmy([id])',operator['id']);page.locator('[data-troop="fpv"]').click()
    assert page.locator('#district-strip').is_hidden(), 'District cards must release the map during FPV targeting'
    point=pt(-300,-100);page.mouse.move(point['x'],point['y']);page.mouse.click(point['x'],point['y'])
    if not page.evaluate('skyfront.getState().units.some(u=>u.subtype==="fpv")'):
        report['fpvDebug']=page.evaluate('''p=>({point:p,element:document.elementFromPoint(p.x,p.y)?.outerHTML,order:skyfront.getOrder(),notice:document.querySelector('#notice').textContent,operator:skyfront.getState().groundUnits.find(u=>u.key==='operator')})''',point)
        page.screenshot(path=str(ARTIFACTS/'infantry-fpv-failure.png'),timeout=120000)
        print(json.dumps(report,ensure_ascii=True),flush=True)
    assert page.evaluate('skyfront.getState().units.some(u=>u.subtype==="fpv")')
    page.evaluate('''()=>{const w=skyfront.getWorld();skyfront.engine.advance(w.state,.5);w.sync();w.post.render(w.scene,w.camera,w.elapsed);}''')
    print('Real transport boarding/unloading and operator FPV launch passed',flush=True)
    page.evaluate('(id)=>skyfront.select(id)',fixture['gun']);page.locator('[data-redeploy]').click()
    assert page.evaluate('skyfront.getState().buildings.find(b=>b.id==='+str(fixture['gun'])+').demolished')
    page.locator('[data-tab="military"]').click();assert page.locator('[data-build="cannon"]').count()==0
    page.evaluate('''()=>{const w=skyfront.getWorld();w.focus(-450,-100,320);w.controls.update(3);w.scene.updateMatrixWorld(true);}''')
    page.keyboard.press('b');page.locator('[data-recruit-count="5"]').click();page.locator('#panel [data-recruit="infantry"]').click()
    assert page.locator('#panel').is_hidden()
    assert page.locator('#deployment-hud').is_visible()
    point=pt(-400,-160)
    assert page.evaluate('p=>document.elementFromPoint(p.x,p.y)===skyfront.getWorld().renderer.domElement',point),point
    page.mouse.click(point['x'],point['y'])
    if not page.evaluate('skyfront.getState().buildings.find(b=>b.key==="barracks").armyQueue?.length'):
        print(json.dumps(page.evaluate('''p=>({point:p,element:document.elementFromPoint(p.x,p.y)?.outerHTML,order:skyfront.getOrder(),notice:document.querySelector('#notice').textContent,plan:skyfront.engine.deploymentPlan(skyfront.getWorld().state,0,'infantry',{x:-400,z:-160},5)})''',point),ensure_ascii=True),flush=True)
    assert page.evaluate('skyfront.getState().buildings.find(b=>b.key==="barracks").armyQueue.length')==5
    page.keyboard.press('Escape');page.keyboard.press('b')
    page.locator('#panel [data-rally="auto"]').click();point=pt(-400,-160);page.mouse.click(point['x'],point['y'])
    assert page.evaluate('Boolean(skyfront.getState().buildings.find(b=>b.key==="barracks").rally)')
    page.evaluate('skyfront.save()');before=page.evaluate('({units:skyfront.getState().groundUnits.length,trenches:skyfront.getState().trenches.length,group:skyfront.engine.getGroup(skyfront.getState(),0,1)})')
    page.reload(wait_until='load',timeout=120000);page.wait_for_function('Boolean(window.skyfront)',timeout=60000)
    assert page.evaluate('skyfront.getState().groundUnits.length')==before['units'];assert page.evaluate('skyfront.getState().trenches.length')==before['trenches'];assert page.evaluate('skyfront.engine.getGroup(skyfront.getState(),0,1)')==before['group']
    assert not report['errors'] and not report['consoleErrors'],report
    report['fixture']=fixture;report['saved']=before;report['diagnostics']=page.evaluate('skyfront.diagnostics()')
    ((ARTIFACTS/'infantry8-report.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Recruitment x5, rally, cannon removal, MOG packing and complete persistence passed; no JS/shader errors',flush=True)
    browser.close()

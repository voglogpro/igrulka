import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from support import ROOT as root, ARTIFACTS, launch_browser
report={'errors':[],'consoleErrors':[]}
with sync_playwright() as p:
    browser=launch_browser(p)
    context=browser.new_context(offline=True,viewport={'width':1152,'height':768},device_scale_factor=1)
    page=context.new_page();page.set_default_timeout(60000)
    page.on('pageerror',lambda e:(report['errors'].append(str(e)),print(str(e),flush=True)))
    page.on('console',lambda e:report['consoleErrors'].append(e.text[:2000]) if e.type=='error' else None)
    url=((root/'play/Skyfront.html')).as_uri();page.goto(url,wait_until='load',timeout=120000);page.wait_for_function('Boolean(window.skyfront)',timeout=60000)
    old=page.evaluate('''()=>{const E=skyfront.engine,s=E.createGame(817);s.version=7;s.time=90;s.sides[0].credits=1700;const u=E.makeGround(s,0,'infantry',-480,-70);u.hp=55;u.maxHp=110;s.groundUnits.push(u);s.buildings.push({id:s.nextId++,side:0,key:'cannon',x:-450,z:0,hp:140,maxHp:280,progress:1,rotation:0,cooldown:0});delete s.groups;delete s.contacts;delete s.trenches;delete s.formations;return E.save(s);}''')
    page.evaluate('raw=>localStorage.setItem("skyfront-realtime-v3",raw)',old)
    page.reload(wait_until='load',timeout=120000);page.wait_for_function('Boolean(window.skyfront)',timeout=60000)
    assert '8.5.0' in page.title();assert page.evaluate('skyfront.getState().version')==11
    assert page.evaluate('skyfront.getState().groundUnits.length')==5
    assert page.evaluate('skyfront.getState().sides[0].credits')==2000
    assert page.evaluate('skyfront.getState().sides[0].materials')==218
    assert page.evaluate('localStorage.getItem("skyfront-realtime-v3-before-infantry8")')==old
    page.locator('[data-action="start"]').click();page.keyboard.press('Space')
    gun=page.evaluate('skyfront.getState().buildings.find(b=>b.key==="gun").id')
    page.evaluate('''id=>{const w=skyfront.getWorld();w.controls.focus(-450,0,120);w.controls.rotate(0,-100);w.controls.update(3);skyfront.select(id);w.sync();w.post.render(w.scene,w.camera,w.elapsed);}''',gun)
    page.screenshot(path=str((ARTIFACTS/'infantry8-mog-close.png')),timeout=120000)
    page.locator('[data-redeploy]').click()
    packed=page.evaluate('''()=>{const w=skyfront.getWorld();w.sync();const u=w.state.groundUnits.find(u=>u.key==='mog');return {id:u.id,visible:w.groundModels.get(u.id).userData.fieldPosition.visible};}''')
    assert not packed['visible']
    assert page.evaluate('''()=>{const w=skyfront.getWorld();skyfront.engine.advance(w.state,3.1);w.sync();const u=w.state.groundUnits.find(u=>u.key==='mog');return w.groundModels.get(u.id).userData.fieldPosition.visible;}''')
    page.mouse.move(550,350);page.mouse.wheel(0,-100);page.mouse.wheel(0,-100);page.wait_for_function('skyfront.getWorld().controls.distance<101',timeout=60000)
    assert page.evaluate('skyfront.diagnostics().camera.height')>45
    selection=page.evaluate('skyfront.getOrder().armySelection');yaw=page.evaluate('skyfront.diagnostics().camera.yaw')
    page.mouse.move(520,350);page.mouse.down(button='right');page.mouse.move(550,350,steps=3);page.mouse.up(button='right')
    assert page.evaluate('skyfront.getOrder().armySelection')==selection
    assert page.evaluate('skyfront.diagnostics().camera.yaw')!=yaw
    print('V7 migration, exact refund and backup, MOG packing/deployment, close zoom and right-drag rotation passed',flush=True)
    page.locator('[data-panel="settings"]').click();page.locator('#panel [data-action="new-confirm"]').click();page.locator('#panel [data-action="new"]').click()
    page.wait_for_function('window.skyfront && skyfront.getState().time===0',timeout=120000)
    assert page.evaluate('skyfront.getState().groundUnits.length')==0
    assert page.evaluate('skyfront.getState().trenches.length')==0
    assert page.evaluate('JSON.stringify(skyfront.getState().groups)')=='[{},{}]'
    page.reload(wait_until='load',timeout=120000);page.wait_for_function('Boolean(window.skyfront)',timeout=60000)
    assert page.evaluate('skyfront.getState().time')==0
    assert page.evaluate('skyfront.getState().sides[0].credits')==3200
    assert not report['errors'] and not report['consoleErrors'],report
    report.update({'migration':True,'refund':300,'metalRefund':18,'legacyIndividuals':5,'packedVisual':True,'closeZoom':100,'resetPersisted':True})
    ((ARTIFACTS/'migration8-report.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Fresh restart clears troops, trenches and groups and survives another reload without JS/shader errors',flush=True)
    browser.close()

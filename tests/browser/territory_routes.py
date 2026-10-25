import json
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

report = {'errors': [], 'consoleErrors': []}
with sync_playwright() as p:
    browser = launch_browser(p)
    page = browser.new_page(viewport={'width': 1024, 'height': 768}, offline=True)
    page.set_default_timeout(90000)
    page.on('pageerror', lambda e: (report['errors'].append(str(e)), print(str(e), flush=True)))
    page.on('console', lambda e: report['consoleErrors'].append(e.text[:2000]) if e.type == 'error' else None)
    page.goto((ROOT/'play/Skyfront.html').as_uri(), wait_until='load', timeout=120000)
    page.wait_for_function('Boolean(window.skyfront)')
    old = page.evaluate("()=>{const E=skyfront.engine,s=E.createGame(82);s.version=8;delete s.districts;s.time=60;s.sides[0].credits=1234;const u=E.makeGround(s,0,'infantry',-480,-70);s.groundUnits.push(u);return E.save(s);}")
    page.evaluate('raw=>localStorage.setItem("skyfront-realtime-v3",raw)', old)
    page.reload(wait_until='load', timeout=120000)
    page.wait_for_function('Boolean(window.skyfront)')
    assert page.evaluate('skyfront.getState().version === skyfront.engine.VERSION')
    assert page.evaluate('skyfront.getState().groundUnits.length') == 1
    assert page.evaluate('skyfront.getState().sides[0].credits') == 1234
    assert page.evaluate('skyfront.getState().time') == 60
    assert page.evaluate('localStorage.getItem("skyfront-realtime-v3-before-districts9")') == old
    assert page.locator('#district-strip').is_hidden()
    page.locator('[data-action="start"]').click()
    page.keyboard.press('Space')

    def point(x, z, y=0):
        return page.evaluate('''p=>{const w=skyfront.getWorld();w.controls.update(3);w.scene.updateMatrixWorld(true);const v=w.camera.position.clone().set(p.x,p.y,p.z).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''', {'x':x,'z':z,'y':y})

    ids = page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(822);s.ai.nextBuild=s.ai.nextAttack=s.ai.nextResearch=s.ai.nextArmy=1e9;s.sides[0].credits=10000;s.sides[0].materials=1000;const d=E.DISTRICTS[0],u=E.makeGround(s,0,'infantry',d.x-55,d.z);u.holdFire=true;s.groundUnits.push(u);Object.assign(w.state,s);w.focus(d.x,d.z,240);w.controls.update(3);w.sync();skyfront.selectArmy([u.id]);return{unit:u.id,district:d.id};}''')
    page.wait_for_function('!document.querySelector("#district-strip").hidden')
    cards = page.locator('.district-card')
    assert cards.count() == 2
    assert page.evaluate('skyfront.engine.DISTRICTS.map(d=>d.id)') == ['north-depot','south-depot']
    strip = page.locator('#district-strip').bounding_box()
    groups = page.locator('#groups-bar').bounding_box()
    assert strip['x'] >= groups['x'] + groups['width'] + 4
    assert strip['x'] + strip['width'] <= 1024
    assert strip['height'] < 70
    page.locator(f'[data-district-order="{ids["district"]}"]').click()
    page.wait_for_function('skyfront.getState().groundUnits[0].guard!==null')
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,40);skyfront.getWorld().sync()')
    page.wait_for_function('document.querySelector(".district-card").dataset.owner==="own"')
    assert page.evaluate('skyfront.getState().districts[0].owner') == 0
    assert page.evaluate('skyfront.engine.economy(skyfront.getWorld().state,0).districts.active') == 1
    assert page.evaluate('skyfront.getWorld().districtView.sites.get("north-depot").body.visible')
    page.screenshot(path=str(ARTIFACTS/'districts-capture-1024.png'), timeout=120000)
    print('Version 8 migration preserves troops, resources and backup; compact district control captures a real site', flush=True)

    page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),d=E.DISTRICTS[0];E.applyBlast(w.state,d.x,d.z,10000,18);w.sync();}''')
    page.wait_for_function('!document.querySelector("[data-district-repair=north-depot]").hidden')
    assert page.evaluate('skyfront.getWorld().districtView.sites.get("north-depot").ruins.visible')
    assert page.evaluate('skyfront.engine.economy(skyfront.getWorld().state,0).districts.active') == 0
    page.locator('[data-district-repair="north-depot"]').click()
    page.wait_for_function('skyfront.getState().districts[0].repairing')
    before = page.evaluate('skyfront.getState().sides[0].credits')
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,2);skyfront.getWorld().sync()')
    assert 0 < page.evaluate('skyfront.getState().districts[0].hp') < 360
    assert page.evaluate('skyfront.getState().sides[0].credits') < before
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,25);skyfront.getWorld().sync()')
    assert page.evaluate('skyfront.getState().districts[0].hp') == 360
    page.wait_for_function('document.querySelector("[data-district-repair=north-depot]").hidden')
    print('District destruction removes income, ruins render, and real repair clicks spend resources until completion', flush=True)

    carrier = page.evaluate("()=>{const E=skyfront.engine,w=skyfront.getWorld();const u=E.makeGround(w.state,0,'apc',-900,-70);u.holdFire=true;w.state.groundUnits.push(u);const ids=[];for(let i=0;i<3;i++){const p=E.makeGround(w.state,0,'infantry',u.x,u.z);p.carrierId=u.id;p.holdFire=true;w.state.groundUnits.push(p);ids.push(p.id);}w.focus(-860,-100,240);w.controls.update(3);w.sync();skyfront.selectArmy([u.id]);return{id:u.id,passengers:ids};}")
    delivery = page.locator('[data-troop="deliver"]')
    assert delivery.is_visible() and delivery.is_enabled()
    delivery.click()
    assert page.evaluate('skyfront.getOrder().troopMode') == 'deliver'
    dest = point(-820,-130)
    page.mouse.click(dest['x'],dest['y'])
    page.wait_for_function('(id)=>Boolean(skyfront.getState().groundUnits.find(u=>u.id===id).delivery)', arg=carrier['id'])
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,8);skyfront.getWorld().sync()')
    assert page.evaluate('(ids)=>skyfront.getState().groundUnits.filter(u=>ids.includes(u.id)).every(u=>!u.carrierId)', carrier['passengers'])
    assert page.evaluate('(id)=>skyfront.getState().groundUnits.find(u=>u.id===id).delivery', carrier['id']) is None
    page.wait_for_function('document.querySelector("[data-troop=deliver]").disabled')
    assert '0/8' in page.locator('#ground-state').inner_text()
    print('A real delivery button and ground click drive the APC and unload its selected passengers automatically', flush=True)

    flag = page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),d=E.DISTRICTS[1],u=E.makeGround(w.state,0,'infantry',d.x+45,d.z+5);u.holdFire=true;w.state.groundUnits.push(u);w.focus(d.x,d.z,240);w.controls.update(3);w.sync();skyfront.selectArmy([u.id]);return{x:d.x+15.5,z:d.z+9,id:u.id};}''')
    flag_point = point(flag['x'],flag['z'],11)
    page.mouse.click(flag_point['x'],flag_point['y'],button='right')
    page.wait_for_function('(id)=>Boolean(skyfront.getState().groundUnits.find(u=>u.id===id).guard)',arg=flag['id'])
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,30);skyfront.getWorld().sync()')
    assert page.evaluate('skyfront.getState().districts[1].owner') == 0
    print('Right-clicking the actual 3D district flag sends the selected infantry to capture it',flush=True)

    unit = page.evaluate("()=>{const E=skyfront.engine,w=skyfront.getWorld(),u=E.makeGround(w.state,0,'infantry',-900,-70);u.holdFire=true;w.state.groundUnits.push(u);w.focus(-850,-110,240);w.controls.update(3);w.sync();skyfront.selectArmy([u.id]);E.guardGround(w.state,0,[u.id],u);return u.id;}")
    a, b = point(-850,-140), point(-760,-160)
    yaw = page.evaluate('skyfront.diagnostics().camera.yaw')
    page.keyboard.down('Shift')
    page.mouse.click(a['x'],a['y'],button='right')
    page.mouse.click(b['x'],b['y'],button='right')
    page.keyboard.up('Shift')
    page.wait_for_function('(id)=>skyfront.getState().groundUnits.find(u=>u.id===id).routeQueue?.length===1', arg=unit)
    assert abs(page.evaluate('skyfront.diagnostics().camera.yaw')-yaw) < .001
    assert page.evaluate('(id)=>skyfront.getState().groundUnits.find(u=>u.id===id).guard', unit) is None
    page.wait_for_function('skyfront.getWorld().tactical.groundPlans.visible && skyfront.getWorld().tactical.plannedMarkers.count===2')
    frozen = page.evaluate('(id)=>{const u=skyfront.getState().groundUnits.find(u=>u.id===id);return{x:u.x,z:u.z};}',unit)
    page.wait_for_timeout(750)
    assert page.evaluate('(id)=>{const u=skyfront.getState().groundUnits.find(u=>u.id===id);return{x:u.x,z:u.z};}',unit) == frozen
    blocker = page.evaluate("()=>{const E=skyfront.engine,w=skyfront.getWorld();const b=E.build(w.state,0,'launcher',-760,-160);if(typeof b==='string')throw Error(b);b.progress=1;w.sync();return b.id;}")
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,20);skyfront.getWorld().sync()')
    assert page.evaluate('(id)=>skyfront.getState().groundUnits.find(u=>u.id===id).routeState.status',unit) == 'blocked'
    page.wait_for_function('document.querySelector("#ground-state").textContent.includes("заблокирован")')
    page.screenshot(path=str(ARTIFACTS/'routes-blocked-1024.png'), timeout=120000)
    page.evaluate('(id)=>skyfront.engine.demolish(skyfront.getWorld().state,id,0)',blocker)
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,15);skyfront.getWorld().sync()')
    assert page.evaluate('(id)=>skyfront.getState().groundUnits.find(u=>u.id===id).routeState',unit) is None
    assert page.evaluate('(id)=>{const u=skyfront.getState().groundUnits.find(u=>u.id===id);return Math.hypot(u.x+760,u.z+160);}',unit)<4
    print('Shift-right-click starts from guard, queues a visible path, pauses, waits for a blocked point and resumes after demolition',flush=True)

    page.keyboard.press('Escape')
    page.evaluate('skyfront.openPanel("economy",true)')
    page.wait_for_function('document.querySelectorAll("[data-settlement-focus]").length===8')
    village = page.evaluate('skyfront.engine.SETTLEMENTS[0]')
    page.locator(f'[data-settlement-focus="{village["id"]}"]').click()
    page.wait_for_function('(name)=>document.querySelector("#inspector").textContent.includes(name)',arg=village['name'])
    assert 'дорогу' in page.locator('#inspector').inner_text()
    page.wait_for_function('()=>{const c=skyfront.getWorld().controls;return c.target.distanceTo(c.desired)<1;}',polling=50)
    page.keyboard.press('Escape')
    house = point(village['x']-20,village['z']+8+village['seed']%3,4)
    assert page.evaluate('p=>document.elementFromPoint(p.x,p.y)===skyfront.getWorld().renderer.domElement',house),house
    page.mouse.click(house['x'],house['y'])
    page.wait_for_function('(name)=>!document.querySelector("#inspector").hidden&&document.querySelector("#inspector").textContent.includes(name)',arg=village['name'])
    assert 'Поступления / мин' in page.locator('#inspector').inner_text()
    page.screenshot(path=str(ARTIFACTS/'settlements-810-1024.png'),timeout=120000)
    print('All eight economy focus buttons exist and clicking a real 3D village house opens its road and income status',flush=True)

    page.evaluate('skyfront.save()')
    page.reload(wait_until='load', timeout=120000)
    page.wait_for_function('Boolean(window.skyfront)')
    assert page.evaluate('skyfront.getState().districts[0].owner') == 0
    assert page.evaluate('skyfront.getState().districts[0].hp') == 360
    assert not report['errors'] and not report['consoleErrors'], report
    report.update({'version8Migration':True,'compact1024':True,'twoCentralDepots':True,'capture':True,'ruinsAndRepair':True,'deliveryClicks':True,'shiftRoute':True,'blockedResume':True,'eightSettlementButtons':True,'settlement3DClick':True,'savePersisted':True})
    (ARTIFACTS/'territory-routes-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    browser.close()

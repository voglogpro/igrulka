import json
from pathlib import Path
from playwright.sync_api import sync_playwright

from support import ROOT as root, ARTIFACTS, launch_browser
report={'errors':[],'consoleErrors':[],'network':[],'checks':[]}
with sync_playwright() as p:
    browser=launch_browser(p)
    page=browser.new_page(offline=True,viewport={'width':1000,'height':700},device_scale_factor=1)
    page.set_default_timeout(90000)
    page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.on('console',lambda e:report['consoleErrors'].append(e.text[:1500]) if e.type=='error' else None)
    page.on('request',lambda r:report['network'].append(r.url) if r.url.startswith('http') else None)
    page.goto(((root/'play/Skyfront.html')).as_uri(),wait_until='load',timeout=120000)
    page.wait_for_function('Boolean(window.skyfront)')
    page.locator('[data-action="start"]').click();page.keyboard.press('Space')
    assert page.evaluate('skyfront.isPaused()')
    page.evaluate("()=>{const w=skyfront.getWorld(),s=w.state,E=skyfront.engine;w.controls.focus(-850,0,300);w.controls.update(3);s.buildings.push({id:s.nextId++,side:0,key:'launcher',x:-800,z:100,hp:200,maxHp:200,progress:1,rotation:0});s.groundUnits.push(E.makeGround(s,0,'infantry',-850,0));w.sync();}")
    def pan(key,axis,sign=1):
        before=page.evaluate('({x:skyfront.getWorld().controls.desired.x,z:skyfront.getWorld().controls.desired.z})')
        direction=page.evaluate('axis=>{const v=skyfront.getWorld().controls[axis];return {x:v.x,z:v.z}}',axis)
        page.keyboard.down(key)
        page.wait_for_function('p=>Math.hypot(skyfront.getWorld().controls.desired.x-p.x,skyfront.getWorld().controls.desired.z-p.z)>2',arg=before)
        page.keyboard.up(key)
        after=page.evaluate('({x:skyfront.getWorld().controls.desired.x,z:skyfront.getWorld().controls.desired.z})')
        dx=after['x']-before['x'];dz=after['z']-before['z']
        dot=(dx*direction['x']+dz*direction['z'])*sign/(dx*dx+dz*dz)**.5
        assert dot>.98,(key,before,after,direction,dot)
        report['checks'].append(key+' '+axis)
    for key,axis,sign in [('w','forward',1),('s','forward',-1),('a','right',-1),('d','right',1),('ArrowUp','forward',1)]:pan(key,axis,sign)
    print('WASD and arrows move correctly while simulation is paused',flush=True)
    page.locator('[data-panel="attack"]').first.click()
    page.locator('#launch-site').focus()
    # Exact regression: rotating via RMB used to leave focus trapped in this select.
    yaw=page.evaluate('skyfront.diagnostics().camera.yaw')
    page.mouse.move(440,300);page.mouse.down(button='right');page.mouse.move(470,320,steps=3);page.mouse.up(button='right')
    assert page.evaluate('document.activeElement===skyfront.getWorld().renderer.domElement')
    assert page.evaluate('skyfront.diagnostics().camera.yaw')!=yaw
    pan('w','forward');pan('d','right')
    report['checks'].append('RMB from focused select restores camera input')
    page.locator('#launch-site').select_option(index=1)
    assert page.evaluate('document.activeElement===skyfront.getWorld().renderer.domElement')
    pan('s','forward',-1)
    page.locator('#salvo-count').focus()
    before=page.evaluate('JSON.stringify(skyfront.getWorld().controls.desired)')
    page.keyboard.down('a');page.wait_for_timeout(500);page.keyboard.up('a')
    assert page.evaluate('JSON.stringify(skyfront.getWorld().controls.desired)')==before
    page.keyboard.press('Enter')
    assert page.evaluate('document.activeElement===skyfront.getWorld().renderer.domElement')
    pan('a','right',-1)
    report['checks'].append('number entry blocks WASD until Enter returns focus')
    page.locator('#launch-site').focus()
    page.mouse.move(440,300);page.mouse.wheel(0,-100)
    assert page.evaluate('document.activeElement===skyfront.getWorld().renderer.domElement')
    pan('w','forward')
    page.locator('[data-action="close-panel"]').click()
    page.evaluate('skyfront.selectArmy([skyfront.getState().groundUnits[0].id])')
    page.locator('#formation').select_option('column')
    assert page.evaluate('skyfront.getState().formations[0]')=='column'
    assert page.evaluate('document.activeElement===skyfront.getWorld().renderer.domElement')
    pan('d','right')
    page.locator('[data-panel="settings"]').click();page.locator('#volume').focus()
    before=page.evaluate('JSON.stringify(skyfront.getWorld().controls.desired)')
    page.keyboard.down('w');page.wait_for_timeout(500);page.keyboard.up('w')
    assert page.evaluate('JSON.stringify(skyfront.getWorld().controls.desired)')==before
    page.keyboard.press('Escape')
    assert page.locator('#panel').is_hidden()
    assert page.evaluate('document.activeElement===skyfront.getWorld().renderer.domElement')
    pan('w','forward')
    report['checks'].append('Escape closes settings from slider and restores WASD')
    page.locator('[data-panel="settings"]').click();page.locator('#shake').focus()
    page.locator('[data-action="close-panel"]').click();pan('s','forward',-1)
    page.locator('[data-panel="attack"]').first.click();page.locator('#salvo-count').focus()
    page.locator('#minimap').click(position={'x':65,'y':60})
    assert page.evaluate('document.activeElement===skyfront.getWorld().renderer.domElement')
    pan('d','right')
    page.keyboard.press('Escape')
    page.keyboard.down('w');page.wait_for_function('Boolean(skyfront.getWorld().keys.KeyW)')
    page.evaluate('window.dispatchEvent(new Event("blur"))');page.keyboard.up('w')
    before=page.evaluate('JSON.stringify(skyfront.getWorld().controls.desired)')
    page.wait_for_timeout(500)
    assert page.evaluate('JSON.stringify(skyfront.getWorld().controls.desired)')==before
    report['checks'].append('window blur clears held movement')
    # Russian layout changes key but keeps physical code; camera uses code.
    page.evaluate('window.dispatchEvent(new KeyboardEvent("keydown",{key:"\u0446",code:"KeyW",bubbles:true}))')
    assert page.evaluate('skyfront.getWorld().keys.KeyW')
    page.evaluate('window.dispatchEvent(new KeyboardEvent("keyup",{key:"\u0446",code:"KeyW",bubbles:true}))')
    report['checks'].append('Russian layout physical KeyW accepted')
    assert not report['errors'] and not report['consoleErrors'] and not report['network'],report
    report['camera']=page.evaluate('skyfront.diagnostics().camera')
    browser.close()
((ARTIFACTS/'camera8-report.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report),flush=True)

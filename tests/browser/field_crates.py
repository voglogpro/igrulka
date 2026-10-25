"""Real crate picking and private inspector; finite fixtures round-trip strict saves."""
import json
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

report = {'errors': []}
with sync_playwright() as p:
    browser = launch_browser(p)
    page = browser.new_page(viewport={'width': 1280, 'height': 720}, offline=True)
    page.set_default_timeout(120000)
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.goto((ROOT / 'play/Skyfront.html').as_uri(), wait_until='load', timeout=180000)
    page.wait_for_function('Boolean(window.skyfront)')
    page.locator('[data-action="start"]').click()
    page.keyboard.press('Space')
    report['fixture'] = page.evaluate('''()=>{
      const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(811,{mode:'coop'}),hq=E.hqOf(s,0);
      const make=(side,x,small)=>({id:s.nextId++,side,key:'ammo-crate',x,z:hq.z+40,hp:E.FIELD_SUPPLY.hp,maxHp:E.FIELD_SUPPLY.hp,stock:{small,shell:2,rocket:1,sam:1}});
      s.ammoCrates=[make(0,hq.x+70,17),make(1,hq.x+105,73)];
      const loaded=E.load(E.save(s));Object.assign(w.state,loaded);w.previousSimTime=s.time;
      w.focus(hq.x+85,hq.z+35,180);w.controls.update(3);w.sync();w.scene.updateMatrixWorld(true);
      return {own:loaded.ammoCrates[0].id,enemy:loaded.ammoCrates[1].id,crates:w.ammoCrates.diagnostics(),validatedVersion:loaded.version};
    }''')

    def point(crate_id):
        return page.evaluate('''id=>{const w=skyfront.getWorld(),c=w.state.ammoCrates.find(c=>c.id===id),v=w.camera.position.clone().set(c.x,w.height(c.x,c.z)+1.5,c.z).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''', crate_id)

    own = point(report['fixture']['own'])
    page.mouse.click(own['x'], own['y'])
    page.wait_for_function('document.querySelector("#inspector").textContent.includes("Патроны")')
    own_text = page.locator('#inspector').inner_text()
    assert '17 /' in own_text
    report['ownInspector'] = own_text
    page.evaluate('''id=>{window.__crateClose=document.querySelector('#inspector [data-action="deselect"]');skyfront.getWorld().state.ammoCrates.find(c=>c.id===id).stock.small=16;}''', report['fixture']['own'])
    page.wait_for_function('document.querySelector("#inspector").textContent.includes("16 /")')
    assert page.evaluate('window.__crateClose===document.querySelector(\'#inspector [data-action="deselect"]\')')
    report['stockTickClosePreserved'] = True
    page.screenshot(path=str(ARTIFACTS / 'field-crate-own811.png'), timeout=120000)
    enemy = point(report['fixture']['enemy'])
    report['enemyPoint'] = enemy
    report['beforeEnemyClick'] = page.evaluate('''p=>{const w=skyfront.getWorld(),r=w.renderer.domElement.getBoundingClientRect();w.pointer.set((p.x-r.left)/r.width*2-1,-(p.y-r.top)/r.height*2+1);w.ray.setFromCamera(w.pointer,w.camera);const hit=w.ammoCrates.pick(w.ray),target=skyfront.engine.observedTarget(w.state,0,hit),element=document.elementFromPoint(p.x,p.y);return {hit,target,element:{tag:element?.tagName,id:element?.id,className:element?.className}};}''', enemy)
    page.mouse.click(enemy['x'], enemy['y'])
    report['afterEnemyClick'] = page.evaluate('''()=>({selected:skyfront.getWorld().selected,inspectorHidden:document.querySelector('#inspector').hidden,inspector:document.querySelector('#inspector').textContent,panelHidden:document.querySelector('#panel').hidden,panel:document.querySelector('#panel').textContent.slice(0,180)})''')
    try:
        page.wait_for_function('document.querySelector("#inspector").textContent.includes("Запас противника")', timeout=10000)
    except Exception:
        report['failure'] = 'enemy-inspector-after-actual-click'
        (ARTIFACTS / 'field-crates811-failure.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
        page.screenshot(path=str(ARTIFACTS / 'field-crates811-failure.png'), timeout=30000)
        raise
    enemy_text = page.locator('#inspector').inner_text()
    assert 'Патроны' not in enemy_text and '73' not in enemy_text
    assert 'не раскрывается' in enemy_text
    report['enemyInspector'] = enemy_text
    report['destroyed'] = page.evaluate('''id=>{const E=skyfront.engine,w=skyfront.getWorld(),c=w.state.ammoCrates.find(c=>c.id===id);E.damageAmmoCrates(w.state,c.x,c.z,c.maxHp*2,5);w.sync();const loaded=E.load(E.save(w.state));return {hp:c.hp,stock:c.stock,crates:w.ammoCrates.diagnostics(),roundTrip:loaded.ammoCrates.find(v=>v.id===id).hp};}''', report['fixture']['own'])
    assert report['destroyed']['hp'] == 0 and report['destroyed']['roundTrip'] == 0
    assert sum(report['destroyed']['stock'].values()) == 0
    assert report['destroyed']['crates']['crates'] == 1
    assert not report['errors'], report['errors']
    report['passed'] = True
    (ARTIFACTS / 'field-crates811.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(report, ensure_ascii=True), flush=True)
    browser.close()

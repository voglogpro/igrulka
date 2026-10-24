import json
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

report = {'errors': []}
with sync_playwright() as p:
    browser = launch_browser(p)
    page = browser.new_page(viewport={'width': 1024, 'height': 768}, offline=True)
    page.set_default_timeout(90000)
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.goto((ROOT / 'play/Skyfront.html').as_uri(), wait_until='load', timeout=120000)
    page.wait_for_function('Boolean(window.skyfront)')
    page.locator('[data-action="start"]').click()
    page.keyboard.press('Space')
    ids = page.evaluate('''() => {
      const E=skyfront.engine, w=skyfront.getWorld(), s=E.createGame(1022);s.rules.rear=false;
      s.ai.nextBuild=s.ai.nextAttack=s.ai.nextResearch=s.ai.nextArmy=1e9;
      s.sides[0].credits=30000; s.sides[0].materials=4000;
      const b=E.build(s,0,'barracks',-1080,-10); if(typeof b==='string') throw Error(b);
      b.progress=1; b.hp=b.maxHp;const base=E.build(s,0,'vehiclebase',-960,-80);if(typeof base==='string')throw Error(base);base.progress=1;base.hp=base.maxHp;
      for(let i=0;i<10;i++)s.groundUnits.push(E.makeGround(s,0,'infantry',-900+i%5*12,-40+Math.floor(i/5)*15));
      Object.assign(w.state,s); w.focus(-860,-60,240);w.controls.update(3);w.sync();w.scene.updateMatrixWorld(true);
      const ids=s.groundUnits.map(u=>u.id);skyfront.selectArmy(ids);return ids;
    }''')
    def point(x, z):
        return page.evaluate('''p=>{const w=skyfront.getWorld(),v=w.camera.position.clone().set(p.x,0,p.z).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''', {'x': x, 'z': z})
    assert page.locator('#army-controls').is_visible()
    assert page.locator('#inspector').is_hidden()
    assert page.locator('#army-controls').bounding_box()['height'] < 200
    for command in ['stop', 'attackmove', 'guard', 'defendline', 'dig', 'camo', 'fire', 'retreat']:
        assert page.locator(f'[data-troop="{command}"]').is_visible()
    before = page.evaluate('skyfront.getState().groundUnits.map(u=>u.order)')
    page.mouse.move(450,250);page.mouse.down(button='right');page.mouse.move(490,270,steps=5);page.mouse.up(button='right')
    assert page.evaluate('skyfront.getState().groundUnits.map(u=>u.order)') == before
    destination = point(-840,-120)
    page.mouse.click(destination['x'], destination['y'], button='right')
    assert page.evaluate('skyfront.getState().groundUnits.every(u=>u.path.length>0)')
    assert page.evaluate('skyfront.getOrder().armySelection') == ids
    page.locator('[data-troop="stop"]').click()
    page.locator('[data-troop="defendline"]').click()
    page.locator('[data-troop="guard"]').click()
    assert page.evaluate('skyfront.getWorld().groundTargeting') is None
    page.locator('[data-troop="attackmove"]').click()
    page.locator('[data-troop="dig"]').click()
    assert page.evaluate('skyfront.getWorld().groundTargeting') is None
    page.evaluate('''async()=>{const pending=skyfront.troopCommand('guard');skyfront.troopCommand('defendline');await pending;}''')
    assert page.evaluate('skyfront.getOrder().troopMode') == 'defendline'
    page.locator('[data-troop="stop"]').click()
    page.locator('[data-troop="defendline"]').click()
    a, b = point(-930,-150), point(-790,-150)
    page.mouse.move(a['x'],a['y']);page.mouse.down();page.mouse.move(b['x'],b['y'],steps=12)
    assert page.evaluate('skyfront.getWorld().tactical.defenseLine.visible')
    page.screenshot(path=str(ARTIFACTS/'army-line-preview.png'),timeout=120000)
    page.mouse.up()
    assert page.evaluate('skyfront.getState().groundUnits.every(u=>u.guard)')
    posts=page.evaluate('skyfront.getState().groundUnits.map(u=>u.guard)')
    assert len(set(round(g['x']) for g in posts)) >= 8
    page.wait_for_function('!skyfront.getWorld().tactical.postLine.visible && skyfront.getWorld().tactical.postMarkers.count===10')
    page.locator('[data-troop="stop"]').click()
    assert page.evaluate('skyfront.getState().groundUnits.every(u=>!u.guard)')
    page.locator('[data-panel="settings"]').click()
    page.keyboard.press('z')
    page.keyboard.press('f')
    page.keyboard.press('1')
    assert not page.evaluate('skyfront.getWorld().aiming')
    assert page.evaluate('skyfront.getWorld().buildKey') is None
    assert page.locator('#volume').is_visible()
    page.keyboard.press('Escape')
    page.keyboard.press('f')
    page.locator('[data-army-category="vehicles"]').click()
    assert page.locator('#panel [data-recruit="leopard"]').is_visible()
    assert page.locator('#panel [data-recruit="infantry"]').count() == 0
    page.locator('[data-army-category="infantry"]').click()
    page.locator('[data-army-target="machinegunner"]').fill('1')
    page.locator('[data-army-target="machinegunner"]').press('Tab')
    page.wait_for_function('skyfront.getState().sides[0].armyComposition.targets.machinegunner===1')
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,15)')
    assert page.evaluate('skyfront.getState().groundUnits.some(u=>u.key==="machinegunner")')
    page.locator('[data-army-target="machinegunner"]').fill('0')
    page.locator('[data-army-target="machinegunner"]').press('Tab')
    page.wait_for_function('!skyfront.getState().sides[0].armyComposition.targets.machinegunner')
    page.screenshot(path=str(ARTIFACTS/'army-compact-recruitment.png'),timeout=120000)
    assert not report['errors'], report
    report.update({'selected':len(ids), 'posts':posts, 'diagnostics':page.evaluate('skyfront.diagnostics()')})
    (ARTIFACTS/'army-controls-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print('Compact army UI at 1024px, right-click orders vs rotation, defense-line drag and composition recruitment passed',flush=True)
    browser.close()

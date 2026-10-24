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
    page.goto((ROOT/'play/Skyfront.html').as_uri(), wait_until='load', timeout=120000)
    page.wait_for_function('Boolean(window.skyfront)')
    page.locator('[data-action="start"]').click()
    page.keyboard.press('Space')
    factory = page.evaluate("()=>{const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(823);s.ai.nextBuild=s.ai.nextArmy=s.ai.nextAttack=s.ai.nextResearch=1e9;s.sides[0].credits=10000;s.sides[0].materials=1000;const f=E.build(s,0,'factory',-1080,-10),l=E.build(s,0,'launcher',-940,-140);if(typeof f==='string'||typeof l==='string')throw Error(String(f)+' '+String(l));for(const b of [f,l]){b.progress=1;b.hp=b.maxHp;}s.sides[0].credits=1000;s.sides[0].materials=100;Object.assign(w.state,s);w.sync();return f.id;}")
    page.locator('[data-panel="attack"]').first.click()
    assert page.locator('#district-strip').is_hidden(), 'District cards must not cover the arsenal or its close button'
    page.locator('[data-action="close-panel"]').click()
    page.locator('[data-panel="attack"]').first.click()
    assert not page.locator('.factory-automation').get_attribute('open')
    page.locator('.factory-automation summary').click()
    assert page.locator('#factory-plan-site').input_value() == str(factory)
    page.locator('#factory-plan-target').fill('3')
    page.locator('#factory-plan-credits').fill('1000')
    page.locator('#factory-plan-materials').fill('50')
    # Polling refresh must leave unsubmitted input intact.
    page.wait_for_timeout(750)
    assert page.locator('#factory-plan-target').input_value() == '3'
    page.locator('#factory-plan-save').click()
    page.wait_for_function('(id)=>skyfront.getState().buildings.find(b=>b.id===id).productionPlan?.enabled', arg=factory)
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,1)')
    page.wait_for_function('document.querySelector("#factory-plan-status").textContent.includes("Ожидание денег")')
    assert page.evaluate('(id)=>skyfront.getState().buildings.find(b=>b.id===id).queue.length', factory) == 0
    print('A real factory plan click keeps edited fields, waits for the chosen money reserve and does not buy free stock', flush=True)

    page.evaluate('skyfront.getWorld().state.sides[0].credits=1500;skyfront.engine.advance(skyfront.getWorld().state,60)')
    page.wait_for_function('document.querySelector("#factory-plan-status").textContent.includes("Целевой запас собран")')
    assert page.evaluate('skyfront.engine.weaponStock(skyfront.getState(),0,"drone")') == 3
    assert page.evaluate('skyfront.getState().sides[0].credits') >= 1000
    assert page.evaluate('skyfront.getState().sides[0].materials') >= 50
    assert page.evaluate('(id)=>skyfront.getState().buildings.find(b=>b.id===id).queue.length', factory) == 0
    page.screenshot(path=str(ARTIFACTS/'production-plan-1024.png'), timeout=120000)
    launched = page.evaluate('skyfront.command("launch",{key:"drone",aim:{x:1000,z:80},count:1})')
    assert launched == 1, launched
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,.1)')
    assert page.evaluate('(id)=>skyfront.getState().buildings.find(b=>b.id===id).queue.length', factory) == 1
    page.locator('#factory-plan-stop').click()
    page.wait_for_function('(id)=>!skyfront.getState().buildings.find(b=>b.id===id).productionPlan.enabled', arg=factory)
    assert page.evaluate('(id)=>skyfront.getState().buildings.find(b=>b.id===id).queue.length', factory) == 1
    page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,30)')
    assert page.evaluate('skyfront.engine.weaponStock(skyfront.getState(),0,"drone")') == 3
    print('The live plan reaches its target, replaces an actually launched drone and preserves paid work when stopped', flush=True)

    page.evaluate('skyfront.save()')
    page.reload(wait_until='load', timeout=120000)
    page.wait_for_function('Boolean(window.skyfront)')
    plan = page.evaluate('(id)=>skyfront.getState().buildings.find(b=>b.id===id).productionPlan', factory)
    assert plan == {'key':'drone','target':3,'reserveCredits':1000,'reserveMaterials':50,'enabled':False}, plan
    page.locator('[data-action="start"]').click()
    page.keyboard.press('Space')
    page.locator('[data-panel="attack"]').first.click()
    page.locator('.factory-automation summary').click()
    assert page.locator('#factory-plan-target').input_value() == '3'
    assert page.locator('#factory-plan-credits').input_value() == '1000'
    assert not report['errors'] and not report['consoleErrors'], report
    report.update({'realControls':True,'reserveWait':True,'targetAndReplacement':True,'paidQueueSurvivesStop':True,'saveReload':True})
    (ARTIFACTS/'production-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print('Saved factory settings reopen intact; offline browser has no JS or console errors', flush=True)
    browser.close()

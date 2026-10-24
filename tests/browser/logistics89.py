"""Offline integration: real inspector controls, field delivery, local stock and save/load."""
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
    try:
        page.goto((ROOT/'play/Skyfront.html').as_uri(), wait_until='load', timeout=120000)
        page.wait_for_function('Boolean(window.skyfront)')
        page.locator('[data-action="start"]').click()
        page.keyboard.press('Space')
        assert page.evaluate('skyfront.isPaused()')
        fixture = page.evaluate('''()=>{
            const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(8917);
            s.mode='multiplayer';s.rules.rear=false;
            Object.assign(s.sides[0],{credits:30000,materials:4000,oil:1000});
            function ready(key,x,z){const b=E.build(s,0,key,x,z);if(typeof b==='string')throw Error(key+': '+b);b.progress=1;b.hp=b.maxHp;return b;}
            ready('power',-1070,-80);
            const factory=ready('factory',-1080,-10),depot=ready('ammofactory',-950,-10),
                launcher=ready('launcher',-820,320),silo=ready('silo',-850,420),
                mog=E.makeGround(s,0,'mog',-920,220);
            mog.groundAmmo=0;mog.ammoReserve=0;mog.holdFire=true;s.groundUnits.push(mog);
            Object.assign(s.sides[0].inventory,{drone:4,heavy:2,cruise:2,ballistic:2});
            E.advance(s,3);Object.assign(w.state,s);w.sync();
            return {factory:factory.id,depot:depot.id,launcher:launcher.id,silo:silo.id,mog:mog.id,
                stock:Object.fromEntries(Object.keys(E.WEAPONS).map(k=>[k,E.weaponStock(s,0,k)])),
                vans:s.ammoVehicles.length};
        }''')
        assert fixture['vans'] == 4, fixture
        # The recipient is deliberately off the road network.
        assert page.evaluate('(id)=>!skyfront.engine.buildingConnected(skyfront.getWorld().state,skyfront.getState().buildings.find(b=>b.id===id),24)', fixture['launcher'])
        page.evaluate('(id)=>skyfront.select(id)', fixture['launcher'])
        page.wait_for_selector('[data-upgrade]')
        before = page.evaluate('(id)=>{const s=skyfront.getWorld().state,b=s.buildings.find(b=>b.id===id);return {credits:s.sides[0].credits,hp:b.maxHp,cost:skyfront.engine.upgradeStatus(s,0,id).cost};}', fixture['launcher'])
        page.locator(f'[data-upgrade="{fixture["launcher"]}"]').click()
        page.wait_for_function('(id)=>skyfront.getState().buildings.find(b=>b.id===id).level===1', arg=fixture['launcher'])
        assert page.evaluate('(id)=>skyfront.getState().buildings.find(b=>b.id===id).maxHp', fixture['launcher']) == before['hp']
        assert abs(page.evaluate('skyfront.getState().sides[0].credits') - (before['credits']-before['cost'])) < 1e-6
        page.wait_for_function('document.querySelector(".supply-detail")?.textContent.includes("5")')
        assert page.evaluate('()=>{const r=document.querySelector("#inspector").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}')

        # Saving in transit must preserve cargo, positions and balances.
        mid = page.evaluate('''()=>{const E=skyfront.engine,s=skyfront.getWorld().state,a=E.load(E.save(s));
            if(JSON.stringify(a.ammoVehicles)!==JSON.stringify(s.ammoVehicles))throw Error('Fleet changed on import');
            const before=s.ammoVehicles.map(v=>({id:v.id,x:v.x,z:v.z,cargo:v.cargo}));
            E.advance(s,5);skyfront.getWorld().sync();return {before,after:s.ammoVehicles.map(v=>({id:v.id,x:v.x,z:v.z,cargo:v.cargo}))};}''')
        assert any(a['x'] != b['x'] or a['z'] != b['z'] for a,b in zip(mid['before'],mid['after']))
        fleet = page.evaluate('skyfront.getWorld().ammoFleet.diagnostics()')
        assert fleet['vehicles'] == 4 and fleet['drawCalls'] <= 5, fleet
        page.evaluate('skyfront.getWorld().focus(-900,210)')
        page.screenshot(path=str(ARTIFACTS/'field-supply-89.png'), timeout=120000)

        result = page.evaluate('''ids=>{const E=skyfront.engine,w=skyfront.getWorld(),s=w.state;
            E.advance(s,100);w.sync();const mog=s.groundUnits.find(u=>u.id===ids.mog),
                launcher=s.buildings.find(b=>b.id===ids.launcher),silo=s.buildings.find(b=>b.id===ids.silo);
            const stock=Object.fromEntries(Object.keys(E.WEAPONS).map(k=>[k,E.weaponStock(s,0,k)]));
            const shots=E.launch(s,0,'drone',{x:1015,z:80},2,launcher.id),
                queued=s.units.filter(u=>u.sourceId===launcher.id).map(u=>u.delay);
            E.load(E.save(s));
            return {stock,ammo:E.ammunitionStatus(s,mog),rack:launcher.launchStore,silo:silo.launchStore,shots,queued};
        }''', fixture)
        assert result['stock'] == fixture['stock'], result
        assert result['ammo']['total'] > 0, result
        assert result['silo']['cruise'] + result['silo']['ballistic'] > 0, result
        assert result['shots'] == 2 and abs(result['queued'][1]-result['queued'][0]-5) < 1e-6, result

        # Keyboard panel shortcuts remain physical keys on Russian layouts.
        page.keyboard.press('Escape')
        page.keyboard.press('e')
        assert page.locator('#panel [data-produce]').count() == 4
        page.keyboard.press('Escape')
        page.keyboard.press('f')
        page.wait_for_selector('[data-army-target="infantry"]')
        target = page.locator('[data-army-target="infantry"]')
        target.fill('4')
        target.press('Enter')
        page.wait_for_function('skyfront.getState().sides[0].armyComposition.targets.infantry===4')
        page.screenshot(path=str(ARTIFACTS/'composition-89-1024.png'), timeout=120000)
        assert not report['errors'] and not report['consoleErrors'], report
        report.update({'fieldDelivery':True,'paidUpgradeUI':True,'saveInTransit':True,'fleet':fleet,'localStockAndTempo':result,'keyboardPanels':True,'compositionInput':True})
        (ARTIFACTS/'logistics89-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(report,ensure_ascii=False),flush=True)
    finally:
        browser.close()

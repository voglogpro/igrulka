"""8.9.1 actual UI regression: preferences, physical stock and support recovery."""
import json
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

report = {'errors': [], 'consoleErrors': []}
with sync_playwright() as p:
    browser = launch_browser(p)
    page = browser.new_page(viewport={'width': 1024, 'height': 768}, offline=True)
    page.set_default_timeout(90000)
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda e: report['consoleErrors'].append(e.text) if e.type == 'error' else None)
    try:
        page.goto((ROOT/'play/Skyfront.html').as_uri(), wait_until='load', timeout=120000)
        page.wait_for_function('Boolean(window.skyfront)')
        assert page.locator('.boot-loading').count() == 0
        report['bootNoticeRemoved'] = True
        page.locator('[data-action="start"]').click()
        page.keyboard.press('Space')
        assert page.evaluate('skyfront.isPaused()')
        ids = page.evaluate('''()=>{
            const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(89171);
            s.mode='multiplayer';s.rules.rear=true;
            Object.assign(s.sides[0],{credits:30000,materials:4000,oil:1000});
            function ready(key,x,z){const b=E.build(s,0,key,x,z);if(typeof b==='string')throw Error(key+': '+b);b.progress=1;b.hp=b.maxHp;return b;}
            ready('power',-1070,-80);ready('factory',-1080,-10);ready('barracks',-960,-80);
            const silo=ready('silo',-850,420);
            E.acceptLaunchDelivery(silo,'cruise',4);
            Object.assign(s.sides[0].inventory,{drone:0,heavy:0,cruise:0,ballistic:2});
            Object.assign(w.state,s);w.previousSimTime=s.time;w.sync();
            return {silo:silo.id};
        }''')
        page.keyboard.press('e')
        page.locator('#panel [data-weapon="ballistic"]').click()
        page.locator('#strike-site').select_option(str(ids['silo']))
        page.wait_for_function('(id)=>skyfront.getState().buildings.find(b=>b.id===id).weaponDemand?.ballistic===1', arg=ids['silo'], polling=50)
        first = page.evaluate('''id=>{const E=skyfront.engine,s=skyfront.getWorld().state,b=s.buildings.find(b=>b.id===id);
            const before=E.availableLaunchStock(b,'cruise');E.advance(s,.1);
            return {before,after:E.availableLaunchStock(b,'cruise'),pickup:s.ammoVehicles.some(v=>v.pickup),air:s.units.length};}''', ids['silo'])
        assert first['before'] == first['after'] == 4 and first['pickup'] and first['air'] == 0, first
        # A ready local type still has to replace the previous delivery preference.
        page.locator('#quick-weapons [data-weapon="cruise"]').click()
        page.wait_for_function('(id)=>{const d=skyfront.getState().buildings.find(b=>b.id===id).weaponDemand;return d?.cruise===1&&!d.ballistic}', arg=ids['silo'], polling=50)
        page.evaluate('skyfront.engine.advance(skyfront.getWorld().state,45)')
        assert page.evaluate('(id)=>skyfront.engine.availableLaunchStock(skyfront.getState().buildings.find(b=>b.id===id),"cruise")', ids['silo']) == 4
        page.locator('#quick-weapons [data-weapon="ballistic"]').click()
        page.wait_for_function('(id)=>skyfront.getState().buildings.find(b=>b.id===id).weaponDemand?.ballistic===1', arg=ids['silo'], polling=50)
        transfer = page.evaluate('''id=>{const E=skyfront.engine,w=skyfront.getWorld(),s=w.state,b=s.buildings.find(b=>b.id===id);
            let moved=false,pickup=false;const start=new Map(s.ammoVehicles.map(v=>[v.id,[v.x,v.z]]));
            for(let i=0;i<2400&&!E.availableLaunchStock(b,'ballistic');i++){
                E.advance(s,.05);pickup ||= s.ammoVehicles.some(v=>v.pickup);
                moved ||= s.ammoVehicles.some(v=>start.has(v.id)&&Math.hypot(v.x-start.get(v.id)[0],v.z-start.get(v.id)[1])>10);
                if(E.weaponStock(s,0,'cruise')!==4||E.weaponStock(s,0,'ballistic')!==2)throw Error('Paid stock changed during physical transfer');
            }
            E.load(E.save(s));w.sync();return {moved,pickup,local:E.availableLaunchStock(b,'ballistic'),air:s.units.length};}''', ids['silo'])
        assert transfer['moved'] and transfer['pickup'] and transfer['local'] >= 1 and transfer['air'] == 0, transfer
        report['physicalPreferenceTransfer'] = transfer
        # A manually stopped support unit from an old globally-disabled save has a visible recovery path.
        page.keyboard.press('Escape')
        page.keyboard.press('f')
        page.locator('[data-army-category="rear"]').click()
        page.locator('[data-recruit-mode="point"]').click()
        page.locator('#panel [data-recruit="medic"]').click()
        point = page.evaluate('''()=>{const w=skyfront.getWorld();w.focus(-1250,250,300);w.controls.update(3);w.scene.updateMatrixWorld(true);
            const v=w.camera.position.clone().set(-1250,0,250).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''')
        page.mouse.click(point['x'],point['y'])
        page.wait_for_function('skyfront.getState().buildings.some(b=>b.armyQueue?.some(q=>q.key==="medic"&&q.destination))', polling=50)
        page.keyboard.press('Escape')
        support = page.evaluate('''()=>{const E=skyfront.engine,s=skyfront.getWorld().state;E.advance(s,90);
            const u=s.groundUnits.find(u=>u.key==='medic');if(!u||!u.supportManual||Math.hypot(u.x+1250,u.z-250)>10)throw Error('Manual support did not physically arrive');
            skyfront.getWorld().sync();skyfront.selectArmy([u.id]);return u.id;}''')
        page.locator('[data-troop="stop"]').click()
        page.evaluate('skyfront.getWorld().state.sides[0].rearAuto=false')
        page.evaluate('(id)=>skyfront.selectArmy([id])', support)
        button = page.locator('[data-action="support-auto"]')
        button.wait_for(state='visible')
        assert 'Возобновить' in button.inner_text()
        button.click()
        page.wait_for_function('(id)=>{const s=skyfront.getState();return s.sides[0].rearAuto&&!s.groundUnits.find(u=>u.id===id).supportManual}', arg=support, polling=50)
        report['legacySupportRecovery'] = True
        visibility = page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),s=w.state,
            patch=E.COVER_PATCHES.find(p=>p.x>900&&Math.abs(p.z)<800),hidden=E.makeGround(s,1,'infantry',patch.x,patch.z),
            tank=E.makeGround(s,1,'leopard',1500,700),foot=E.makeGround(s,1,'infantry',1450,760);
            hidden.camouflaged=true;foot.moving=true;s.groundUnits.push(hidden,tank,foot);
            const air={id:s.nextId++,side:1,key:'drone',x:1500,y:80,z:700,hp:20,delay:0,launched:true,vx:-20,vz:0,route:[{x:0,z:0}],targetId:1,tx:0,tz:0};s.units.push(air);w.sync();
            const canvas=document.querySelector('#minimap');w.updateMinimap(canvas);
            const pixel=canvas.getContext('2d').getImageData(Math.floor((1500/E.MAP.width+.5)*canvas.width),Math.floor((700/E.MAP.depth+.5)*canvas.height),1,1).data;
            return {tank:E.groundVisible(s,0,tank)&&w.groundModels.get(tank.id)?.visible,foot:E.groundVisible(s,0,foot)&&w.groundModels.get(foot.id)?.visible,air:E.unitVisible(s,0,air)&&w.unitModels.get(air.id)?.visible,hidden:!E.groundVisible(s,0,hidden)&&!w.groundModels.get(hidden.id)?.visible,mapOpen:E.pointVisible(s,0,1800,1400),minimapEnemy:pixel[0]>150&&pixel[0]>pixel[1]+40&&pixel[0]>pixel[2]+60};}''')
        assert all(visibility.values()), visibility
        report['openMapAndConcealment'] = visibility
        for width in (1024, 1366):
            page.set_viewport_size({'width':width,'height':768})
            page.wait_for_timeout(100)
            geometry = page.evaluate('''()=>[...document.querySelectorAll('.hud,.dock,.map')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})''')
            assert all(r['left'] >= 0 and r['right'] <= width+1 and r['top'] >= 0 and r['bottom'] <= 769 for r in geometry), geometry
            for i, a in enumerate(geometry):
                for b in geometry[i+1:]:
                    assert min(a['right'],b['right']) <= max(a['left'],b['left']) or min(a['bottom'],b['bottom']) <= max(a['top'],b['top']), geometry
            assert page.evaluate('''()=>{const b=document.querySelector('[data-action="support-auto"]'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}''')
            assert page.locator('#radar-chip').count() == 0
            assert page.evaluate('skyfront.getWorld().post.uniforms.visionActive.value') == 0
            page.screenshot(path=str(ARTIFACTS/f'audit891-{width}.png'), timeout=120000)
        report['responsiveBounds'] = [1024,1366]
        page.keyboard.press('Escape')
        spending = page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(89173);s.mode='multiplayer';
            Object.assign(s.sides[0],{credits:30000,materials:4000,oil:1000});
            for(const [key,x,z] of [['power',-1070,-80],['ammofactory',-1080,-10]]){const b=E.build(s,0,key,x,z);if(typeof b==='string')throw Error(b);b.progress=1;b.hp=b.maxHp;}
            s.groundUnits.push(E.makeGround(s,0,'leopard',-950,250));const before=s.sides[0].credits;E.updateAmmoProduction(s);
            Object.assign(w.state,s);w.sync();return {shell:s.sides[0].ammoStock.shell,spent:s.sides[0].ammoProductionSpent,paid:before-s.sides[0].credits};}''')
        assert spending == {'shell':6,'spent':24,'paid':24}, spending
        page.locator('[data-panel="economy"]').first.click()
        stat = page.locator('#panel .stat').filter(has_text='Производство боеприпасов')
        stat.wait_for()
        assert stat.locator('b').inner_text().replace('\xa0',' ') == '24 ₡'
        assert 'Потрачено на выстрелы' not in page.locator('#panel').inner_text()
        report['actualAmmoSpendingUI'] = spending
        page.screenshot(path=str(ARTIFACTS/'audit891-ammo-spending.png'),timeout=120000)
        page.keyboard.press('Escape')
        tiers = page.evaluate('''()=>{
            const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(89172);s.mode='multiplayer';
            const ground=['infantry','atrifle','shilka','gepard','leopard','machinegunner','sniper','assault','engineer','operator','apc','mog','atgm','tankdestroyer','howitzer','armoredcar','lighttank','ifv','heavytank','mlrs'],
                buildings=['ammofactory','factory','launcher','silo','gun','sam'],records=[];
            for(const [i,key] of [...ground,...buildings].entries())for(const level of [0,1,2]){
                const x=-1780+(i%4)*230+level*48,z=-660+Math.floor(i/4)*190;
                let u;if(i<ground.length){u=E.makeGround(s,0,key,x,z);u.level=level;if(key==='mog')u.setup=1;s.groundUnits.push(u);}
                else{u={id:s.nextId++,key,side:0,x,z,level,progress:1,hp:E.BUILDINGS[key].hp,maxHp:E.BUILDINGS[key].hp};E.initLaunchStore(u);s.buildings.push(u);}
                records.push({id:u.id,key,level,infantry:i<ground.length&&E.isInfantry(key),building:i>=ground.length});
            }
            Object.assign(w.state,s);w.sync();w.scene.updateMatrixWorld(true);
            const vertices=root=>{let n=0;root.traverse(o=>{n+=o.geometry?.attributes.position?.count||0});return n;};
            for(const r of records){const m=r.building?w.models.get(r.id).root:w.groundModels.get(r.id);r.vertices=vertices(m);r.position=[m.position.x,m.position.y,m.position.z];
                if(r.infantry&&r.level){const unit=s.groundUnits.find(u=>u.id===r.id);w.focus(unit.x,unit.z,300);w.controls.update(3);w.sync();
                    const mesh=w.infantry.equipment[r.level-1],index=mesh.userData.unitIds.indexOf(r.id),pool=w.infantry.pools.get(r.key+'0');
                    if(index<0)throw Error('Missing equipment '+r.key);const a=m.matrix.clone(),b=m.matrix.clone();mesh.getMatrixAt(index,a);pool.body.getMatrixAt(pool.body.userData.unitIds.indexOf(r.id),b);
                    if(a.elements.some((v,i)=>v!==b.elements[i]))throw Error('Equipment pose mismatch '+r.key);r.equipmentVertices=mesh.geometry.attributes.position.count;}
            }
            for(const key of [...ground,...buildings]){const rows=records.filter(r=>r.key===key);if((!rows[0].infantry||key==='mog')&&!(rows[1].vertices>rows[0].vertices&&rows[2].vertices>rows[1].vertices))throw Error('Indistinct tiers '+key);}
            return records;
        }''')
        assert len(tiers) == 78
        report['tierGeometryAndPoses'] = tiers
        for row, z in enumerate((-450, 300)):
            page.evaluate('(z)=>{const w=skyfront.getWorld();w.focus(-1360,z,720);w.controls.update(3)}',z)
            page.screenshot(path=str(ARTIFACTS/f'audit891-equipment-{row}.png'),timeout=120000)
        page.evaluate('''()=>{const w=skyfront.getWorld(),s=w.state;window.auditGallery={ground:s.groundUnits.slice(),buildings:s.buildings.slice()};
            const keys=['infantry','mog','atrifle'];s.groundUnits=s.groundUnits.filter(u=>keys.includes(u.key));s.buildings=[];
            for(const u of s.groundUnits){u.x=-1300+u.level*30;u.z=-180+keys.indexOf(u.key)*25;}
            w.focus(-1270,-155,100);w.controls.update(3);w.sync();}''')
        page.screenshot(path=str(ARTIFACTS/'audit891-equipment-infantry-close.png'),timeout=120000)
        page.evaluate('''()=>{const w=skyfront.getWorld(),s=w.state;s.groundUnits=window.auditGallery.ground.filter(u=>u.key==='leopard');s.buildings=window.auditGallery.buildings.filter(b=>b.key==='factory');
            for(const u of s.groundUnits){u.x=-1300+u.level*40;u.z=-180;}for(const b of s.buildings){b.x=-1300+b.level*40;b.z=-130;}
            w.focus(-1260,-155,100);w.controls.update(3);w.sync();delete window.auditGallery;}''')
        page.screenshot(path=str(ARTIFACTS/'audit891-equipment-vehicle-factory-close.png'),timeout=120000)
        assert not report['errors'] and not report['consoleErrors'], report
        print(json.dumps(report,ensure_ascii=False),flush=True)
    except Exception as error:
        report['failure'] = str(error)
        page.screenshot(path=str(ARTIFACTS/'audit891-failure.png'), timeout=120000)
        raise
    finally:
        (ARTIFACTS/'audit891-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        browser.close()

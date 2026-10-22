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
    page.goto(((root/'play/Skyfront.html')).as_uri(),wait_until='load',timeout=120000);page.wait_for_function('Boolean(window.skyfront)',timeout=60000)
    page.locator('[data-action="start"]').click();page.keyboard.press('Space')
    ids=page.evaluate('''()=>{const w=skyfront.getWorld(),E=skyfront.engine,s=E.createGame(817);s.ai.nextBuild=s.ai.nextAttack=s.ai.nextResearch=s.ai.nextArmy=1e9;for(const f of s.sides){f.credits=50000;f.materials=5000;f.tech=Object.keys(E.TECH);}const a=E.makeGround(s,0,'infantry',-475,-50),b=E.makeGround(s,1,'infantry',-440,-50);b.moving=true;s.groundUnits.push(a,b);Object.assign(w.state,s);w.previousSimTime=0;w.controls.focus(-460,-50,160);w.controls.update(3);w.sync();w.scene.updateMatrixWorld(true);w.post.render(w.scene,w.camera,w.elapsed);return [a.id,b.id];}''')
    def pt(x,z,y=2.8):
        return page.evaluate('''p=>{const w=skyfront.getWorld(),v=w.camera.position.clone().set(p.x,p.y,p.z).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''',{'x':x,'z':z,'y':y})
    point=pt(-475,-50);page.mouse.click(point['x'],point['y']);assert page.evaluate('skyfront.getOrder().armySelection')==[ids[0]]
    point=pt(-440,-50);page.mouse.click(point['x'],point['y']);assert page.evaluate('(id)=>skyfront.getState().groundUnits.find(u=>u.id===id).order.targetId',ids[0])==ids[1]
    page.mouse.click(550,500,button='right')
    print('Actual instanced soldier ray selection and enemy click issue a ground attack',flush=True)
    report['instancing']=page.evaluate('''()=>{const w=skyfront.getWorld(),E=skyfront.engine,s=w.state;s.groundUnits[1].side=0;w.sync();const before=w.post.render(w.scene,w.camera,w.elapsed),memory={...w.renderer.info.memory};for(let i=0;i<80;i++)s.groundUnits.push(E.makeGround(s,0,'infantry',-520+(i%10)*10,-100+Math.floor(i/10)*10));w.sync();const after=w.post.render(w.scene,w.camera,w.elapsed);return {before:before.calls,after:after.calls,memoryBefore:memory,memoryAfter:{...w.renderer.info.memory},count:s.groundUnits.length};}''')
    assert report['instancing']['before']==report['instancing']['after'],report['instancing']
    assert report['instancing']['memoryBefore']==report['instancing']['memoryAfter'],report['instancing']
    page.screenshot(path=str((ARTIFACTS/'infantry8-mass.png')),timeout=120000)
    print('80 additional riflemen do not add draw calls or geometries',flush=True)
    page.keyboard.press('Escape')
    moved=page.evaluate('''()=>{const w=skyfront.getWorld(),u=w.state.groundUnits[0];u.x=-250;u.z=160;w.focus(u.x,u.z,160);w.controls.update(3);w.sync();w.scene.updateMatrixWorld(true);return u.id;}''')
    point=pt(-250,160);page.mouse.click(point['x'],point['y'])
    assert page.evaluate('skyfront.getOrder().armySelection')==[moved]
    print('A moved instanced soldier remains clickable outside its initial bounds',flush=True)
    report['concealment']=page.evaluate('''()=>{const w=skyfront.getWorld(),E=skyfront.engine,s=w.state,p=E.COVER_PATCHES.find(p=>p.x>100&&p.x<450&&Math.abs(p.z)<400);s.groundUnits=[];const hidden=E.makeGround(s,1,'sniper',p.x,p.z),observer=E.makeGround(s,0,'machinegunner',p.x-130,p.z);hidden.camouflaged=true;observer.holdFire=true;s.groundUnits.push(hidden,observer);s.contacts=[[],[]];E.advance(s,1);w.controls.focus(p.x-40,p.z,240);w.controls.update(3);w.sync();w.post.render(w.scene,w.camera,w.elapsed);let drawn=false;for(const pool of w.infantry.pools.values())if(pool.body.userData.unitIds.slice(0,pool.body.count).includes(hidden.id))drawn=true;return {visible:E.groundVisible(s,0,hidden),drawn,contacts:s.contacts[0].length,contactRings:w.contactRings.count};}''')
    assert not report['concealment']['visible'] and not report['concealment']['drawn']
    assert report['concealment']['contacts']>0 and report['concealment']['contactRings']>0
    page.screenshot(path=str((ARTIFACTS/'infantry8-ambush.png')),timeout=120000)
    print('Camouflaged shooter body is absent; uncertain return-fire marker is rendered',flush=True)
    report['mog']=page.evaluate('''()=>{const w=skyfront.getWorld(),E=skyfront.engine,s=E.createGame(819);s.ai.nextBuild=s.ai.nextAttack=s.ai.nextResearch=s.ai.nextArmy=1e9;for(const f of s.sides){f.credits=50000;f.materials=5000;f.tech=Object.keys(E.TECH);}const b=E.build(s,0,'gun',-450,0);b.progress=1;b.hp=b.maxHp;const m=E.makeGround(s,0,'mog',-420,50);m.setup=1;s.groundUnits.push(m);const site=E.build(s,1,'launcher',-180,10);site.progress=1;site.hp=site.maxHp;s.sides[1].inventory.heavy=1;E.launch(s,1,'heavy',{x:-650,z:10});const u=s.units[0];Object.assign(u,{route:null,startX:0,startZ:10,tx:-650,tz:10,total:650,travelled:300,speed:.001,hp:100000,maxHp:100000,delay:0});E.advance(s,7);Object.assign(w.state,s);w.previousSimTime=s.time;w.controls.focus(-430,10,100);w.controls.update(3);w.sync();w.combatFX.emit(s,.1);w.combatFX.update(.1,w.elapsed,w.camera);w.post.render(w.scene,w.camera,w.elapsed);return {shots:s.stats.shots,staticHeat:b.heat,mobileHeat:m.heat,staticRounds:b.groundAmmo,mobileRounds:m.groundAmmo,tracers:w.combatFX.diagnostics().tracerSegments};}''')
    assert report['mog']['shots']>20 and report['mog']['mobileHeat']>0
    page.screenshot(path=str((ARTIFACTS/'infantry8-mog.png')),timeout=120000)
    before=page.evaluate('skyfront.diagnostics().memory')
    page.evaluate('''()=>{const w=skyfront.getWorld();for(let i=0;i<50;i++)w.explosion(-400+i%8,2,30,1);w.combatFX.update(.05,w.elapsed,w.camera);w.post.render(w.scene,w.camera,w.elapsed);}''')
    after=page.evaluate('skyfront.diagnostics().memory');assert before==after
    report['explosionMemory']={'before':before,'after':after};assert not report['errors'] and not report['consoleErrors'],report
    ((ARTIFACTS/'combat8-report.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('MOG crews, shared ammunition, heat and 50 pooled explosions passed without shader/JS errors',flush=True)
    browser.close()

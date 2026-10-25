"""Compact real inspector DOM and one offline full-game smoke, in isolated Chrome."""
import argparse,json,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
from support import ROOT,ARTIFACTS,launch_browser

ENTRY=r'''
import * as E from '../../src/game/index.js';
import {gameLayout} from '../../src/ui/layout.js';
import {renderInspector} from '../../src/ui/inspector.js';
import {upgradeable} from '../../src/game/combat/upgrades.js';
document.body.innerHTML=gameLayout(false);
for(const id of ['welcome','result','paused'])document.getElementById(id).hidden=true;
let context;let cycle=0;
function show(key,ground=false,level=0,side=0){
 const state=E.createGame(8102+cycle++,{mode:'coop'});state.sides[0].credits=20000;state.sides[0].materials=2000;
 let entity;
 if(ground){entity=E.makeGround(state,side,key,-1100,250);entity.level=level;state.groundUnits.push(entity);}
 else if(key==='road')entity=state.roads.find(r=>r.side===side);
 else if(key==='hq')entity=state.buildings.find(b=>b.side===side&&b.key==='hq');
 else{const d=E.BUILDINGS[key];entity={id:state.nextId++,key,side,x:-1080,z:-10,hp:d.hp,maxHp:d.hp,progress:1,level,queue:[],cooldown:0};state.buildings.push(entity);}
 context={state,selected:entity.id,armySelection:ground&&side===0?[entity.id]:[]};renderInspector(context);return entity.id;
}
window.inspectorTest={show,E,render:()=>renderInspector(context),get:()=>context,keys:['hq','road',...Object.keys(E.BUILDINGS).filter(k=>!E.BUILDINGS[k].retired)],upgradeableBuildings:Object.keys(E.BUILDINGS).filter(key=>upgradeable({key})),upgradeableGround:Object.keys(E.GROUND_UNITS).filter(key=>upgradeable({key}))};
setInterval(()=>{if(context)renderInspector(context);},350);
'''

def bundle():
 entry=ARTIFACTS/'inspector-entry.mjs';entry.write_text(ENTRY,encoding='utf8')
 script="import{build}from'esbuild';const r=await build({entryPoints:[process.argv[1]],bundle:true,write:false,format:'iife',platform:'browser'});process.stdout.write(r.outputFiles[0].text);"
 return subprocess.check_output(['node','--input-type=module','-e',script,str(entry)],cwd=ROOT).decode('utf8')

def run_dom(p):
 css='\n'.join((ROOT/'src/ui'/name).read_text(encoding='utf8') for name in ['style.css','army.css','multiplayer.css','districts.css','recruitment.css','frontline.css'])
 browser=p.chromium.launch(channel='chrome',headless=True,args=['--disable-gpu'])
 report={'cards':0,'screens':[],'errors':[]}
 try:
  page=browser.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
  page.set_content('<style>'+css+'</style>');page.add_script_tag(content=bundle())
  keys=page.evaluate('inspectorTest.keys');ground=page.evaluate('inspectorTest.upgradeableGround');upgraded=page.evaluate('inspectorTest.upgradeableBuildings')
  for width,height in [(1024,768),(1366,768),(1024,600)]:
   page.set_viewport_size({'width':width,'height':height})
   for key,is_ground in [(k,False) for k in keys]+[(k,True) for k in ground]:
    for level in [0,1,2] if is_ground or key in upgraded else [0]:
     page.evaluate('([key,g,l])=>inspectorTest.show(key,g,l)',[key,is_ground,level])
     host=page.locator('#army-controls' if is_ground else '#inspector')
     assert host.is_visible(),key
     metrics=host.evaluate('el=>{const r=el.getBoundingClientRect();return{scroll:el.scrollHeight-el.clientHeight,top:r.top,bottom:r.bottom}}')
     assert metrics['scroll']<=2,(key,width,height,metrics)
     assert metrics['top']>=0 and metrics['bottom']<=height,(key,width,height,metrics)
     for button in host.locator('[data-upgrade],.inspect-buttons button,.army-primary-orders button').all():
      if not button.is_visible():continue
      r=button.bounding_box();assert r['y']>=0 and r['y']+r['height']<=height,(key,r)
     details=host.locator('.inspector-more,.army-details')
     if details.count():
      assert not details.evaluate('e=>e.open'),key
      details.locator('summary').click()
      panel=details.locator(':scope > div')
      m=panel.evaluate('e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,scroll:e.scrollHeight-e.clientHeight}}')
      assert m['top']>=0 and m['bottom']<=height,(key,width,height,m)
      if height==768:assert m['scroll']<=2,(key,width,height,m)
      covered=host.evaluate("h=>[...h.querySelectorAll('.inspect-upgrade-row button,.inspect-buttons button,.army-primary-orders button')].filter(b=>b.getClientRects().length).filter(b=>{const r=b.getBoundingClientRect();return !b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}).map(b=>b.textContent)")
      assert not covered,(key,width,height,covered)
      page.wait_for_timeout(10)
      assert details.evaluate('e=>e.open')
     report['cards']+=1
   report['screens'].append([width,height])
  # Poll preserves the live button, open details and native dropdown focus.
  page.evaluate("inspectorTest.show('factory');window.keptButton=document.querySelector('#inspector [data-upgrade]')")
  page.locator('#inspector summary').click();page.evaluate("window.snapshotPoll=setInterval(()=>{const c=inspectorTest.get();c.state=structuredClone(c.state);c.state.time+=.1;inspectorTest.render();},100)");page.wait_for_timeout(1150)
  assert page.evaluate("document.querySelector('#inspector details').open&&keptButton===document.querySelector('#inspector [data-upgrade]')")
  page.evaluate("const body=document.querySelector('.inspector-details-body');window.scrollProbe=document.createElement('div');scrollProbe.style.height='1000px';body.append(scrollProbe);body.scrollTop=45")
  page.wait_for_timeout(500);assert page.locator('.inspector-details-body').evaluate('e=>e.scrollTop')==45
  page.evaluate("scrollProbe.remove();clearInterval(snapshotPoll);inspectorTest.show('barracks');document.querySelector('#rally-mode').focus();document.querySelector('#rally-mode').value='attack';window.snapshotPoll=setInterval(()=>{const c=inspectorTest.get();c.state=structuredClone(c.state);c.state.time+=.1;inspectorTest.render();},100)")
  page.wait_for_timeout(800);assert page.evaluate("document.activeElement.id==='rally-mode'&&document.activeElement.value==='attack'")
  # Same campaign, selection away and back: retain disclosure state.
  page.evaluate("()=>{const c=inspectorTest.get();window.first=c.selected;c.state.buildings.push({id:900,key:'power',side:0,x:-1200,z:0,hp:180,maxHp:180,progress:1});document.querySelector('#inspector details').open=true;inspectorTest.render();c.selected=900;inspectorTest.render();c.selected=first;inspectorTest.render();}")
  assert page.locator('#inspector details').evaluate('e=>e.open')
  page.evaluate("clearInterval(snapshotPoll);inspectorTest.show('mog',true);window.keptArmy=document.querySelector('#army-controls [data-upgrade]');document.querySelector('.army-details').open=true;document.querySelector('#formation').focus();window.snapshotPoll=setInterval(()=>{const c=inspectorTest.get();c.state=structuredClone(c.state);c.state.time+=.1;inspectorTest.render();},100)")
  page.wait_for_timeout(1150)
  assert page.evaluate("document.querySelector('.army-details').open&&keptArmy===document.querySelector('#army-controls [data-upgrade]')&&document.activeElement.id==='formation'")
  page.evaluate("clearInterval(snapshotPoll);inspectorTest.show('factory',false,0,2)")
  assert page.locator('#inspector [data-upgrade],#inspector [data-repair],#inspector [data-demolish],#inspector [data-service-enabled]').count()==0
  assert not report['errors'],report['errors']
  page.screenshot(path=str(ARTIFACTS/'inspector-compact-8102.png'))
 finally:browser.close()
 return report

def run_game(p):
 browser=launch_browser(p)
 try:
  page=browser.new_page(viewport={'width':1024,'height':768},offline=True)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_default_timeout(90000)
  page.goto((ARTIFACTS/'inspector-8102.html').as_uri(),wait_until='load',timeout=120000)
  page.wait_for_function('Boolean(window.skyfront)')
  page.locator('[data-action="start"]').click();page.keyboard.press('Space')
  ids=page.evaluate('''()=>{
   const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(810291);
   s.mode='multiplayer';s.sides[0].credits=30000;s.sides[0].materials=4000;
   const ready=(key,x,z)=>{const b=E.build(s,0,key,x,z);if(typeof b==='string')throw Error(key+': '+b);b.hp=b.maxHp;b.progress=1;return b;};
   const factory=ready('factory',-1080,-10),barracks=ready('barracks',-960,-80);E.buildRoad(s,0,-1105,-45,-1240,-45);const service=ready('service',-1200,-10);
   const mog=E.makeGround(s,0,'mog',-1150,250);s.groundUnits.push(mog);
   Object.assign(w.state,s);w.sync();return{factory:factory.id,barracks:barracks.id,service:service.id,mog:mog.id};
  }''')
  for name in ['factory','service','barracks']:
   page.evaluate('id=>skyfront.select(id)',ids[name]);page.wait_for_timeout(400)
   card=page.locator('#inspector');assert card.is_visible()
   assert card.evaluate('e=>e.scrollHeight<=e.clientHeight+2')
   page.locator('#inspector summary').click();page.wait_for_timeout(800)
   assert page.locator('#inspector details').evaluate('e=>e.open')
   assert page.locator('.inspector-details-body').evaluate('e=>e.scrollHeight<=e.clientHeight+2')
   r=card.bounding_box();dock=page.locator('.dock').bounding_box()
   assert r['y']>=80 and r['y']+r['height']<=dock['y']+2,(name,r,dock)
  # The actual app delegation charges the selected object and leaves the panel usable.
  page.evaluate('id=>skyfront.select(id)',ids['factory'])
  page.locator(f'#inspector [data-upgrade="{ids["factory"]}"]').click()
  page.wait_for_function('id=>skyfront.getState().buildings.find(b=>b.id===id).level===1',arg=ids['factory'])
  assert page.locator('#inspector details').evaluate('e=>e.open')
  page.evaluate('id=>skyfront.selectArmy([id])',ids['mog'])
  page.locator(f'#army-controls [data-upgrade="{ids["mog"]}"]').click()
  page.wait_for_function('id=>skyfront.getState().groundUnits.find(u=>u.id===id).level===1',arg=ids['mog'])
  page.locator('.army-details summary').click();page.wait_for_timeout(800)
  assert page.locator('.army-details').evaluate('e=>e.open')
  assert page.locator('.army-details > div').evaluate('e=>e.scrollHeight<=e.clientHeight+2')
  page.screenshot(path=str(ARTIFACTS/'inspector-real-hud-8102.png'))
  assert not errors,errors
  return {'upgradeBuilding':True,'upgradeMOG':True,'errors':errors}
 finally:browser.close()

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--full-game',action='store_true');args=parser.parse_args()
 with sync_playwright() as p:
  report=run_dom(p)
  if args.full_game:report['realHUD']=run_game(p)
 (ARTIFACTS/'inspector-compact-8102.json').write_text(json.dumps(report,indent=2),encoding='utf8')
 print(json.dumps(report))

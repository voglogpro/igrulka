"""8.12 full-3D functional QA: physical depot layers, combat, manual override and retake.

Controlled fixtures use ordinary unit HP/weapons and rich economies. Simulation
is advanced in small real steps while the UI is paused; this is not an FPS test.
"""
import contextlib
import ctypes
import json
import os
import re
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser


if os.name == 'nt':
    ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)

game = ROOT / 'play' / 'Skyfront.html'
title = re.search(r'<title>(.*?)</title>', game.read_text(encoding='utf8'), re.DOTALL).group(1)
assert '8.12.0' in title, title
report = {
    'title': title,
    'errors': [],
    'consoleErrors': [],
    'conditions': 'Isolated offline Chrome; SwiftShader; full 3D. Rich economy, AI disabled, '
                  'ordinary HP/weapons. Hold fire only during controlled role deployment. '
                  'No teleport after assignment. Functional QA, no FPS claim.',
}

with sync_playwright() as p:
    browser = launch_browser(p)
    page = None
    try:
        page = browser.new_page(viewport={'width': 1280, 'height': 800}, offline=True)
        page.set_default_timeout(90000)
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.on('console', lambda message: report['consoleErrors'].append(message.text[:2000])
                if message.type == 'error' or 'GL_INVALID_' in message.text or 'GL_OUT_OF_MEMORY' in message.text else None)
        page.goto(game.as_uri(), wait_until='load', timeout=180000)
        page.wait_for_function('Boolean(window.skyfront) && skyfront.getWorld().shadersReady')
        page.locator('[data-action="start"]').click()
        if not page.evaluate('skyfront.isPaused()'):
            page.keyboard.press('Space')
        assert page.evaluate('skyfront.isPaused()')
        page.evaluate('''()=>{
          window.depotQA={positions:new Map(),seen:new Set(),steps:0,invalid:[],jumps:[],shots:{},destroyed:[]};
          window.depotQAReset=()=>{const q=window.depotQA,s=skyfront.getState();
            q.positions=new Map(s.groundUnits.map(u=>[u.id,[u.x,u.z]]));q.seen=new Set(s.events.map(e=>e.id));};
          window.depotQAAdvance=seconds=>{
            const E=skyfront.engine,w=skyfront.getWorld(),s=w.state,q=window.depotQA;
            for(let elapsed=0;elapsed<seconds-1e-8;elapsed+=.05){
              const dt=Math.min(.05,seconds-elapsed);E.step(s,dt);q.steps++;
              for(const u of s.groundUnits){const before=q.positions.get(u.id),d=E.GROUND_UNITS[u.key];
                if(before&&Math.hypot(u.x-before[0],u.z-before[1])>d.speed*dt*1.3+1e-5)
                  q.jumps.push({id:u.id,key:u.key,from:[...before],to:[u.x,u.z],time:s.time});
                if(!u.carrierId&&!E.walkable(s,u.x,u.z,d.size*.42))
                  q.invalid.push({id:u.id,key:u.key,x:u.x,z:u.z,time:s.time});
                if(before){before[0]=u.x;before[1]=u.z;}else q.positions.set(u.id,[u.x,u.z]);
              }
              for(const e of s.events){if(q.seen.has(e.id))continue;q.seen.add(e.id);
                if(e.type==='shot')q.shots[e.side]=(q.shots[e.side]||0)+1;
                if(e.type==='groundDestroyed')q.destroyed.push({id:e.unitId,side:e.side,key:e.key,time:e.time});}
            }
            w.sync();return {time:s.time,steps:q.steps,invalid:q.invalid.length,jumps:q.jumps.length,
              shots:{...q.shots},destroyed:q.destroyed.length};
          };
        }''')
        report['fixture'] = page.evaluate('''()=>{
          const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(812,{mode:'multiplayer'});
          s.rules.rear=false;s.rules.oil=false;s.weather.kind='clear';s.weather.amount=0;
          for(const f of s.sides){f.credits=100000;f.materials=10000;f.oil=10000;}
          for(const d of s.districts){d.owner=0;d.control=1;d.capturing=null;d.hp=E.DISTRICTS.find(v=>v.id===d.id).hp;}
          const keys=[...Array(12).fill('infantry'),'atrifle','atgm','mog','mog','leopard','leopard',
            'howitzer','howitzer','sniper','sniper'],ids=[];
          for(const sign of [-1,1])for(let i=0;i<keys.length;i++){
            const u=E.makeGround(s,0,keys[i],-300-(i%4)*18,sign*(1280+Math.floor(i/4)*22));
            u.holdFire=true;s.groundUnits.push(u);ids.push(u.id);
          }
          const accepted=E.applyStance(s,0,ids,{mode:'defend',post:'auto'});
          Object.assign(w.state,s);w.previousSimTime=s.time;w.sync();depotQAReset();
          return {accepted,count:ids.length,initialPaths:s.groundUnits.filter(u=>u.path.length).length,
            ordinary:s.groundUnits.every(u=>u.maxHp===E.GROUND_UNITS[u.key].hp&&u.hp===u.maxHp&&u.level===0),
            initial:s.groundUnits.map(u=>({id:u.id,key:u.key,x:u.x,z:u.z,hp:u.hp}))};
        }''')
        assert report['fixture']['accepted'] == report['fixture']['count'] == 44
        assert report['fixture']['initialPaths'] == 0 and report['fixture']['ordinary']
        print('44 ordinary mixed units accepted automatic defence; waiting for physical deployment', flush=True)
        page.evaluate('depotQAAdvance(5)')

        # Select an actually marching soldier through the real 3D raycast and click Stop.
        report['nativePick'] = page.evaluate('''()=>{
          const w=skyfront.getWorld(),E=skyfront.engine,
            u=w.state.groundUnits.find(u=>u.key==='infantry'&&u.path.length&&u.autoDefense);
          if(!u)throw Error('No physically marching infantry available for native selection');
          w.focus(u.x,u.z,210,{instant:true});w.camera.updateMatrixWorld(true);w.sync();w.scene.updateMatrixWorld(true);
          const r=w.renderer.domElement.getBoundingClientRect(),roots=[...[...w.models.values()].map(m=>m.root),
            ...w.groundModels.values(),...w.infantry.meshes,...(w.ammoCrates?.pickTargets||[])].filter(o=>o.visible);
          for(const height of [1.5,2,1,.5,2.5]){
            const v=w.camera.position.clone().set(u.x,E.groundHeight(u.x,u.z)+height,u.z).project(w.camera),
              point={x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};
            if(document.elementFromPoint(point.x,point.y)!==w.renderer.domElement)continue;
            w.pointer.set((point.x-r.left)/r.width*2-1,-(point.y-r.top)/r.height*2+1);w.ray.setFromCamera(w.pointer,w.camera);
            let picked=null;for(const hit of w.ray.intersectObjects(roots,true)){
              let id;if(hit.object.userData.infantryBatch)id=hit.object.userData.unitIds[hit.instanceId];
              else {let o=hit.object;while(o&&!o.userData.buildingId&&!o.userData.groundId)o=o.parent;
                id=o?.userData.buildingId||o?.userData.groundId;}
              if(id&&E.observedTarget(w.state,0,id)){picked=id;break;}}
            if(picked===u.id)return {id:u.id,point,x:u.x,z:u.z,path:u.path.length};
          }throw Error('Marching soldier is not available to the native raycast');
        }''')
        native = report['nativePick']
        page.mouse.click(native['point']['x'], native['point']['y'])
        page.wait_for_function('id=>skyfront.getOrder().armySelection.includes(id)', arg=native['id'])
        page.locator('[data-troop="stop"]').click()
        report['manualStop'] = page.evaluate('''id=>{
          const u=skyfront.getState().groundUnits.find(u=>u.id===id);
          return {x:u.x,z:u.z,path:u.path.length,order:u.order,automatic:u.autoDefense,
            post:u.defensePost,mission:u.defenseMission};
        }''', native['id'])
        assert report['manualStop']['path'] == 0 and report['manualStop']['order'] is None
        assert not report['manualStop']['automatic'] and report['manualStop']['post'] is None
        page.evaluate('depotQAAdvance(10)')
        assert page.evaluate('id=>{const u=skyfront.getState().groundUnits.find(u=>u.id===id);return [u.x,u.z]}', native['id']) == [native['x'], native['z']]
        print('Native 3D selection and Stop cancel automatic movement without reassignment', flush=True)
        page.keyboard.press('Escape')

        report['deployment'] = []
        # A manual stop can rebalance the odd remaining infantry quota and send
        # one late recruit to the other corridor. Allow the real cross-map march;
        # retain the requirement that every assigned unit actually arrives.
        for _ in range(44):
            snapshot = page.evaluate('''()=>{const result=depotQAAdvance(5),s=skyfront.getState();
              return {...result,assigned:s.groundUnits.filter(u=>u.autoDefense&&u.defensePost).length,
                arrived:s.groundUnits.filter(u=>u.autoDefense&&u.guard&&!u.path.length&&Math.hypot(u.x-u.guard.x,u.z-u.guard.z)<=6).length};}''')
            report['deployment'].append(snapshot)
            if snapshot['assigned'] == 43 and snapshot['arrived'] == 43:
                break
        report['layers'] = page.evaluate('''()=>{
          const w=skyfront.getWorld(),s=w.state,own=s.groundUnits.filter(u=>u.autoDefense),groups={};
          for(const id of ['north','south']){const units=own.filter(u=>u.defensePost?.corridorId===id);
            groups[id]={count:units.length,front:units.filter(u=>u.defensePost.row===0).length,
              core:units.filter(u=>[1,2,3].includes(u.defensePost.row)).length,
              reserve:units.filter(u=>u.defensePost.row>=4&&u.key!=='howitzer').length,
              artillery:units.filter(u=>u.key==='howitzer'&&u.defensePost.row>=5).length,
              arrived:units.filter(u=>!u.path.length&&Math.hypot(u.x-u.guard.x,u.z-u.guard.z)<=6).length};}
          w.focus(25,-1360,530,{instant:true});w.sync();
          return {groups,positions:own.map(u=>({id:u.id,key:u.key,x:u.x,z:u.z,guard:u.guard,post:u.defensePost,path:u.path.length})),
            trenches:s.trenches.filter(t=>t.progress>=1).length,rendering:w.fortifications.diagnostics()};
        }''')
        assert sum(group['count'] for group in report['layers']['groups'].values()) == 43
        for group in report['layers']['groups'].values():
            assert group['front'] >= 4 and group['core'] > 0 and group['reserve'] > 0 and group['artillery'] == 2, group
            assert group['arrived'] == group['count'], report['layers']
        assert report['layers']['trenches'] > 0 and report['layers']['rendering']['links']['links'] > 0
        print('All remaining 43 units physically arrived at outer, core, reserve and artillery layers', flush=True)
        page.screenshot(path=str(ARTIFACTS / 'depot812-physical-layers.png'), timeout=120000)

        page.set_viewport_size({'width': 1024, 'height': 600})
        cards = {}
        for label, predicate in [
            ('Внешний рубеж', "u.defensePost.row===0"),
            ('Охрана склада', "[1,2,3].includes(u.defensePost.row)"),
            ('Тыловой резерв', "u.defensePost.row>=4&&u.key!=='howitzer'"),
            ('Огневая поддержка', "u.key==='howitzer'&&u.defensePost.row>=5"),
        ]:
            chosen = page.evaluate('()=>skyfront.getState().groundUnits.find(u=>u.autoDefense&&u.defensePost&&('+predicate+')).id')
            page.evaluate('id=>skyfront.selectArmy([id])', chosen)
            page.wait_for_function('label=>document.querySelector("#ground-state")?.textContent.includes(label)', arg=label)
            cards[label] = page.locator('#army-controls').evaluate('''e=>{const r=e.getBoundingClientRect(),
              stop=e.querySelector('[data-troop="stop"]').getBoundingClientRect();
              return {top:r.top,bottom:r.bottom,scroll:e.scrollHeight-e.clientHeight,
                stop:{top:stop.top,bottom:stop.bottom},text:e.querySelector('#ground-state').textContent};}''')
            assert cards[label]['top'] >= 0 and cards[label]['bottom'] <= 600.5, cards[label]
            assert cards[label]['scroll'] <= 2 and cards[label]['stop']['bottom'] <= 600.5, cards[label]
        report['compactCards'] = cards
        print('Four role labels and directly reachable actions fit 1024x600 without main-card scrolling', flush=True)
        page.screenshot(path=str(ARTIFACTS / 'depot812-compact-card.png'), timeout=120000)
        page.set_viewport_size({'width': 1280, 'height': 800})
        page.keyboard.press('Escape')

        report['battleFixture'] = page.evaluate('''()=>{
          const E=skyfront.engine,w=skyfront.getWorld(),s=w.state,ids=[];
          for(const u of s.groundUnits)if(u.side===0&&u.defensePost?.corridorId==='north')u.holdFire=false;
          for(const [key,x,z]of [['infantry',180,-1320],['infantry',180,-1340],['infantry',180,-1380],
            ['infantry',180,-1400],['lighttank',230,-1360],['sniper',260,-1450]]){
            const u=E.makeGround(s,1,key,x,z);s.groundUnits.push(u);ids.push(u.id);
            const accepted=E.orderGround(s,1,[u.id],{x:-40,z:-1360,mode:'attackmove'});
            if(typeof accepted!=='number')throw Error(accepted);
          }
          w.focus(100,-1360,470,{instant:true});w.sync();
          return {ids,ordinary:s.groundUnits.filter(u=>ids.includes(u.id)).every(u=>u.hp===E.GROUND_UNITS[u.key].hp&&u.level===0)};
        }''')
        assert report['battleFixture']['ordinary']
        for _ in range(24):
            page.evaluate('depotQAAdvance(.25)')
        report['battle'] = page.evaluate('''ids=>{const s=skyfront.getState(),q=depotQA;return{
          shots:{...q.shots},destroyed:q.destroyed,remaining:s.groundUnits.filter(u=>ids.includes(u.id)).map(u=>({id:u.id,key:u.key,hp:u.hp,maxHp:u.maxHp})),
          ownDamaged:s.groundUnits.filter(u=>u.side===0&&u.hp<u.maxHp).length,
          enemyLosses:s.sides[1].losses,owner:s.districts.find(d=>d.id==='north-depot').owner};}''', report['battleFixture']['ids'])
        assert report['battle']['shots'].get('0', 0) > 0 and report['battle']['shots'].get('1', 0) > 0, report['battle']
        assert report['battle']['enemyLosses'] > 0 or any(u['hp'] < u['maxHp'] for u in report['battle']['remaining']), report['battle']
        print('Ordinary opposing units exchanged real shots and damage around the depot', flush=True)
        page.screenshot(path=str(ARTIFACTS / 'depot812-real-firefight.png'), timeout=120000)

        # Fresh controlled four-city state: an empty enemy-owned depot must be
        # neutralized and captured by troops that physically enter its circle.
        report['retakeFixture'] = page.evaluate('''()=>{
          const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(8121,{mode:'coop'});
          s.mode='multiplayer';s.rules.rear=false;s.rules.oil=false;s.weather.kind='clear';s.weather.amount=0;
          for(const f of s.sides){f.credits=100000;f.materials=10000;f.oil=10000;}
          const target=s.districts.find(d=>d.id==='north-depot');target.owner=1;target.control=-1;
          const ids=[];for(let i=0;i<14;i++){const u=E.makeGround(s,0,'infantry',-210-(i%4)*14,-1280-Math.floor(i/4)*18);
            s.groundUnits.push(u);ids.push(u.id);}
          const accepted=E.applyStance(s,0,ids,{mode:'defend',post:'auto'});
          Object.assign(w.state,s);w.previousSimTime=s.time;w.focus(0,-1360,470,{instant:true});w.sync();depotQAReset();
          return {owner:target.owner,accepted,ordinary:s.groundUnits.every(u=>u.maxHp===E.GROUND_UNITS[u.key].hp)};
        }''')
        assert report['retakeFixture'] == {'owner': 1, 'accepted': 14, 'ordinary': True}
        report['retake'] = []
        for _ in range(40):
            snapshot = page.evaluate('''()=>{const r=depotQAAdvance(3),E=skyfront.engine,s=skyfront.getState(),
              d=E.DISTRICTS.find(d=>d.id==='north-depot'),v=s.districts.find(v=>v.id===d.id);
              return {...r,owner:v.owner,control:v.control,capturing:v.capturing,
                jobs:s.groundUnits.filter(u=>u.defenseCapture?.districtId===d.id).length,
                physicallyInside:s.groundUnits.filter(u=>u.side===0&&Math.hypot(u.x-d.x,u.z-d.z)<=d.radius).length};}''')
            report['retake'].append(snapshot)
            if snapshot['jobs'] and 'captureLabel' not in report:
                capture_id = page.evaluate('skyfront.getState().groundUnits.find(u=>u.defenseCapture?.districtId==="north-depot").id')
                page.evaluate('id=>skyfront.selectArmy([id])', capture_id)
                page.wait_for_function('document.querySelector("#ground-state")?.textContent.includes("Захват склада")')
                report['captureLabel'] = page.locator('#ground-state').inner_text()
            if snapshot['owner'] == 0:
                break
        assert report['retake'][-1]['owner'] == 0 and report['retake'][-1]['physicallyInside'] > 0, report['retake']
        assert 'captureLabel' in report
        page.keyboard.press('Escape')
        page.screenshot(path=str(ARTIFACTS / 'depot812-retaken-warehouse.png'), timeout=120000)
        report['physicalChecks'] = page.evaluate('''()=>({steps:depotQA.steps,invalid:depotQA.invalid,jumps:depotQA.jumps,
          glError:skyfront.getWorld().renderer.getContext().getError(),shaderWarmup:skyfront.getWorld().shaderWarmupStatus})''')
        assert not report['physicalChecks']['invalid'] and not report['physicalChecks']['jumps'], report['physicalChecks']
        assert report['physicalChecks']['glError'] == 0
        assert not report['errors'] and not report['consoleErrors'], report
        report['passed'] = True
        print('Full 3D 8.12 physical depot layers, native manual stop, compact role labels, real firefight and physical retake passed', flush=True)
    except Exception as error:
        report['passed'] = False
        report['failure'] = str(error)
        if page:
            with contextlib.suppress(Exception):
                page.screenshot(path=str(ARTIFACTS / 'depot812-failure.png'), timeout=30000)
        raise
    finally:
        browser.close()
        (ARTIFACTS / 'depot812-browser.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')

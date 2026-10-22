"""Comparable render/CPU timings; software GPU results are not hardware FPS claims."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

target = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT/'play/Skyfront.html'
label = sys.argv[2] if len(sys.argv) > 2 else 'current'
report = {'label':label,'viewport':[1280,720],'deviceScaleFactor':1,'samples':60,'visualSeed':830,'errors':[],'scenes':[]}
with sync_playwright() as p:
    browser = launch_browser(p)
    page = browser.new_page(viewport={'width':1280,'height':720}, device_scale_factor=1, offline=True)
    page.set_default_timeout(120000)
    page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.goto(target.as_uri(),wait_until='load',timeout=180000)
    page.wait_for_function('Boolean(window.skyfront)')
    page.evaluate('''()=>{const w=skyfront.getWorld();cancelAnimationFrame(w.frame);w.renderer.getContext().finish();}''')
    for scene in ['city','army','explosions']:
        result = page.evaluate('''async scene=>{
          const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(830);
          s.mode='multiplayer';s.sides.forEach(f=>{f.credits=50000;f.materials=5000;f.tech=Object.keys(E.TECH);});
          for(let row=0;row<4;row++)for(let col=0;col<6;col++){
            const key=['housing','industry','power','factory','lab','barracks'][(row+col)%6],d=E.BUILDINGS[key];
            s.buildings.push({id:s.nextId++,side:0,key,x:-730+col*65,z:-180+row*68,hp:d.hp,maxHp:d.hp,progress:1,rotation:0,queue:[]});
          }
          if(scene!=='city')for(let side=0;side<2;side++){
            for(let i=0;i<60;i++){const u=E.makeGround(s,side,['infantry','machinegunner','assault','sniper','engineer','operator'][i%6],-665+(i%12)*13,-40+Math.floor(i/12)*16+side*95);u.moving=true;s.groundUnits.push(u);}
            for(let i=0;i<6;i++)s.groundUnits.push(E.makeGround(s,side,['leopard','apc','mog','gepard','shilka','leopard'][i],-680+i*43,-220+side*420));
          }
          Object.assign(w.state,s);w.previousSimTime=s.time;w.battleTime=0;w.visualDt=0;w.elapsed=0;
          const nativeRandom=Math.random;let visualSeed=830;
          Math.random=()=>{visualSeed=(Math.imul(visualSeed,1664525)+1013904223)>>>0;return visualSeed/4294967296;};
          w.focus(-540,-40,360);w.controls.update(3);w.sync();w.updateDaylight();
          if(scene==='explosions')for(let i=0;i<24;i++)w.combatFX.explode(-650+(i%6)*40,2,-60+Math.floor(i/6)*32,.6);
          const gl=w.renderer.getContext(),stat=a=>({median:a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)],p95:a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*.95))]});
          const sync=[],draw=[],shadow=[];
          for(let i=0;i<8;i++){w.post.render(w.scene,w.camera,w.elapsed);gl.finish();}
          for(let i=0;i<60;i++){
            w.visualDt=1/60;w.battleTime+=1/60;w.elapsed+=1/60;
            let t=performance.now();w.sync();w.combatFX.update(1/60,w.elapsed,w.camera);sync.push(performance.now()-t);
            t=performance.now();w.renderInfo=w.post.render(w.scene,w.camera,w.elapsed);gl.finish();draw.push(performance.now()-t);
          }
          for(let i=0;i<6;i++){w.renderer.shadowMap.needsUpdate=true;let t=performance.now();w.post.render(w.scene,w.camera,w.elapsed);gl.finish();shadow.push(performance.now()-t);}
          const cpuState=E.load(E.save(s)),step=[];
          for(let i=0;i<30;i++){const t=performance.now();E.step(cpuState,.05);step.push(performance.now()-t);}
          Math.random=nativeRandom;
          return{scene,syncMs:stat(sync),drawMs:stat(draw),shadowFrameMs:stat(shadow),simulationStepMs:stat(step),diagnostics:w.diagnostics(),pixelRatio:w.renderer.getPixelRatio()};
        }''',scene)
        report['scenes'].append(result)
        print(json.dumps({k:result[k] for k in ['scene','syncMs','drawMs','shadowFrameMs','simulationStepMs','pixelRatio']}),flush=True)
    assert not report['errors'],report['errors']
    (ARTIFACTS/f'performance-{label}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    browser.close()

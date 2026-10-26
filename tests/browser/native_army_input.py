"""Native pointer input through real UI/camera/command modules, without WebGL.

Optional: --baseline-root path/to/igrulka-8111-ready
Measures click-handler work, not game FPS or the cost of scene picking/shadows.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import subprocess
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS

if os.name == 'nt':
    from ctypes import wintypes
    ctypes.windll.kernel32.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)


def lower_owned_tree():
    if os.name != 'nt':
        return
    script = '''$all=@(Get-CimInstance Win32_Process);$ids=[System.Collections.Generic.HashSet[int]]::new();[void]$ids.Add(ROOT_PID);do{$changed=$false;foreach($proc in $all){if($ids.Contains([int]$proc.ParentProcessId)-and$ids.Add([int]$proc.ProcessId)){$changed=$true}}}while($changed);foreach($ownedId in $ids){try{$p=Get-Process -Id $ownedId -ErrorAction Stop;$p.PriorityClass='BelowNormal'}catch{}}'''.replace('ROOT_PID', str(os.getpid()))
    subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
                   creationflags=subprocess.CREATE_NO_WINDOW, check=True, capture_output=True)


ENTRY = r'''
import * as E from GAME;
import * as T from THREE;
import {gameLayout} from LAYOUT;
import {renderInspector} from INSPECTOR;
import {renderSquadRoster} from ROSTER;
import {resolveArmySelection} from SELECTION;
import {createCommandExecutor} from EXECUTOR;
import {executeCommand} from COMMANDS;
import {createCampaignStore} from STORE;
import {FixedCamera} from CAMERA;
import {bindMinimap} from EVENTS;
import {pointerUp,groundPoint} from POINTER;
AUTOSAVE_IMPORT
document.body.innerHTML=gameLayout(false);
for(const id of ['welcome','result','paused','panel'])document.getElementById(id).hidden=true;
const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
document.querySelector('#world').append(canvas);
const camera=new T.PerspectiveCamera(50,1280/720,1,10000),controls=new FixedCamera(camera,canvas);
let state,selection=[],world,epoch=0,saveCount=0;
const qa={results:{},longtasks:[],errors:[],started:Infinity,simulationPaused:true};
const capture=(kind,value)=>{(qa.results[kind]||=[]).push(value);};
new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.startTime>=qa.started)qa.longtasks.push({at:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:false});
const execute=createCommandExecutor({getState:()=>state,getSession:()=>null,getEpoch:()=>0,executeLocal:executeCommand});
const store=createCampaignStore({storage:localStorage,game:E,notify:(text)=>qa.errors.push(text),reload:()=>{throw Error('Unexpected reload');}});
const persistNow=()=>{const start=performance.now();store.persist(state);saveCount++;capture('backgroundSaves',{ms:performance.now()-start,time:state.time,units:state.groundUnits.length});};
AUTOSAVE_INIT
function inspect(){renderInspector({state,selected:selection[0]??null,armySelection:selection});}
function select(ids){selection=resolveArmySelection(state,ids);world.selected=selection[0]??null;world.armySelection=selection;inspect();renderSquadRoster(state,selection);}
async function order(point){
 const start=performance.now(),requested=selection.length;
 const accepted=await execute('order',{ids:[...selection],aim:{...point,mode:'attackmove'}});
 const commandDone=performance.now(),beforeSaveCount=saveCount;autosave.request();const saved=performance.now();inspect();
 capture('orders',{ms:performance.now()-start,commandMs:commandDone-start,saveRequestMs:saved-commandDone,inlineSerializations:saveCount-beforeSaveCount,accepted,requested,point});
}
canvas.addEventListener('pointerdown',event=>{
 if(event.button!==0)return;
 world.down={x:event.clientX,y:event.clientY,ground:world.groundPoint(event)};
});
canvas.addEventListener('pointerup',async event=>{
 const start=performance.now();await pointerUp.call(world,event);
 capture('mapPointer',{ms:performance.now()-start,trusted:event.isTrusted});
});
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||button.disabled)return;
 const start=performance.now();
 if(button.dataset.armyRole){select(state.groundUnits.filter(u=>u.side===0&&u.hp>0&&u.key===button.dataset.armyRole).map(u=>u.id));capture('role',{ms:performance.now()-start,count:selection.length,trusted:event.isTrusted});}
 if(button.dataset.squad){select(E.squadRoster(state,0).find(group=>group.id===Number(button.dataset.squad))?.ids||[]);capture('wave',{ms:performance.now()-start,count:selection.length,trusted:event.isTrusted});}
});
bindMinimap(document.querySelector('#minimap'),{
 focusInput:()=>controls.focusInput(),map:E.MAP,
 focus:(x,z)=>{const start=performance.now();controls.focus(x,z,undefined,{instant:true});capture('minimap',{ms:performance.now()-start,x,z,zoom:controls.distance});}
});
Object.assign(qa,{
 setup(count){
  autosave.cancel();epoch++;
  state=E.createGame(81202,{mode:'multiplayer'});state.rules.rear=false;selection=[];
  for(let i=0;i<count;i++){
   const u=E.makeGround(state,0,'machinegunner',-1200+(i%20)*8,-180+Math.floor(i/20)*6);
   u.squadId=10000+Math.floor(i/5);state.groundUnits.push(u);
  }
  const ids=state.groundUnits.map(u=>u.id);for(let n=1;n<=9;n++)state.groups[0][n]=ids.slice();
  world={state,selected:null,armySelection:selection,controls,camera,renderer:{domElement:canvas},
   pointer:new T.Vector2(),ray:new T.Raycaster(),plane:new T.Plane(new T.Vector3(0,1,0),0),
   models:new Map(),groundModels:new Map(),infantry:{meshes:[]},keys:{},selectionBox:{hidden:true},
   callbacks:{isModal:()=>false,onGroundOrder:point=>order(point)},groundPoint};
  renderSquadRoster(state,[]);controls.focus(850,-1350,500,{instant:true});
 },
 begin(){qa.results={};qa.longtasks=[];qa.started=performance.now();},
 aim(){controls.focus(850,-1350,500,{instant:true});},
 markLatest(){state.time=123;autosave.request();},
 autosavePending(){return autosave.pending;},
 saved(){const raw=JSON.parse(localStorage.getItem('skyfront-realtime-v3'));return {time:raw.time,units:raw.groundUnits.length,ordered:raw.groundUnits.filter(u=>u.order?.mode==='attackmove').length};},
 status(){return {selected:selection.length,units:state.groundUnits.length,ordered:state.groundUnits.filter(u=>u.order?.mode==='attackmove').length,pending:state.groundUnits.filter(u=>u.routeState).length,goal:controls.target.toArray(),zoom:controls.distance};},
});
window.inputQA=qa;
'''


def bundle(source_root, label):
    paths = {
        'GAME': 'src/game/index.js', 'THREE': 'vendor/three/three.module.js', 'LAYOUT': 'src/ui/layout.js',
        'INSPECTOR': 'src/ui/inspector.js', 'ROSTER': 'src/ui/deployment.js', 'SELECTION': 'src/ui/selection.js',
        'EXECUTOR': 'src/ui/session/command-executor.js', 'COMMANDS': 'src/network/commands.js',
        'STORE': 'src/ui/session/campaign-store.js', 'CAMERA': 'src/rendering/camera.js',
        'EVENTS': 'src/ui/input/browser-events.js', 'POINTER': 'src/rendering/input/build-tools.js',
    }
    entry = ENTRY
    autosave_path = source_root/'src/ui/session/autosave.js'
    if autosave_path.exists():
        entry = entry.replace('AUTOSAVE_IMPORT', 'import {createAutosave} from '+json.dumps(str(autosave_path).replace('\\', '/'))+';')
        entry = entry.replace('AUTOSAVE_INIT', 'const autosave=createAutosave({getState:()=>state,getEpoch:()=>epoch,getSession:()=>null,persist:persistNow});')
    else:
        entry = entry.replace('AUTOSAVE_IMPORT', '')
        entry = entry.replace('AUTOSAVE_INIT', 'const autosave={request:persistNow,cancel(){},pending:false};')
    for token, relative in paths.items():
        entry = entry.replace('from '+token+';', 'from '+json.dumps(str(source_root/relative).replace('\\', '/'))+';')
    target = ARTIFACTS/f'native-input-{label}-entry.mjs'
    target.write_text(entry, encoding='utf8')
    script = "import{build}from'esbuild';const r=await build({entryPoints:[process.argv[1]],bundle:true,write:false,format:'iife',platform:'browser'});process.stdout.write(r.outputFiles[0].text);"
    code = subprocess.check_output(['node', '--input-type=module', '-e', script, str(target)], cwd=ROOT).decode('utf8')
    css = '\n'.join((source_root/'src/ui'/name).read_text(encoding='utf8') for name in ['style.css', 'army.css', 'recruitment.css'])
    fixture = ARTIFACTS/f'native-input-{label}.html'
    fixture.write_text('<!doctype html><meta charset="utf-8"><style>'+css+'</style><body><script>'+code+'</script>', encoding='utf8')
    return fixture


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline-root', type=Path)
args = parser.parse_args()
report = {
    'conditions': 'Native trusted pointerdown/up/click in Chrome DOM-only. Actual UI, FixedCamera, production groundPoint/pointerUp, executeCommand, production coalesced autosave and isolated localStorage persist. Paused simulation, BelowNormal own process tree.',
    'limitations': ['No WebGL, 3D meshes, detailed raycast targets, shadow redraw, live battle, audio, or network. This is not FPS or a guarantee that every game frame is smooth. Command routes remain pending until simulation resumes. Serialization is moved outside input, not removed; background write durations are reported separately.'],
    'cases': [],
}
targets = ([('baseline', args.baseline_root.resolve())] if args.baseline_root else [])+[('candidate', ROOT)]
previous_report = ARTIFACTS/'native-input-8112.json'
before_report = ARTIFACTS/'native-input-8112-before-autosave.json'
if previous_report.exists() and not before_report.exists():
    before_report.write_bytes(previous_report.read_bytes())
fixtures = [(label, source, bundle(source, label)) for label, source in targets]
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--disable-gpu'])
    try:
        lower_owned_tree()
        for label, source, fixture in fixtures:
            for count in [90, 500]:
                page = browser.new_page(viewport={'width': 1280, 'height': 720}, offline=True)
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.set_default_timeout(30000)
                page.goto(fixture.as_uri())
                page.wait_for_function('Boolean(window.inputQA)')
                page.evaluate('count=>inputQA.setup(count)', count)
                lower_owned_tree()
                page.evaluate('async()=>{await document.fonts.ready;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));inputQA.begin();}')
                print(json.dumps({'label': label, 'count': count, 'phase': 'native input started'}), flush=True)
                for _ in range(3):
                    page.locator('[data-army-role="machinegunner"]').click()
                    page.locator('[data-squad="10000"]').click()
                page.locator('[data-army-role="machinegunner"]').click()
                for n in range(3):
                    page.evaluate('inputQA.aim()')
                    page.locator('#world canvas').click(position={'x': 640, 'y': 360})
                    page.wait_for_function('n=>(inputQA.results.orders?.length||0)===n', arg=n+1)
                status = page.evaluate('inputQA.status()')
                assert status['ordered'] == count, status
                if label == 'candidate':
                    assert status['pending'] == count, status
                    assert all(value['inlineSerializations'] == 0 for value in page.evaluate('inputQA.results.orders'))
                page.evaluate('inputQA.markLatest()')
                minimap = page.locator('#minimap')
                map_rect = minimap.bounding_box()
                for dx, dy in [(.2, .2), (.5, .5), (.8, .8)]:
                    minimap.click(position={'x': map_rect['width']*dx, 'y': map_rect['height']*dy})
                page.wait_for_function('!inputQA.autosavePending()')
                page.wait_for_timeout(100)
                result = page.evaluate('({results:inputQA.results,longtasks:inputQA.longtasks,errors:inputQA.errors,status:inputQA.status(),saved:inputQA.saved()})')
                assert result['saved'] == {'time': 123, 'units': count, 'ordered': count}, result['saved']
                assert all(value['accepted'] == count for value in result['results']['orders']), result
                assert all(value['trusted'] for name in ['role', 'wave', 'mapPointer'] for value in result['results'][name]), result
                assert len(result['results']['minimap']) == 3
                assert all(abs(value['zoom']-500) < 1e-6 for value in result['results']['minimap'])
                assert not errors and not result['errors'], (errors, result['errors'])
                result.update({'label': label, 'source': str(source), 'count': count, 'pageErrors': errors})
                report['cases'].append(result)
                print(json.dumps({'label': label, 'count': count, 'results': result['results'], 'longtasks': result['longtasks']}, ensure_ascii=True), flush=True)
                page.close()
    finally:
        browser.close()
(ARTIFACTS/'native-input-8112-autosave.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print('Native army pointer input passed; own browsers closed.', flush=True)

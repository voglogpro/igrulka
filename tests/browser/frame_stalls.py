"""Natural-frame battle trace in an isolated browser; reports hitches, not an FPS guarantee."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import subprocess
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

if os.name == 'nt':
    ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)


def lower_owned_tree():
    if os.name != 'nt':
        return
    script = '''$all=@(Get-CimInstance Win32_Process);$ids=[System.Collections.Generic.HashSet[int]]::new();[void]$ids.Add(ROOT_PID);do{$changed=$false;foreach($proc in $all){if($ids.Contains([int]$proc.ParentProcessId)-and$ids.Add([int]$proc.ProcessId)){$changed=$true}}}while($changed);foreach($ownedId in $ids){try{$p=Get-Process -Id $ownedId -ErrorAction Stop;$p.PriorityClass='BelowNormal'}catch{}};exit 0'''.replace('ROOT_PID', str(os.getpid()))
    subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
                   creationflags=subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS,
                   check=True, capture_output=True)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--target', type=Path, default=ROOT / 'play/Skyfront.html')
parser.add_argument('--seconds', type=int, default=30, choices=range(5, 121))
parser.add_argument('--units', type=int, default=90, choices=range(10, 2001))
parser.add_argument('--hardware-gpu', action='store_true')
parser.add_argument('--interactions', action='store_true', help='Click toolbar and distant minimap positions during the trace')
parser.add_argument('--label', default='current')
args = parser.parse_args()
assert args.label and all(c.isascii() and (c.isalnum() or c in '-_') for c in args.label)
if args.interactions and args.seconds < 12:
    parser.error('--interactions requires --seconds>=12')
report = {'target': str(args.target.resolve()), 'seconds': args.seconds, 'errors': [], 'consoleErrors': [],
          'conditions': 'Isolated browser; 1280x720; mixed armies; endurance HP10000; AI disabled; '
                        'same MSAA4/pixel ratio1/shadow4096; natural RAF including cold battle startup.'}
with sync_playwright() as playwright:
    if args.hardware_gpu:
        browser = playwright.chromium.launch(
            headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',
            args=['--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
    else:
        browser = launch_browser(playwright)
    try:
        page = browser.new_page(viewport={'width': 1280, 'height': 720}, offline=True)
        page.set_default_timeout(30000)
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.on('console', lambda message: report['consoleErrors'].append(message.text[:2000])
                if message.type == 'error' or 'GL_INVALID_' in message.text or 'GL_OUT_OF_MEMORY' in message.text else None)
        page.goto(args.target.resolve().as_uri(), wait_until='load', timeout=180000)
        page.wait_for_function('Boolean(window.skyfront)')
        page.locator('[data-action="start"]').click()
        page.keyboard.press('Space')
        # Set priorities before starting the trace; polling CIM during it would
        # itself compete with the render/simulation work we intend to measure.
        lower_owned_tree()
        page.evaluate('''count => {
          const E=skyfront.engine,w=skyfront.getWorld(),s=E.createGame(811);
          s.rules.rear=false;s.rules.oil=false;
          s.ai.nextBuild=s.ai.nextAttack=s.ai.nextArmy=1e9;
          const keys=['infantry','infantry','machinegunner','infantry','atgm','leopard','shilka'];
          for(let i=0;i<count;i++){
            const side=i%2,j=Math.floor(i/2),u=E.makeGround(s,side,keys[j%keys.length],
              (side?1:-1)*(60+Math.floor(j/20)*12),-1350+(j%20-10)*10);
            u.hp=u.maxHp=10000;u.guard={x:u.x,z:u.z};u.order={mode:'guard',...u.guard};
            u.guardNextThink=0;u.setup=1;s.groundUnits.push(u);
          }
          Object.assign(w.state,s);w.previousSimTime=0;
          w.focus(0,-1350,600);w.controls.update(3);w.sync();
          w.renderBudget.scale=1;w.renderBudget.observe=()=>false;
          w.shadowBudget.observeFrame=()=>false;w.resizeRender();
          const data=window.frameTrace={frames:[],stages:{},longTasks:[],inputs:[],inputFrames:[],shadowFrames:0,started:performance.now()};
          const wrap=(host,key,label)=>{const fn=host[key];host[key]=function(...a){
            const start=performance.now();try{return fn.apply(this,a);}finally{
              (data.stages[label] ||= []).push(performance.now()-start);
            }
          };};
          wrap(w.callbacks,'onFrame','simulationAndUI');wrap(w,'sync','sceneSync');
          wrap(w.post,'render','renderSubmission');wrap(w,'updateMinimap','minimap');
          const lighting=w.updateDaylight;w.updateDaylight=function(...a){const result=lighting.apply(this,a);if(w.renderer.shadowMap.needsUpdate)data.shadowFrames++;return result;};
          // Capture before application input handlers. Both down and up matter:
          // minimap/click commands can run on release after the initial press.
          // Record the actual callback delay, without extra sync/render/layout.
          for(const type of ['pointerdown','pointerup'])document.addEventListener(type,event=>{
            const at=performance.now(),element=event.target.closest?.('[id],[data-action],[data-tab],[data-panel]'),
              control=element?.id||element?.dataset.action||element?.dataset.tab||element?.dataset.panel||event.target.tagName,
              entry={type,control,at:at-data.started,x:event.clientX,y:event.clientY};
            data.inputFrames.push(entry);
            requestAnimationFrame(frameAt=>{entry.latency=performance.now()-at;entry.frameAt=frameAt-data.started;});
          },true);
          if(PerformanceObserver.supportedEntryTypes.includes('event')){
            const inputs=new PerformanceObserver(list=>{for(const event of list.getEntries())if(event.startTime>=data.started)
              data.inputs.push({name:event.name,at:event.startTime-data.started,duration:event.duration,
                delay:event.processingStart-event.startTime,handler:event.processingEnd-event.processingStart});});
            inputs.observe({type:'event',buffered:true,durationThreshold:16});
          }
          const observer=new PerformanceObserver(list=>{for(const task of list.getEntries())
            if(task.startTime>=data.started)data.longTasks.push({at:task.startTime-data.started,ms:task.duration});});
          observer.observe({type:'longtask',buffered:true});
          let previous=performance.now();const frame=t=>{data.frames.push(t-previous);previous=t;requestAnimationFrame(frame);};
          requestAnimationFrame(frame);
          const gl=w.renderer.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');
          data.adapter=extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
          data.staticSceneryNodes=w.staticSceneryNodes||0;data.initialUnits=s.groundUnits.length;
        }''', args.units)
        page.keyboard.press('Space')
        if args.interactions:
            # These are real mouse inputs; the game retains normal frame pacing.
            page.wait_for_timeout(2000)
            for x,y in [(.15,.2),(.85,.8),(.85,.2),(.15,.8),(.5,.5)]:
                box = page.locator('#minimap').bounding_box()
                print(f'Click minimap {x},{y}', flush=True)
                page.locator('#minimap').click(position={'x':x*box['width'],'y':y*box['height']})
                page.wait_for_timeout(900)
            for tab in ['army','military','oil','city']:
                print(f'Click tab {tab}', flush=True)
                page.locator(f'[data-tab="{tab}"]').click()
                page.wait_for_timeout(500)
            for panel in ['attack','economy','settings']:
                print(f'Click panel {panel}', flush=True)
                page.locator(f'[data-panel="{panel}"]').first.click()
                page.wait_for_timeout(500)
                page.keyboard.press('Escape')
            page.wait_for_timeout(max(0,args.seconds*1000-10000))
        else:
            page.wait_for_timeout(args.seconds * 1000)
        report.update(page.evaluate('''()=>{
          const data=window.frameTrace,w=skyfront.getWorld();
          data.elapsedMs=performance.now()-data.started;data.simTime=w.state.time;
          data.finalUnits=w.state.groundUnits.length;data.diagnostics=skyfront.diagnostics();
          data.glError=w.renderer.getContext().getError();return data;
        }'''))
        def summarize(values):
            samples = sorted(values)
            return {'samples': len(samples), 'p50': samples[len(samples)//2],
                    'p95': samples[min(len(samples)-1,int(len(samples)*.95))], 'max': samples[-1]}
        report['stageSummary'] = {key: summarize(values) for key, values in report['stages'].items() if values}
        report['frameSummary'] = summarize(report['frames'])
        report['pointerFrameSummary'] = {
            name: summarize(values) for name, values in {
                'all': [entry['latency'] for entry in report['inputFrames'] if 'latency' in entry],
                'minimap': [entry['latency'] for entry in report['inputFrames'] if entry['control'] == 'minimap' and 'latency' in entry],
            }.items() if values
        }
        report['hardwareRequested'] = args.hardware_gpu
        assert report['simTime'] > 0 and not report['errors'] and not report['consoleErrors'], report
        assert report['glError'] == 0, report['glError']
        (ARTIFACTS / f'frame-stalls-{args.label}.json').write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
        print(json.dumps({key: report[key] for key in ['adapter', 'simTime', 'stageSummary', 'frameSummary', 'pointerFrameSummary', 'glError', 'errors']}, ensure_ascii=True))
    finally:
        browser.close()

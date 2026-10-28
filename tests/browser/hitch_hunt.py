"""Long-session, native-input and CPU/GL attribution in an isolated game browser.

Profiling adds overhead. Compare identical scenarios; do not use this as an FPS promise.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import subprocess
import time
import base64
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--target',type=Path)
parser.add_argument('--url')
parser.add_argument('--server-root',type=Path)
parser.add_argument('--fixture-state',type=Path)
parser.add_argument('--label',default='812-baseline')
parser.add_argument('--seconds',type=int,default=30)
parser.add_argument('--scenario',choices=['quiet','defense','battle','campaign','tour','late','retreat'],default='tour')
parser.add_argument('--units',type=int,default=90)
parser.add_argument('--cpu-profile',action='store_true')
parser.add_argument('--interactions',action='store_true')
parser.add_argument('--trace',action='store_true')
parser.add_argument('--screenshot',action='store_true')
parser.add_argument('--require-ready',action='store_true')
parser.add_argument('--browser-priority',choices=['below-normal','normal'],default='below-normal')
args=parser.parse_args()
assert re.fullmatch(r'[a-zA-Z0-9_-]+',args.label)
assert 10<=args.seconds<=600 and 0<=args.units<=2000
if os.name=='nt':ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(),0x4000)

def lower_tree():
    if os.name!='nt':return
    code='''$all=@(Get-CimInstance Win32_Process);$ids=[System.Collections.Generic.HashSet[int]]::new();[void]$ids.Add(ROOT_PID);do{$changed=$false;foreach($proc in $all){if($ids.Contains([int]$proc.ParentProcessId)-and$ids.Add([int]$proc.ProcessId)){$changed=$true}}}while($changed);foreach($ownedId in $ids){try{(Get-Process -Id $ownedId -ErrorAction Stop).PriorityClass='BelowNormal'}catch{}};exit 0'''.replace('ROOT_PID',str(os.getpid()))
    if args.browser_priority=='normal':
        code=code.replace(';exit 0',";foreach($proc in $all){if($ids.Contains([int]$proc.ProcessId)-and$proc.Name-eq'chrome.exe'){try{(Get-Process -Id $proc.ProcessId -ErrorAction Stop).PriorityClass='Normal'}catch{}}};exit 0")
    subprocess.run(['powershell','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',code],check=True,capture_output=True,
                   creationflags=subprocess.CREATE_NO_WINDOW|subprocess.BELOW_NORMAL_PRIORITY_CLASS)

def summary(values):
    a=sorted(values)
    if not a:return {'samples':0}
    return {'samples':len(a),'p50':a[len(a)//2],'p95':a[min(len(a)-1,int(len(a)*.95))],
            'p99':a[min(len(a)-1,int(len(a)*.99))],'max':a[-1], 'over50':sum(x>=50 for x in a), 'over100':sum(x>=100 for x in a)}

server=None
report={'label':args.label,'scenario':args.scenario,'requestedUnits':args.units,'errors':[],'consoleErrors':[],
        'cpuProfiling':args.cpu_profile,'browserPriority':args.browser_priority,
        'conditions':'Isolated hardware Chrome, '+args.browser_priority+' browser priority; BelowNormal helpers; default shipped render adaptation. Battle HP10000 endurance only.'}
try:
    if args.url:url=args.url
    elif args.target:url=args.target.resolve().as_uri()
    else:
        server_root=args.server_root.resolve() if args.server_root else ROOT
        server=subprocess.Popen(['node',str(server_root/'scripts/dev-server.mjs'),'--port=0','--no-open'],cwd=server_root,
            stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf8',
            creationflags=(subprocess.CREATE_NO_WINDOW|subprocess.BELOW_NORMAL_PRIORITY_CLASS) if os.name=='nt' else 0)
        line=server.stdout.readline();match=re.search(r'http://127\.0\.0\.1:\d+',line)
        assert match,line
        url=match.group(0)
    report['url']=url
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',
            args=['--disable-background-timer-throttling','--disable-renderer-backgrounding'])
        try:
            page=browser.new_page(viewport={'width':1280,'height':720})
            page.set_default_timeout(90000)
            page.on('pageerror',lambda e:report['errors'].append(str(e)))
            page.on('console',lambda m:report['consoleErrors'].append(m.text[:1500]) if m.type=='error' else None)
            page.goto(url,wait_until='load',timeout=180000)
            page.wait_for_function('Boolean(window.skyfront)')
            report['startupBoundary']=page.evaluate('''()=>({ready:skyfront.getWorld().shadersReady,disabled:document.querySelector('[data-action="start"]').disabled,label:document.querySelector('[data-action="start"]').textContent})''')
            page.wait_for_function('skyfront.getWorld().shadersReady')
            report['warmup']=page.evaluate('skyfront.getWorld().shaderWarmup')
            if args.require_ready and report['warmup']['status']!='ready':
                (ARTIFACTS/f'hitch-{args.label}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
                raise AssertionError('Hardware performance audit requires ready warmup: '+str(report['warmup']))
            page.add_script_tag(path=str(ROOT/'tests/browser/hitch_probe.js'))
            lower_tree()
            session=page.context.new_cdp_session(page)
            trace={};trace_client=None
            if args.trace:
                trace_client=browser.new_browser_cdp_session()
                def trace_complete(result):trace.update(result);trace['done']=True
                trace_client.on('Tracing.tracingComplete',trace_complete)
                trace_client.send('Tracing.start',{'categories':'devtools.timeline,v8,blink.user_timing','transferMode':'ReturnAsStream'})
            if args.cpu_profile:
                session.send('Profiler.enable');session.send('Profiler.setSamplingInterval',{'interval':2000});session.send('Profiler.start')
            report['clock']=page.evaluate('installHitchProbe()')
            page.locator('[data-action="start"]').click()
            def mark(name):
                print('PHASE '+name,flush=True)
                page.evaluate('(name)=>hitchProbe.mark(name)',name)
            def wait(seconds):
                remaining=seconds
                while remaining>0:
                    part=min(10,remaining);page.wait_for_timeout(part*1000);remaining-=part
                    if seconds>=20:
                        print('HEARTBEAT '+json.dumps(page.evaluate('''()=>({phase:hitchProbe.phase,time:skyfront.getWorld().state.time,units:skyfront.getWorld().state.groundUnits.length,longTasks:hitchProbe.longTasks.length,frames:hitchProbe.frames.length,heap:performance.memory?.usedJSHeapSize})''')),flush=True)
            def pause(value):
                if page.evaluate('skyfront.isPaused()')!=value:page.keyboard.press('Space')
            def fixture(battle=False,automatic=False):
                pause(True)
                report.setdefault('fixtures',[]).append(page.evaluate('(o)=>hitchFixture(o)',{'count':args.units,'battle':battle,'automatic':automatic}))
                pause(False)
            def clicks():
                for x,y in [(.18,.2),(.82,.8),(.82,.2),(.18,.8),(.5,.5)]:
                    box=page.locator('#minimap').bounding_box()
                    page.locator('#minimap').click(position={'x':box['width']*x,'y':box['height']*y});wait(.5)
                # Real visible building click, via its projected world coordinate.
                data=page.evaluate('''()=>{const w=skyfront.getWorld(),b=w.state.buildings.find(b=>b.side===0&&b.key==='hq');w.focus(b.x,b.z,570,{instant:true});return {x:b.x,z:b.z};}''')
                wait(.5)
                point=page.evaluate('''p=>{const w=skyfront.getWorld(),v=w.camera.position.clone();v.set(p.x,w.height(p.x,p.z)+12,p.z).project(w.camera);return {x:(v.x+1)*640,y:(1-v.y)*360};}''',data)
                if 0<point['x']<1280 and 90<point['y']<580:page.mouse.click(point['x'],point['y']);wait(.5)
                units=page.evaluate('''()=>{const w=skyfront.getWorld(),first=w.state.groundUnits.find(u=>u.side===0&&u.hp>0&&!u.carrierId);if(!first)return [];
                  const all=w.state.groundUnits.filter(u=>u.side===0&&u.hp>0&&!u.carrierId&&u.key===first.key&&Math.hypot(u.x-first.x,u.z-first.z)<80).slice(0,2);
                  w.focus(first.x,first.z,320,{instant:true});return all.map(u=>u.id);}''')
                if units:
                    wait(.5)
                    for unit in units:
                        point=page.evaluate('''id=>{const w=skyfront.getWorld(),u=w.state.groundUnits.find(u=>u.id===id);if(!u)return null;
                          const v=w.camera.position.clone().set(u.x,(u.y||1)+2.5,u.z).project(w.camera);return {x:(v.x+1)*640,y:(1-v.y)*360};}''',unit)
                        if point and 200<point['x']<1200 and 90<point['y']<420:page.mouse.click(point['x'],point['y']);wait(.5)
                for panel in ['attack','economy','settings']:
                    page.locator(f'[data-panel="{panel}"]').first.click();wait(1);page.keyboard.press('Escape');wait(.25)
                for tab in ['army','military','city']:
                    page.locator(f'[data-tab="{tab}"]').click();wait(.5)
            if args.scenario=='retreat':
                fixture();pause(True)
                page.evaluate('''()=>{const w=skyfront.getWorld();skyfront.selectArmy(w.state.groundUnits.filter(u=>u.side===0&&u.hp>0).map(u=>u.id));}''')
                wait(1);mark('retreat-click-paused')
                page.locator('[data-troop="retreat"]').click()
                report['retreatAdmission']=page.evaluate('''()=>{const a=skyfront.getWorld().state.groundUnits.filter(u=>u.side===0);return {units:a.length,ordered:a.filter(u=>u.order?.mode==='retreat').length,pending:a.filter(u=>u.routeState).length,paths:a.filter(u=>u.path?.length).length};}''')
                wait(2);pause(False);mark('retreat-routing');wait(args.seconds)
                report['retreatProgress']=page.evaluate('''()=>{const a=skyfront.getWorld().state.groundUnits.filter(u=>u.side===0);return {units:a.length,activeRoutes:a.filter(u=>u.routeState).length,pending:a.filter(u=>u.routeState&&u.routeState.status!=='moving').length,paths:a.filter(u=>u.path?.length).length,moving:a.filter(u=>u.moving).length};}''')
            elif args.scenario=='late':
                assert args.fixture_state,'--fixture-state is required for late scenario'
                pause(True);mark('load-paid-late-campaign')
                report['paidFixture']=str(args.fixture_state.resolve())
                page.evaluate('''raw=>{const E=skyfront.engine,w=skyfront.getWorld(),s=E.load(raw);Object.assign(w.state,s);w.previousSimTime=s.time;w.focus(0,-1350,700);w.controls.update(3);w.sync();}''',args.fixture_state.read_text(encoding='utf8'))
                mark('late-paused');wait(10);pause(False);mark('late-running');wait(args.seconds)
                mark('late-clicks');clicks();wait(10)
            elif args.scenario=='campaign':
                mark('paid-campaign-idle');wait(args.seconds)
                if args.interactions:mark('paid-campaign-clicks');clicks();wait(5)
            elif args.scenario=='quiet':
                fixture();mark('paused-quiet');pause(True);wait(args.seconds);mark('running-quiet');pause(False);wait(args.seconds)
            elif args.scenario=='defense':fixture(automatic=True);mark('automatic-defense');wait(args.seconds);mark('defense-clicks');clicks();wait(5)
            elif args.scenario=='battle':fixture(battle=True);mark('cold-battle');wait(args.seconds);mark('battle-clicks');clicks();wait(5)
            else:
                mark('fresh-idle');wait(args.seconds)
                mark('fresh-clicks');clicks()
                fixture();mark('paused-army');pause(True);wait(args.seconds)
                mark('running-army');pause(False);wait(args.seconds)
                mark('army-clicks');clicks()
                fixture(automatic=True);mark('automatic-defense');wait(args.seconds)
                mark('defense-clicks');clicks()
                fixture(battle=True);mark('cold-battle');wait(args.seconds)
                mark('battle-clicks');clicks();wait(5)
            report.update(page.evaluate('hitchProbe.result()'))
            # Keep the measured evidence even if optional tracing cannot flush.
            (ARTIFACTS/f'hitch-{args.label}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
            # Stop only this isolated QA page while optional trace buffers drain.
            # Continuous GPU work can otherwise keep Chrome's trace stream open.
            page.evaluate('cancelAnimationFrame(skyfront.getWorld().frame)')
            if args.cpu_profile:
                profile=session.send('Profiler.stop')['profile']
                (ARTIFACTS/f'hitch-{args.label}.cpuprofile').write_text(json.dumps(profile),encoding='utf8')
            if args.trace:
                trace_client.send('Tracing.end')
                deadline=time.monotonic()+30
                while not trace.get('done') and time.monotonic()<deadline:page.wait_for_timeout(100)
                if 'stream'in trace:
                    handle=trace['stream']
                    with (ARTIFACTS/f'hitch-{args.label}.trace.json').open('wb') as output:
                        while True:
                            chunk=trace_client.send('IO.read',{'handle':handle,'size':1048576})
                            output.write(base64.b64decode(chunk['data']) if chunk.get('base64Encoded') else chunk['data'].encode('utf8'))
                            if chunk.get('eof'):break
                    trace_client.send('IO.close',{'handle':handle})
                else:report['traceError']={'message':'Chrome supplied no trace stream','completion':trace}
            if args.screenshot:
                page.screenshot(path=str(ARTIFACTS/f'hitch-{args.label}.png'))
            phases=list(dict.fromkeys(x['phase'] for x in report['frames']))
            report['frameSummary']={phase:summary([x['ms'] for x in report['frames'] if x['phase']==phase]) for phase in phases}
            report['inputSummary']=summary([x['nextFrameMs'] for x in report['inputs'] if 'nextFrameMs'in x])
            report['largestSpans']=sorted(report['spans'],key=lambda x:x['ms'],reverse=True)[:45]
            report['passed']=not report['errors'] and not report['consoleErrors'] and report['glError']==0
            (ARTIFACTS/f'hitch-{args.label}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
            print(json.dumps({k:report[k] for k in ['label','adapter','frameSummary','inputSummary','largestSpans','passed']},ensure_ascii=True),flush=True)
            assert report['passed']
        finally:browser.close()
finally:
    if server:
        server.terminate()
        try:server.wait(timeout=8)
        except subprocess.TimeoutExpired:server.kill();server.wait(timeout=8)

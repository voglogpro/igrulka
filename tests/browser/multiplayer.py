import json
import subprocess
import argparse
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

parser=argparse.ArgumentParser(description='Two isolated browser clients through LAN or a public internet game URL')
parser.add_argument('--url',help='Existing public game server; the test closes only its own room')
parser.add_argument('--silent-peer',action='store_true',help='Drop established guest messages to verify heartbeat recovery after the host ends the room')
parser.add_argument('--coop',action='store_true',help='Two independent allied cities against two bots')
args=parser.parse_args()
mode='coop' if args.coop else 'multiplayer'
suffix=('-internet' if args.url else '')+('-coop810' if args.coop else '')
report={'errors':[], 'responses':[], 'publicInternet':bool(args.url)}
report['silentPeer']=args.silent_peer
report['transfers']={}
fixtures=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import * as E from './src/game/index.js'; console.log(JSON.stringify([0,1].map(i=>{const s=E.createGame(500+i);E.advance(s,12+i);return E.save(s);})));"],cwd=ROOT,text=True,encoding='utf8'))
server=None if args.url else subprocess.Popen(['node','server/index.mjs','--port=0'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8')
try:
    if server:
        line=server.stdout.readline().strip()
        assert line.startswith('Skyfront multiplayer: '),line
        address=line.split(': ',1)[1]
    else:
        address=args.url.rstrip('/')
    with sync_playwright() as p:
        browser=launch_browser(p)
        contexts=[browser.new_context(viewport={'width':1280,'height':800}) for _ in range(2)]
        pages=[context.new_page() for context in contexts]
        def activate(target):
            # Two real network clients, one software-rendered world at a time.
            for candidate in pages:
                if candidate != target:
                    candidate.evaluate('window.__qaRenderEnabled=false')
            target.evaluate('window.__qaRenderEnabled=true')
        backups=[]
        for i,page in enumerate(pages):
            transport=contexts[i].new_cdp_session(page)
            transport.send('Network.enable')
            transfers=report['transfers'][str(i)]={}
            def requested(event,records=transfers):
                if event['request']['url'].startswith('http'):
                    records[event['requestId']]={'url':event['request']['url'],'decodedBytes':0}
            def received(event,records=transfers):
                if event['requestId'] in records:records[event['requestId']]['decodedBytes']+=event['dataLength']
            def finished(event,records=transfers):
                if event['requestId'] in records:records[event['requestId']]['finishedBytes']=event['encodedDataLength']
            def failed(event,records=transfers):
                if event['requestId'] in records:records[event['requestId']]['failure']=event['errorText']
            for event,handler in [('requestWillBeSent',requested),('dataReceived',received),('loadingFinished',finished),('loadingFailed',failed)]:transport.on('Network.'+event,handler)
            page.set_default_timeout(90000)
            page.on('pageerror',lambda e:(report['errors'].append(str(e)),print('PAGE ERROR '+str(e),flush=True)))
            page.on('response',lambda r:report['responses'].append({'url':r.url,'status':r.status}))
            # Apply the software-GPU budget before the first frame, including both world initializations.
            # Match simulation and WebSocket traffic still run on the real authoritative server.
            page.add_init_script('''Object.defineProperty(window,'devicePixelRatio',{get:()=>.5});window.__qaRenderEnabled=false;const qaFrame=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>{const run=()=>{if(!window.__qaRenderEnabled){setTimeout(run,50);return;}qaFrame(()=>setTimeout(()=>{const w=window.skyfront?.getWorld();if(w&&!window.__qaFirstFrame){window.__qaFirstFrame=true;w.sun.shadow.mapSize.set(1024,1024);}callback(performance.now());},100));};return setTimeout(run,0);};''')
            page.add_init_script('''
              const NativeSocket=window.WebSocket;
              window.__qaSockets=[];window.__qaMessages=[];window.__qaDecodedSnapshots=[];
              window.__qaPausedSnapshots=0;window.__qaAppliedPausedSnapshots=0;
              window.__qaLastPausedSnapshotAt=0;window.__qaLastAppliedPausedSnapshot=null;
              window.__qaPauseControlObserved=null;
              window.WebSocket=class extends NativeSocket {
                constructor(...args) {
                  super(...args);window.__qaSockets.push(this);
                  const listen=this.addEventListener.bind(this),rawEvents=new WeakMap();
                  // Native registration keeps this raw logger outside the game-handler wrapper.
                  listen('message',event=>{
                    try {
                      const m=JSON.parse(event.data),at=performance.now();
                      const record={type:m.type,phase:m.room?.phase,at,sequence:m.sync?.seq};
                      rawEvents.set(event,record);window.__qaMessages.push(record);
                      if(m.type==='room'&&m.room?.phase==='disconnected'&&window.skyfront){
                        window.__qaPauseControlObserved={at,display:skyfront.getState().time,
                          latestDecoded:window.__qaDecodedSnapshots.at(-1)?.time,
                          previousDecoded:window.__qaDecodedSnapshots.at(-2)?.time};
                      }
                      if(m.type==='snapshot'&&m.room?.phase==='disconnected'){
                        window.__qaPausedSnapshots++;window.__qaLastPausedSnapshotAt=at;
                      }
                      if(window.__qaMessages.length>24)window.__qaMessages.shift();
                    } catch {}
                  });
                  this.addEventListener=(type,handler,options)=>listen(type,type==='message'?event=>{
                    if(this.__qaDropMessages)return;
                    const nativeParse=JSON.parse;let decodedMessage=null;
                    // Retain the SAME message parsed by NetworkSession. Its handler adds
                    // decoded .state synchronously, so the post-handler clock is authoritative.
                    JSON.parse=function(...values){
                      const value=nativeParse.apply(this,values);
                      if(values[0]===event.data&&value?.type==='snapshot')decodedMessage=value;
                      return value;
                    };
                    try {handler.call(this,event);}
                    finally {
                      JSON.parse=nativeParse;
                      if(decodedMessage?.state&&window.skyfront){
                        const raw=rawEvents.get(event),sample={
                          time:decodedMessage.state.time,phase:decodedMessage.room?.phase,
                          display:skyfront.getState().time,decodedAt:performance.now(),rawAt:raw?.at,
                          sequence:decodedMessage.sync?.seq,tick:decodedMessage.tick,
                        };
                        window.__qaDecodedSnapshots.push(sample);
                        if(window.__qaDecodedSnapshots.length>12)window.__qaDecodedSnapshots.shift();
                        if(sample.phase==='disconnected'){
                          window.__qaAppliedPausedSnapshots++;window.__qaLastAppliedPausedSnapshot=sample;
                        }
                      }
                    }
                  }:handler,options);
                  listen('close',event=>window.__qaMessages.push({type:'transport-close',code:event.code}));
                }
              };
            ''')
            page.add_init_script('if(!localStorage.getItem("skyfront-realtime-v3"))localStorage.setItem("skyfront-realtime-v3",'+json.dumps(fixtures[i])+');')
            print('Loading network player '+str(i+1),flush=True)
            page.goto(address+'?multiplayer=1',wait_until='commit',timeout=30000)
            print('HTTP response received for player '+str(i+1),flush=True)
            page.wait_for_function('Boolean(window.skyfront)',timeout=120000,polling=50)
            print('World initialized for player '+str(i+1),flush=True)
            # Keep two real WebGL worlds affordable in the software-rendered QA browser.
            page.evaluate('''()=>{const w=skyfront.getWorld();w.renderer.setPixelRatio(.5);w.sun.shadow.mapSize.set(1024,1024);w.post.resize(1280,800);}''')
            backups.append(page.evaluate('localStorage.getItem("skyfront-realtime-v3")'))
        for i,page in enumerate(pages):
            assert page.locator('#network-lobby').is_visible(), '?multiplayer=1 opens the create lobby'
            assert page.evaluate('getComputedStyle(document.querySelector("#network-lobby")).position')=='absolute', 'bundled lobby styles must apply before clicks'
            page.locator('#net-name').fill('Commander '+str(i+1))
            print('Lobby opened for player '+str(i+1),flush=True)
        first,second=pages
        if args.coop:
            first.locator('[data-net-mode="coop"]').click()
            assert 'свои ресурсы' in first.locator('#net-mode-note').inner_text()
        first.locator('[data-net="create"]').click()
        first.locator('.net-room-code').wait_for()
        print('Room created',flush=True)
        code=first.locator('.net-room-code').inner_text().strip()
        first.wait_for_function('document.querySelector("#net-invite-link")?.value.includes("?room=")&&!document.querySelector("[data-net=copy]").disabled',polling=50)
        invitation=first.locator('#net-invite-link').input_value()
        assert '?room='+code in invitation and 'token' not in invitation
        second.goto(invitation,wait_until='commit',timeout=120000)
        print('Public invitation response received; waiting for guest application',flush=True)
        second.wait_for_function('Boolean(window.skyfront)',timeout=120000,polling=50)
        assert second.locator('#network-lobby').is_visible(), 'room invitation opens the join lobby'
        assert second.locator('#net-code').input_value()==code
        assert second.evaluate('skyfront.network()===null'), 'invitation never silently joins'
        second.locator('#net-name').fill('Commander 2')
        second.locator('[data-net="join"]').click()
        second.locator('[data-net="ready"]').wait_for()
        first.locator('[data-net="ready"]').click();second.locator('[data-net="ready"]').click()
        first.locator('[data-net="start"]').click()
        print('Authoritative match started',flush=True)
        for page in pages:
            activate(page)
            page.wait_for_function('(mode)=>skyfront.getState().mode===mode && skyfront.network()?.room.phase==="playing"',arg=mode,polling=50)
            assert page.locator('#welcome').is_hidden()
            assert page.locator('#network-lobby').is_hidden()
            assert page.locator('#pause').is_disabled()
        assert first.evaluate('skyfront.network().side')==0
        assert second.evaluate('skyfront.network().side')==(2 if args.coop else 1)
        assert first.evaluate('skyfront.getState().buildings.find(b=>b.key==="hq"&&b.side===0).x')==-1015
        assert second.evaluate('skyfront.getState().buildings.find(b=>b.key==="hq"&&b.side===0).x')==(-1015 if args.coop else 1015)
        if args.coop:
            assert first.evaluate('skyfront.getState().sides.length')==4
            assert first.evaluate('skyfront.getState().buildings.find(b=>b.key==="hq"&&b.side===0).z')==-1015
            assert second.evaluate('skyfront.getState().buildings.find(b=>b.key==="hq"&&b.side===0).z')==1015
        print('Two isolated browsers joined one authoritative match with opposite perspectives',flush=True)
        for side,page in enumerate(pages):
            activate(page)
            page.wait_for_function('''()=>{const w=skyfront.getWorld(),hq=w.state.buildings.find(b=>b.key==='hq'&&b.side===0);return Math.hypot(w.controls.target.x-hq.x,w.controls.target.z-hq.z)<5;}''',polling=50)
            page.locator('[data-build="power"]').click()
            point=page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),hq=w.state.buildings.find(b=>b.key==='hq'&&b.side===0),x=hq.x+Math.sign(hq.x)*55,z=hq.z-80,error=E.canPlace(w.state,'power',x,z);if(error)throw Error(error);const v=w.camera.position.clone().set(x,0,z).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''')
            hit=page.evaluate('p=>({canvas:document.elementFromPoint(p.x,p.y)===skyfront.getWorld().renderer.domElement,element:document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,200),camera:skyfront.getWorld().controls.diagnostics?.()})',point)
            assert hit['canvas'],{'point':point,'hit':hit,'player':side}
            page.mouse.click(point['x'],point['y'])
            page.wait_for_function('skyfront.getState().buildings.some(b=>b.key==="power"&&b.side===0)',polling=50)
            page.keyboard.press('Escape')
        for page in pages:
            activate(page)
            page.wait_for_function('(foreign)=>[0,foreign].every(side=>skyfront.getState().buildings.some(b=>b.key==="power"&&b.side===side))',arg=2 if args.coop else 1,polling=50)
        enemy=first.evaluate('(side)=>skyfront.getState().buildings.find(b=>b.key==="power"&&b.side===side).id',2 if args.coop else 1)
        if args.coop:
            for page in pages:
                assert page.evaluate('skyfront.getState().sides.slice(1).every(f=>f.credits===0&&Object.values(f.inventory).every(n=>n===0))')
                assert page.evaluate('skyfront.getState().buildings.filter(b=>b.key==="hq").length')==4
            report['fourIndependentCities']=True
            activate(first)
            ally=first.evaluate('''()=>{const E=skyfront.engine,s=skyfront.getState(),hq=E.hqOf(s,2),r=document.querySelector('#minimap').getBoundingClientRect();return{x:(hq.x/E.MAP.width+.5)*r.width,y:(hq.z/E.MAP.depth+.5)*r.height,hq:{x:hq.x,z:hq.z}};}''')
            first.locator('#minimap').click(position={'x':ally['x'],'y':ally['y']})
            movement=first.evaluate('''p=>{const w=skyfront.getWorld(),r=document.querySelector('#minimap').getBoundingClientRect(),v=w.controls.desired;return {x:v.x,z:v.z,error:Math.hypot(v.x-p.x,v.z-p.z),pixelDiagonal:Math.hypot(skyfront.engine.MAP.width/r.width,skyfront.engine.MAP.depth/r.height)};}''',ally['hq'])
            report['minimapMove']=movement
            assert movement['error']<=movement['pixelDiagonal'],movement
            first.wait_for_function('p=>Math.hypot(skyfront.getWorld().controls.target.x-p.x,skyfront.getWorld().controls.target.z-p.z)<5',arg=movement,polling=50)
            def allied_pick(sync):
                return first.evaluate('''({id,sync})=>{
                  const w=skyfront.getWorld(),E=skyfront.engine;
                  if(sync){w.sync();w.scene.updateMatrixWorld(true);}
                  const b=w.state.buildings.find(b=>b.id===id),r=w.renderer.domElement.getBoundingClientRect();
                  // The permanent foundation is clickable throughout construction.
                  const v=w.camera.position.clone().set(b.x,sync?w.height(b.x,b.z)+.7:4,b.z).project(w.camera);
                  const point={x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};
                  w.pointer.set((point.x-r.left)/r.width*2-1,-(point.y-r.top)/r.height*2+1);
                  w.ray.setFromCamera(w.pointer,w.camera);
                  const roots=[...[...w.models.values()].map(m=>m.root),...w.groundModels.values(),
                    ...w.infantry.meshes,...(w.ammoCrates?.pickTargets||[])].filter(root=>root.visible);
                  let picked=null;
                  for(const hit of w.ray.intersectObjects(roots,true)){
                    let hitId;
                    if(hit.object.userData.crateIds)hitId=hit.object.userData.crateIds[hit.instanceId];
                    else if(hit.object.userData.infantryBatch)hitId=hit.object.userData.unitIds[hit.instanceId];
                    else {let o=hit.object;while(o&&!o.userData.buildingId&&!o.userData.groundId)o=o.parent;
                      hitId=o?.userData.buildingId||o?.userData.groundId;}
                    if(hitId&&E.observedTarget(w.state,0,hitId)){picked=hitId;break;}
                  }
                  const element=document.elementFromPoint(point.x,point.y);
                  return {expected:id,picked,point,proxyPresent:w.models.has(id),progress:b.progress,
                    canvas:element===w.renderer.domElement,element:element?.outerHTML.slice(0,220),
                    selected:w.selected,buildKey:w.buildKey,aiming:w.aiming,groundTargeting:w.groundTargeting,
                    camera:w.controls.diagnostics()};
                }''',{'id':enemy,'sync':sync})
            report['alliedPickBeforeSync']=allied_pick(False)
            target=report['alliedPickSynchronized']=allied_pick(True)
            try:
                assert target['canvas'] and target['picked']==enemy,target
                first.mouse.click(target['point']['x'],target['point']['y'])
                first.wait_for_function('document.querySelector("#inspector")?.textContent.includes("Союзный город")',polling=50,timeout=8000)
            except Exception:
                report['alliedReadonlyFailure']=first.evaluate('''()=>{const w=skyfront.getWorld();return{
                  selected:w.selected,buildKey:w.buildKey,aiming:w.aiming,
                  inspector:document.querySelector('#inspector')?.textContent,
                  inspectorHidden:document.querySelector('#inspector')?.hidden,
                  panel:document.querySelector('#panel')?.textContent.slice(0,250)};}''')
                first.screenshot(path=str(ARTIFACTS/f'multiplayer{suffix}-allied-pick-failure.png'),timeout=30000)
                raise
            assert first.locator('#inspector [data-repair],#inspector [data-upgrade],#inspector [data-demolish]').count()==0
            first.screenshot(path=str(ARTIFACTS/'coop810-allied-readonly.png'),timeout=120000)
            first.keyboard.press('Escape')
            first.locator('.map [data-action="home"]').click()
            report['alliedReadonlyClick']=True
        denied=first.evaluate('(id)=>skyfront.command("demolish",{id})',enemy)
        assert isinstance(denied,str) and 'принадлеж' in denied,denied
        assert second.evaluate('(id)=>skyfront.getState().buildings.find(b=>b.id===id).hp',enemy)>0
        for i,page in enumerate(pages):
            activate(page)
            assert page.evaluate('localStorage.getItem("skyfront-realtime-v3")')==backups[i]
            page.screenshot(path=str(ARTIFACTS/f'multiplayer{suffix}-player-{i+1}.png'),timeout=120000)
        print('Real map building clicks synchronize both cities; foreign demolition refused and solo saves preserved',flush=True)
        activate(first)
        paused_snapshots=first.evaluate('window.__qaAppliedPausedSnapshots')
        contexts[1].set_offline(True)
        second.evaluate('window.__qaSockets.at(-1).close()')
        first.wait_for_function('skyfront.network().room.phase==="disconnected"',polling=50)
        def pause_state():
            return first.evaluate('''()=>{const n=skyfront.network(),samples=window.__qaDecodedSnapshots;return{
              at:performance.now(),phase:n.room.phase,paused:skyfront.isPaused(),display:skyfront.getState().time,
              latest:samples.at(-1)?.time,previous:samples.at(-2)?.time,received:samples.at(-1)?.decodedAt,
              pausedSnapshots:window.__qaPausedSnapshots,lastPausedMessage:window.__qaLastPausedSnapshotAt,
              appliedPausedSnapshots:window.__qaAppliedPausedSnapshots,
              rawControl:window.__qaPauseControlObserved,
              decodedSnapshots:samples.slice(-6),messages:window.__qaMessages.slice(-12)};}''')
        report['pauseControlReceived']=pause_state()
        for page in pages:
            page.wait_for_function('skyfront.network()?.room.phase==="disconnected"&&skyfront.isPaused()',polling=50)
        # The reliable phase control intentionally bypasses a pending snapshot ACK.
        # Wait for the following authoritative paused snapshot to be decoded/applied,
        # rather than treating an older interpolated display time as the pause time.
        first.wait_for_function('''count=>window.__qaAppliedPausedSnapshots>count&&
          skyfront.network()?.room.phase==='disconnected'&&skyfront.isPaused()&&
          window.__qaLastAppliedPausedSnapshot.rawAt>=window.__qaLastPausedSnapshotAt&&
          Math.abs(skyfront.getState().time-window.__qaLastAppliedPausedSnapshot.time)<1e-9''',arg=paused_snapshots,timeout=10000,polling=50)
        report['pauseSettled']=pause_state()
        frozen=report['pauseSettled']['display']
        first.wait_for_timeout(1500)
        report['pauseAfterStableWindow']=pause_state()
        assert report['pauseAfterStableWindow']['phase']=='disconnected'
        assert abs(report['pauseAfterStableWindow']['display']-frozen)<.001,report['pauseAfterStableWindow']
        assert abs(report['pauseAfterStableWindow']['latest']-report['pauseSettled']['latest'])<.001,report['pauseAfterStableWindow']
        first.screenshot(path=str(ARTIFACTS/f'multiplayer{suffix}-disconnect.png'),timeout=120000)
        contexts[1].set_offline(False)
        for page in pages:
            page.wait_for_function('skyfront.network()?.room.phase==="playing"',timeout=30000,polling=50)
        activate(second)
        result=second.evaluate('skyfront.command("formation",{value:"column"})')
        assert result is True,result
        second.wait_for_function('skyfront.getState().formations[0]==="column"',polling=50)
        print('Connection loss pauses both campaigns; automatic resume retains the slot and command sequence',flush=True)
        second.reload(wait_until='commit',timeout=120000)
        second.wait_for_function('Boolean(window.skyfront)',polling=50)
        second.evaluate('window.__qaRenderEnabled=true')
        assert second.locator('#network-lobby').is_visible(), 'invite URL keeps reconnect controls available after reload'
        second.locator('[data-net="resume"]').click()
        second.wait_for_function('(mode)=>skyfront.network()?.room.phase==="playing" && skyfront.getState().mode===mode',arg=mode,polling=50)
        assert second.evaluate('skyfront.getState().formations[0]')=='column'
        for page in pages: assert page.evaluate('skyfront.network().room.code')==code
        report['reloadResume']=True
        print('Reloaded guest resumed the same room and retained its last command',flush=True)
        activate(first)
        first.locator('[data-panel="settings"]').click()
        first.locator('#panel [data-action="network"]').click()
        first.wait_for_timeout(1200)
        assert first.locator('#network-lobby').is_visible(), 'Snapshots must keep an opened room menu visible'
        if args.silent_peer:
            second.evaluate('window.__qaSockets.at(-1).__qaDropMessages=true')
        first.locator('[data-net="leave"]').click()
        for i,page in enumerate(pages):
            print('Restoring solo campaign for player '+str(i+1),flush=True)
            try:
                # Network callbacks run even when this QA client is not rendering.
                page.wait_for_function('skyfront.network()===null && skyfront.getState().mode!=="multiplayer"',polling=50)
            except Exception:
                report['exitFailure']={'player':i+1,'state':page.evaluate('''()=>({network:!!skyfront.network(),phase:skyfront.network()?.room?.phase,mode:skyfront.getState().mode,time:skyfront.getState().time,status:document.querySelector('#network-status')?.textContent,messages:window.__qaMessages})''')}
                raise
            assert page.evaluate('localStorage.getItem("skyfront-realtime-v3")')==backups[i]
            assert abs(page.evaluate('skyfront.getState().time')-(12+i))<.01
        assert not report['errors'],report
        report.update({'room':code,'foreignCommand':denied,'soloCampaignsPreserved':True,'reloadResume':True})
        (ARTIFACTS/f'multiplayer{suffix}-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print('Page reload resumes the same room; explicit exit restores each original solo campaign; no JS errors',flush=True)
        browser.close()
except Exception as error:
    report['failure']=str(error)
    print(json.dumps({'failure':report['failure'],'errors':report['errors']},ensure_ascii=True),flush=True)
    (ARTIFACTS/f'multiplayer{suffix}-failure.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    raise
finally:
    if server:
        server.terminate()
        try:server.wait(timeout=10)
        except subprocess.TimeoutExpired:server.kill();server.wait(timeout=10)

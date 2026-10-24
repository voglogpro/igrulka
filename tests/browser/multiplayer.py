import json
import subprocess
import argparse
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

parser=argparse.ArgumentParser(description='Two isolated browser clients through LAN or a public internet game URL')
parser.add_argument('--url',help='Existing public game server; the test closes only its own room')
parser.add_argument('--silent-peer',action='store_true',help='Drop established guest messages to verify heartbeat recovery after the host ends the room')
args=parser.parse_args()
suffix='-internet' if args.url else ''
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
            page.add_init_script('''const NativeSocket=window.WebSocket;window.__qaSockets=[];window.__qaMessages=[];window.WebSocket=class extends NativeSocket{constructor(...args){super(...args);window.__qaSockets.push(this);const listen=this.addEventListener.bind(this);this.addEventListener=(type,handler,options)=>listen(type,type==='message'?event=>{if(!this.__qaDropMessages)handler.call(this,event);}:handler,options);this.addEventListener('message',event=>{try{const m=JSON.parse(event.data);window.__qaMessages.push({type:m.type,phase:m.room?.phase});if(window.__qaMessages.length>24)window.__qaMessages.shift();}catch{}});this.addEventListener('close',event=>window.__qaMessages.push({type:'transport-close',code:event.code}));}};''')
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
            page.wait_for_function('skyfront.getState().mode==="multiplayer" && skyfront.network()?.room.phase==="playing"',polling=50)
            assert page.locator('#welcome').is_hidden()
            assert page.locator('#network-lobby').is_hidden()
            assert page.locator('#pause').is_disabled()
        assert first.evaluate('skyfront.network().side')==0
        assert second.evaluate('skyfront.network().side')==1
        assert first.evaluate('skyfront.getState().buildings.find(b=>b.key==="hq"&&b.side===0).x')==-1015
        assert second.evaluate('skyfront.getState().buildings.find(b=>b.key==="hq"&&b.side===0).x')==1015
        print('Two isolated browsers joined one authoritative match with opposite perspectives',flush=True)
        for side,page in enumerate(pages):
            activate(page)
            page.locator('[data-build="power"]').click()
            point=page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),hq=w.state.buildings.find(b=>b.key==='hq'&&b.side===0),x=hq.x+Math.sign(hq.x)*55,z=hq.z-80,error=E.canPlace(w.state,'power',x,z);if(error)throw Error(error);const v=w.camera.position.clone().set(x,0,z).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''')
            page.mouse.click(point['x'],point['y'])
            page.wait_for_function('skyfront.getState().buildings.some(b=>b.key==="power"&&b.side===0)',polling=50)
            page.keyboard.press('Escape')
        for page in pages:
            activate(page)
            page.wait_for_function('skyfront.getState().buildings.filter(b=>b.key==="power").length===2',polling=50)
        enemy=first.evaluate('skyfront.getState().buildings.find(b=>b.key==="power"&&b.side===1).id')
        denied=first.evaluate('(id)=>skyfront.command("demolish",{id})',enemy)
        assert isinstance(denied,str) and 'принадлеж' in denied,denied
        assert second.evaluate('(id)=>skyfront.getState().buildings.find(b=>b.id===id).hp',enemy)>0
        for i,page in enumerate(pages):
            activate(page)
            assert page.evaluate('localStorage.getItem("skyfront-realtime-v3")')==backups[i]
            page.screenshot(path=str(ARTIFACTS/f'multiplayer{suffix}-player-{i+1}.png'),timeout=120000)
        print('Real map building clicks synchronize both cities; foreign demolition refused and solo saves preserved',flush=True)
        activate(first)
        contexts[1].set_offline(True)
        second.evaluate('window.__qaSockets.at(-1).close()')
        first.wait_for_function('skyfront.network().room.phase==="disconnected"',polling=50)
        frozen=first.evaluate('skyfront.getState().time')
        first.wait_for_timeout(1500)
        assert abs(first.evaluate('skyfront.getState().time')-frozen)<.06
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
        second.wait_for_function('skyfront.network()?.room.phase==="playing" && skyfront.getState().mode==="multiplayer"',polling=50)
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

import json
import subprocess
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

report={'errors':[], 'responses':[]}
fixtures=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import * as E from './src/game/index.js'; console.log(JSON.stringify([0,1].map(i=>{const s=E.createGame(500+i);E.advance(s,12+i);return E.save(s);})));"],cwd=ROOT,text=True,encoding='utf8'))
server=subprocess.Popen(['node','server/index.mjs','--port=0'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8')
try:
    line=server.stdout.readline().strip()
    assert line.startswith('Skyfront multiplayer: '),line
    address=line.split(': ',1)[1]
    with sync_playwright() as p:
        browser=launch_browser(p)
        contexts=[browser.new_context(viewport={'width':1280,'height':800}) for _ in range(2)]
        pages=[context.new_page() for context in contexts]
        backups=[]
        for i,page in enumerate(pages):
            page.set_default_timeout(90000)
            page.on('pageerror',lambda e:(report['errors'].append(str(e)),print('PAGE ERROR '+str(e),flush=True)))
            page.on('response',lambda r:report['responses'].append({'url':r.url,'status':r.status}))
            page.add_init_script('''const NativeSocket=window.WebSocket;window.__qaSockets=[];window.WebSocket=class extends NativeSocket{constructor(...args){super(...args);window.__qaSockets.push(this);}};''')
            page.add_init_script('if(!localStorage.getItem("skyfront-realtime-v3"))localStorage.setItem("skyfront-realtime-v3",'+json.dumps(fixtures[i])+');')
            print('Loading network player '+str(i+1),flush=True)
            page.goto(address,wait_until='commit',timeout=30000)
            print('HTTP response received for player '+str(i+1),flush=True)
            page.wait_for_function('Boolean(window.skyfront)')
            # Keep two real WebGL worlds affordable in the software-rendered QA browser.
            page.evaluate('''()=>{const w=skyfront.getWorld();w.renderer.setPixelRatio(.5);w.sun.shadow.mapSize.set(1024,1024);w.post.resize(1280,800);}''')
            backups.append(page.evaluate('localStorage.getItem("skyfront-realtime-v3")'))
            page.locator('[data-action="network"]').click()
            page.locator('#net-name').fill('Commander '+str(i+1))
        first,second=pages
        first.locator('[data-net="create"]').click()
        first.locator('.net-room-code').wait_for()
        code=first.locator('.net-room-code').inner_text().strip()
        second.locator('#net-code').fill(code);second.locator('[data-net="join"]').click()
        second.locator('[data-net="ready"]').wait_for()
        first.locator('[data-net="ready"]').click();second.locator('[data-net="ready"]').click()
        first.locator('[data-net="start"]').click()
        for page in pages:
            page.wait_for_function('skyfront.getState().mode==="multiplayer" && skyfront.network()?.room.phase==="playing"')
            assert page.locator('#welcome').is_hidden()
            assert page.locator('#network-lobby').is_hidden()
            assert page.locator('#pause').is_disabled()
        assert first.evaluate('skyfront.network().side')==0
        assert second.evaluate('skyfront.network().side')==1
        assert first.evaluate('skyfront.getState().buildings.find(b=>b.key==="hq"&&b.side===0).x')==-615
        assert second.evaluate('skyfront.getState().buildings.find(b=>b.key==="hq"&&b.side===0).x')==615
        print('Two isolated browsers joined one authoritative match with opposite perspectives',flush=True)
        for side,page in enumerate(pages):
            page.locator('[data-build="power"]').click()
            point=page.evaluate('''side=>{const w=skyfront.getWorld(),v=w.camera.position.clone().set(side?670:-670,0,-80).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''',side)
            page.mouse.click(point['x'],point['y'])
            page.wait_for_function('skyfront.getState().buildings.some(b=>b.key==="power"&&b.side===0)')
            page.keyboard.press('Escape')
        for page in pages:
            page.wait_for_function('skyfront.getState().buildings.filter(b=>b.key==="power").length===2')
        enemy=first.evaluate('skyfront.getState().buildings.find(b=>b.key==="power"&&b.side===1).id')
        denied=first.evaluate('(id)=>skyfront.command("demolish",{id})',enemy)
        assert isinstance(denied,str) and 'принадлеж' in denied,denied
        assert second.evaluate('(id)=>skyfront.getState().buildings.find(b=>b.id===id).hp',enemy)>0
        for i,page in enumerate(pages):
            assert page.evaluate('localStorage.getItem("skyfront-realtime-v3")')==backups[i]
            page.screenshot(path=str(ARTIFACTS/f'multiplayer-player-{i+1}.png'),timeout=120000)
        print('Real map building clicks synchronize both cities; foreign demolition refused and solo saves preserved',flush=True)
        contexts[1].set_offline(True)
        second.evaluate('window.__qaSockets.at(-1).close()')
        first.wait_for_function('skyfront.network().room.phase==="disconnected"')
        frozen=first.evaluate('skyfront.getState().time')
        first.wait_for_timeout(1500)
        assert abs(first.evaluate('skyfront.getState().time')-frozen)<.06
        first.screenshot(path=str(ARTIFACTS/'multiplayer-disconnect.png'),timeout=120000)
        contexts[1].set_offline(False)
        for page in pages:
            page.wait_for_function('skyfront.network()?.room.phase==="playing"',timeout=30000)
        result=second.evaluate('skyfront.command("formation",{value:"column"})')
        assert result is True,result
        second.wait_for_function('skyfront.getState().formations[0]==="column"')
        print('Connection loss pauses both campaigns; automatic resume retains the slot and command sequence',flush=True)
        second.reload(wait_until='load',timeout=120000)
        second.wait_for_function('Boolean(window.skyfront)')
        second.locator('[data-action="network"]').click()
        second.locator('[data-net="resume"]').click()
        second.wait_for_function('skyfront.network()?.room.phase==="playing" && skyfront.getState().mode==="multiplayer"')
        assert second.evaluate('skyfront.getState().formations[0]')=='column'
        for page in pages: assert page.evaluate('skyfront.network().room.code')==code
        first.locator('[data-panel="settings"]').click()
        first.locator('#panel [data-action="network"]').click()
        first.wait_for_timeout(1200)
        assert first.locator('#network-lobby').is_visible(), 'Snapshots must keep an opened room menu visible'
        first.locator('[data-net="leave"]').click()
        for i,page in enumerate(pages):
            page.wait_for_function('skyfront.network()===null && skyfront.getState().mode!=="multiplayer"')
            assert page.evaluate('localStorage.getItem("skyfront-realtime-v3")')==backups[i]
            assert abs(page.evaluate('skyfront.getState().time')-(12+i))<.01
        assert not report['errors'],report
        report.update({'room':code,'foreignCommand':denied,'soloCampaignsPreserved':True,'reloadResume':True})
        (ARTIFACTS/'multiplayer-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print('Page reload resumes the same room; explicit exit restores each original solo campaign; no JS errors',flush=True)
        browser.close()
except Exception as error:
    report['failure']=str(error)
    report['clients']=[]
    for i,page in enumerate(pages if 'pages' in locals() else []):
        try:
            report['clients'].append(page.evaluate('''()=>({title:document.title,mode:window.skyfront?.getState().mode,side:window.skyfront?.network()?.side,phase:window.skyfront?.network()?.room?.phase,room:window.skyfront?.network()?.room?.code,lobby:document.querySelector('#network-lobby')?.textContent,notice:document.querySelector('#notice')?.textContent})'''))
            page.screenshot(path=str(ARTIFACTS/f'multiplayer-failure-{i+1}.png'),timeout=30000)
        except Exception as diagnostic_error:
            report['clients'].append({'diagnosticFailure':str(diagnostic_error)})
    print(json.dumps({'failure':report['failure'],'clients':report['clients']},ensure_ascii=True),flush=True)
    (ARTIFACTS/'multiplayer-failure.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    raise
finally:
    server.terminate()
    try:server.wait(timeout=10)
    except subprocess.TimeoutExpired:server.kill();server.wait(timeout=10)

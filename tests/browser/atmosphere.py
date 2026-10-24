"""Rendered depth fog, weather, city crews and compact UI in an isolated browser profile."""
import json
import subprocess
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

report = {'errors': [], 'consoleErrors': [], 'checks': []}
server = subprocess.Popen(
    ['node', str(ROOT / 'scripts/dev-server.mjs'), '--no-open', '--port=0'],
    cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf8',
)
try:
    address = server.stdout.readline().strip().removeprefix('Skyfront: ')
    assert address.startswith('http://127.0.0.1:'), address
    with sync_playwright() as p:
        browser = launch_browser(p)
        context = browser.new_context(viewport={'width': 1024, 'height': 768}, device_scale_factor=1)
        page = context.new_page()
        page.set_default_timeout(90000)
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.on('console', lambda e: report['consoleErrors'].append(e.text[:3000]) if e.type == 'error' else None)
        page.goto(address, wait_until='load', timeout=120000)
        page.wait_for_function('Boolean(window.skyfront)')
        page.locator('[data-action="start"]').click()
        page.keyboard.press('Space')
        assert page.evaluate('skyfront.isPaused()')

        # Read actual final framebuffer pixels with the same HDR/MSAA/depth post pass.
        report['depthFog'] = page.evaluate('''async()=>{
          const T=await import('/vendor/three/three.module.js'),w=skyfront.getWorld(),scene=new T.Scene();
          scene.background=new T.Color('#243b59');
          const camera=new T.PerspectiveCamera(45,1024/768,2,5000);camera.position.set(0,150,550);camera.lookAt(0,0,0);camera.updateMatrixWorld();
          const geo=new T.PlaneGeometry(500,500),box=new T.BoxGeometry(100,80,100),material=new T.MeshBasicMaterial({color:'#36493d'});
          const floor=new T.Mesh(geo,material);floor.rotation.x=-Math.PI/2;scene.add(floor);
          const tower=new T.Mesh(box,material);tower.position.set(100,40,0);scene.add(tower);
          const post=new w.post.constructor(w.renderer);post.resize(1024,768);
          const canvas=document.createElement('canvas');canvas.width=w.renderer.domElement.width;canvas.height=w.renderer.domElement.height;
          const ctx=canvas.getContext('2d');
          const points=[new T.Vector3(-120,0,0),new T.Vector3(100,80,0)];
          const samples=points.map(v=>{v.project(camera);return [(v.x+1)*canvas.width/2,(1-v.y)*canvas.height/2];});
          samples.push([canvas.width*.95,canvas.height*.05]);
          const resolves=[];const read=amount=>{post.setAtmosphere({kind:'fog',amount},.2);post.render(scene,camera,0);resolves.push(post.target.resolveDepthBuffer);ctx.drawImage(w.renderer.domElement,0,0);return samples.map(([x,y])=>Array.from(ctx.getImageData(Math.round(x),Math.round(y),1,1).data).slice(0,3));};
          const clear=read(0),fog=read(1),again=read(0);
          const delta=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
          const texture=new T.DataTexture(new Uint8Array([16,32,36,100]),1,1,T.RGBAFormat);texture.needsUpdate=true;
          post.setVision({texture,origin:new T.Vector2(-1600,-1600),extent:new T.Vector2(3200,3200),active:true});
          const veiled=read(0);post.uniforms.visionActive.value=0;const revealed=read(0);
          const result={clear,fog,resolves:resolves.slice(0,3),groundDelta:delta(clear[0],fog[0]),roofDelta:delta(clear[1],fog[1]),skyDelta:delta(clear[2],fog[2]),repeatDelta:Math.max(...clear.map((v,i)=>delta(v,again[i]))),depthSize:[post.target.depthTexture.image.width,post.target.depthTexture.image.height],visionGround:delta(clear[0],veiled[0]),visionRoof:delta(clear[1],veiled[1]),visionSky:delta(clear[2],veiled[2]),revealDelta:Math.max(...clear.map((v,i)=>delta(v,revealed[i])))};
          texture.dispose();
          post.target.dispose();post.bloom.dispose();post.material.dispose();post.bloomMaterial.dispose();post.scene.children[0].geometry.dispose();geo.dispose();box.dispose();material.dispose();
          return result;
        }''')
        assert report['depthFog']['groundDelta'] >= 5, report['depthFog']
        assert 0 < report['depthFog']['roofDelta'] < report['depthFog']['groundDelta'] and report['depthFog']['skyDelta'] == 0, report['depthFog']
        assert report['depthFog']['visionGround'] >= 5 and report['depthFog']['visionRoof'] >= 5, report['depthFog']
        assert report['depthFog']['visionSky'] == 0 and report['depthFog']['revealDelta'] == 0, report['depthFog']
        assert report['depthFog']['repeatDelta'] == 0, report['depthFog']
        assert report['depthFog']['resolves'] == [False, True, False], report['depthFog']
        report['checks'].append('GPU fog fades ground and roofs smoothly; vision veils both heights, reveals both and leaves sky unchanged')
        print(report['checks'][-1], flush=True)

        ids = page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),s=w.state,next=E.createGame(2410);next.mode='multiplayer';next.rules.rear=false;
          for(const f of next.sides){f.credits=20000;f.materials=3000;f.rearAuto=false;}
          Object.assign(s,next);w.previousSimTime=s.time;
          const house=E.build(s,0,'housing',-960,-80);house.progress=1;house.hp=house.maxHp;
          w.controls.focus(-1020,-45,240);w.controls.update(3);w.sync();return {house:house.id};}''')
        card = page.locator('[data-build="service"]')
        card.scroll_into_view_if_needed()
        card.click()
        point = page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),error=E.canPlace(w.state,'service',-1080,-80);if(error)throw Error(error);const v=w.camera.position.clone().set(-1080,0,-80).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};}''')
        page.mouse.click(point['x'], point['y'])
        page.wait_for_function('skyfront.getState().buildings.some(b=>b.key==="service")')
        ids['station'] = page.evaluate('skyfront.getState().buildings.find(b=>b.key==="service").id')
        report['crew'] = page.evaluate('''ids=>{const E=skyfront.engine,w=skyfront.getWorld(),s=w.state;E.advance(s,28);w.previousSimTime=s.time;w.sync();const station=s.buildings.find(b=>b.id===ids.station),house=s.buildings.find(b=>b.id===ids.house);house.hp=house.maxHp-120;E.advance(s,.1);w.sync();skyfront.select(station.id);return {vehicles:s.serviceVehicles.length,status:E.serviceStatus(s,0,station.id),before:s.serviceVehicles.map(v=>[v.x,v.z]),hp:house.hp};}''', ids)
        assert report['crew']['vehicles'] == 2, report['crew']
        toggle = page.locator('#service-toggle')
        assert toggle.is_visible() and toggle.get_attribute('aria-pressed') == 'true'
        toggle.click()
        page.wait_for_function('(id)=>skyfront.getState().buildings.find(b=>b.id===id).serviceEnabled===false', arg=ids['station'])
        toggle.click()
        page.wait_for_function('(id)=>skyfront.getState().buildings.find(b=>b.id===id).serviceEnabled===true', arg=ids['station'])
        report['crew']['after'] = page.evaluate('''ids=>{const E=skyfront.engine,w=skyfront.getWorld(),s=w.state;E.advance(s,4);w.previousSimTime=s.time;w.sync();return {positions:s.serviceVehicles.map(v=>[v.x,v.z]),hp:s.buildings.find(b=>b.id===ids.house).hp,rendered:w.serviceFleet.diagnostics(),saveRestored:E.load(E.save(s)).serviceVehicles.length};}''', ids)
        assert report['crew']['after']['positions'] != report['crew']['before'], report['crew']
        assert report['crew']['after']['rendered']['vehicles'] == 2
        assert report['crew']['after']['saveRestored'] == 2
        page.screenshot(path=str(ARTIFACTS / 'services85-1024.png'), timeout=120000)
        report['checks'].append('actual build click, local dispatch, two visible vans, guarded toggle and save/load')
        print(report['checks'][-1], flush=True)

        page.keyboard.press('Escape')
        for kind in ['clear', 'fog', 'rain', 'storm']:
            result = page.evaluate('''kind=>{const w=skyfront.getWorld();w.state.weather={...w.state.weather,kind,amount:kind==='clear'?0:1,goal:kind==='clear'?0:1,until:1e9};w.updateDaylight();w.weatherFX.update(3,w.controls.target,w.state.weather);w.post.render(w.scene,w.camera,w.battleTime);return {weather:w.weatherFX.diagnostics(),fog:w.post.uniforms.groundFog.value,haze:w.scene.fog.density,memory:{...w.renderer.info.memory}};}''', kind)
            report[kind] = result
            assert result['haze'] < .001, result
            page.screenshot(path=str(ARTIFACTS / ('weather85-' + kind + '.png')), timeout=120000)
        before = page.evaluate('skyfront.getWorld().weatherFX.diagnostics()')
        page.wait_for_timeout(350)
        after = page.evaluate('skyfront.getWorld().weatherFX.diagnostics()')
        assert before == after, (before, after)
        assert report['rain']['weather']['drops'] < 850 and report['storm']['weather']['drops'] < 1350
        assert report['fog']['weather']['rain'] is False
        report['checks'].append('all four weather phases render; rain and lightning freeze on pause')
        print(report['checks'][-1], flush=True)
        for panel in ['attack', 'army', 'economy', 'settings', 'help']:
            page.evaluate('name=>skyfront.openPanel(name,true)', panel)
            bounds = page.locator('#panel').bounding_box()
            assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= 1025, (panel, bounds)
            page.keyboard.press('Escape')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        pause_box = page.locator('#paused').bounding_box()
        district_box = page.locator('#district-strip').bounding_box()
        if pause_box and district_box:
            assert pause_box['y'] >= district_box['y'] + district_box['height'] + 8, (pause_box, district_box)
        report['checks'].append('redesigned panels fit 1024px without horizontal page overflow')
        page.set_viewport_size({'width': 1440, 'height': 900})
        report['tracers'] = page.evaluate('''()=>{const w=skyfront.getWorld(),E=skyfront.engine,s=E.createGame(819);s.mode='multiplayer';s.rules.rear=false;
          for(const f of s.sides){f.credits=50000;f.materials=5000;}
          const b=E.build(s,0,'gun',-850,0);b.progress=1;b.hp=b.maxHp;
          const m=E.makeGround(s,0,'mog',-820,50);m.setup=1;s.groundUnits.push(m);
          const site=E.build(s,1,'launcher',-750,175);if(typeof site==='string')throw Error(site);site.progress=1;site.hp=site.maxHp;E.acceptLaunchDelivery(site,'heavy',1);E.launch(s,1,'heavy',{x:-1050,z:10});
          Object.assign(s.units[0],{route:null,startX:-400,startZ:10,tx:-1050,tz:10,total:650,travelled:300,speed:.001,hp:100000,maxHp:100000,delay:0});
          E.advance(s,7);Object.assign(w.state,s);w.previousSimTime=s.time;w.controls.focus(-780,20,300);w.controls.update(3);w.updateDaylight();w.sync();
          w.weatherFX.update(3,w.controls.target,s.weather);w.combatFX.emit(s,.1);w.combatFX.update(.1,w.battleTime,w.camera);w.post.render(w.scene,w.camera,w.battleTime);
          return {shots:s.stats.shots,...w.combatFX.diagnostics()};}''')
        assert report['tracers']['shots'] > 20 and report['tracers']['tracerHeads'] > 0, report['tracers']
        assert report['tracers']['streaks'] >= report['tracers']['tracerHeads'] * 6, report['tracers']
        page.screenshot(path=str(ARTIFACTS / 'tracers85-1440.png'), timeout=120000)
        report['checks'].append('actual static and mobile MOG fire renders layered ballistic tracers at 1440px')
        assert not report['errors'] and not report['consoleErrors'], report
        browser.close()
    (ARTIFACTS / 'atmosphere85-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(report, ensure_ascii=False), flush=True)
finally:
    server.terminate()
    server.wait(timeout=15)

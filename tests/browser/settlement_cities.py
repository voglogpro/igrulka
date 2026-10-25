"""Paid town connection, ordinary building picking and adaptive MSAA/depth fog in Chrome."""
import json
import subprocess
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

report = {'errors': [], 'consoleErrors': []}
server = subprocess.Popen(['node', 'scripts/dev-server.mjs', '--no-open', '--port=0'],
                          cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, encoding='utf8')
try:
    address = server.stdout.readline().strip().removeprefix('Skyfront: ')
    assert address.startswith('http://127.0.0.1:'), address
    with sync_playwright() as p:
        browser = launch_browser(p)
        page = browser.new_page(viewport={'width': 1024, 'height': 768})
        page.set_default_timeout(90000)
        page.add_init_script('Object.defineProperty(window,"devicePixelRatio",{get:()=>.5});')
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.on('console', lambda e: report['consoleErrors'].append(e.text) if e.type == 'error' else None)
        page.goto(address, wait_until='load', timeout=120000)
        page.wait_for_function('Boolean(window.skyfront)')
        page.locator('[data-action="start"]').click()
        page.keyboard.press('Space')
        assert page.evaluate('skyfront.isPaused()')
        page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),s=w.state;
          Object.assign(s,E.createGame(811,{mode:'coop'}));
          for(const ai of [s.ai,...Object.values(s.aiBySide||{})])ai.nextBuild=ai.nextAttack=ai.nextArmy=1e9;
          w.previousSimTime=s.time;w.controls.focus(-1515,-1390,240);w.controls.update(3);w.sync();
        }''')
        page.evaluate('skyfront.select("north-village-1")')
        assert 'въезд' in page.locator('#inspector').inner_text()
        assert page.evaluate('Boolean(skyfront.getWorld().settlementView.sites.get("north-village-1").body)')
        page.screenshot(path=str(ARTIFACTS/'town811-neutral.png'), timeout=120000)
        page.keyboard.press('Escape')
        money = page.evaluate('skyfront.getState().sides[0].credits')
        for a in [{'a': {'x': -1105, 'z': -1060}, 'b': {'x': -1515, 'z': -1060}},
                  {'a': {'x': -1515, 'z': -1060}, 'b': {'x': -1515, 'z': -1337}}]:
            result = page.evaluate('args=>skyfront.command("road",args)', a)
            assert isinstance(result, dict), result
        report['town'] = page.evaluate('''()=>{const w=skyfront.getWorld(),E=skyfront.engine,s=w.state;
          E.advance(s,.1);w.previousSimTime=s.time;w.sync();
          const d=E.settlementStatus(s,'north-village-1');
          return {status:d,credits:s.sides[0].credits,previewRemoved:w.settlementView.sites.get(d.id).body===null,
            ordinaryModels:d.componentIds.every(id=>w.models.has(id)),batch:w.buildingBatch.diagnostics()};
        }''')
        town = report['town']
        assert town['status']['owner'] == 0 and town['status']['active'], town
        assert town['status']['income'] > 0 and town['status']['materials'] > 0, town
        assert town['credits'] < money - 500 and town['previewRemoved'] and town['ordinaryModels'], town
        house = next(b for b in town['status']['components'] if b['key'] == 'housing')
        point = page.evaluate('''b=>{const w=skyfront.getWorld(),v=w.camera.position.clone().set(b.x,5,b.z).project(w.camera),r=w.renderer.domElement.getBoundingClientRect();return{x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2};}''', house)
        page.mouse.click(point['x'], point['y'])
        page.wait_for_function('document.querySelector("#inspector").textContent.includes("Жилой")')
        assert page.locator('#inspector [data-demolish]').count() == 1
        page.screenshot(path=str(ARTIFACTS/'town811-claimed.png'), timeout=120000)
        report['cut'] = page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),s=w.state;
          const id=s.settlements.find(d=>d.id==='north-village-1').componentIds[0],b=s.buildings.find(b=>b.id===id);
          b.hp=0;E.demolish(s,id,0);E.advance(s,.1);w.previousSimTime=s.time;w.sync();
          const missing=!w.models.has(id),r=s.roads.find(r=>r.side===0&&!r.camp&&!r.settlementId);
          E.demolish(s,r.id,0);E.advance(s,.1);w.previousSimTime=s.time;w.sync();
          return{demolished:missing,status:E.settlementStatus(s,'north-village-1'),income:E.economy(s,0).settlements.income,
            saved:E.load(E.save(s)).buildings.find(b=>b.id===id).demolished};}''')
        assert report['cut']['demolished'] and report['cut']['saved'], report['cut']
        assert report['cut']['income'] == 0 and not report['cut']['status']['active'], report['cut']
        report['post'] = page.evaluate('''async()=>{
          const T=await import('/vendor/three/three.module.js'),{EveningPost}=await import('/src/rendering/effects/post-processing.js');
          const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(384,256);
          const scene=new T.Scene();scene.background=new T.Color('#243b59');
          const camera=new T.PerspectiveCamera(45,1.5,2,5000);camera.position.set(0,150,550);camera.lookAt(0,0,0);camera.updateMatrixWorld();
          const mat=new T.MeshBasicMaterial({color:'#36493d'}),geo=new T.PlaneGeometry(500,500),floor=new T.Mesh(geo,mat);
          floor.rotation.x=-Math.PI/2;scene.add(floor);const post=new EveningPost(renderer),samples=[],resolves=[];
          const canvas=document.createElement('canvas');canvas.width=384;canvas.height=256;const ctx=canvas.getContext('2d');
          const point=new T.Vector3(-120,0,0).project(camera),x=Math.round((point.x+1)*192),y=Math.round((1-point.y)*128);
          const read=(scale,fog)=>{post.resize(384,256,scale);post.setAtmosphere({kind:'fog',amount:fog},.2);post.render(scene,camera,0);
            samples.push(post.target.samples);resolves.push(post.target.resolveDepthBuffer);ctx.drawImage(renderer.domElement,0,0);
            return Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3);};
          const clear=read(1,0),full=read(1,1),reduced=read(.9,1),recovered=read(1,1),error=renderer.getContext().getError();
          const diff=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
          const result={samples,resolves,fogDelta:diff(clear,full),reducedDelta:diff(full,reduced),recoveredDelta:diff(full,recovered),error,maxSamples:renderer.capabilities.maxSamples};
          post.target.dispose();post.bloom.dispose();post.material.dispose();post.bloomMaterial.dispose();post.scene.children[0].geometry.dispose();geo.dispose();mat.dispose();renderer.dispose();
          return result;
        }''')
        post = report['post']
        assert post['samples'] == [4, 4, 2, 4], post
        assert post['resolves'] == [False, True, True, True], post
        assert post['fogDelta'] >= 5 and post['reducedDelta'] <= 2 and post['recoveredDelta'] == 0 and post['error'] == 0, post
        assert not report['errors'] and not report['consoleErrors'], report
        browser.close()
    print(json.dumps(report, ensure_ascii=False), flush=True)
finally:
    (ARTIFACTS/'settlement-cities811-browser.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    server.terminate()
    server.wait(timeout=15)

"""Render film grain on a flat field; verify low amplitude and absence of directional bands."""
import json
import subprocess
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

server=subprocess.Popen(['node',str(ROOT/'scripts/dev-server.mjs'),'--no-open','--port=0'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8')
report={'errors':[],'consoleErrors':[]}
try:
    address=server.stdout.readline().strip().removeprefix('Skyfront: ')
    assert address.startswith('http://127.0.0.1:')
    with sync_playwright() as p:
        browser=launch_browser(p)
        page=browser.new_page(viewport={'width':384,'height':256})
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        page.on('console',lambda e:report['consoleErrors'].append(e.text) if e.type=='error' else None)
        page.route(address+'/',lambda route:route.fulfill(content_type='text/html',body='<html><body style="margin:0"></body></html>'))
        page.goto(address)
        report['grain']=page.evaluate('''async()=>{
          const T=await import('/vendor/three/three.module.js'),{EveningPost}=await import('/src/rendering/effects/post-processing.js');
          const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(384,256);document.body.append(renderer.domElement);
          const scene=new T.Scene();scene.background=new T.Color('#444444');
          const camera=new T.PerspectiveCamera(45,384/256,2,5000),post=new EveningPost(renderer);post.resize(384,256);post.setAtmosphere({kind:'clear',amount:0},.5);
          const canvas=document.createElement('canvas');canvas.width=384;canvas.height=256;const ctx=canvas.getContext('2d');
          const read=time=>{post.render(scene,camera,time);ctx.drawImage(renderer.domElement,0,0);return ctx.getImageData(144,96,96,64).data;};
          const a=read(0),b=read(0),c=read(1/24),values=[],rows=[],cols=[];
          let changed=0,repeat=0;for(let i=0;i<a.length;i+=4){values.push(a[i]);changed+=a[i]!==c[i];repeat+=a[i]!==b[i];}
          const mean=v=>v.reduce((s,x)=>s+x,0)/v.length,std=v=>{const m=mean(v);return Math.sqrt(mean(v.map(x=>(x-m)**2)));};
          for(let y=0;y<64;y++)rows.push(mean(values.slice(y*96,(y+1)*96)));
          for(let x=0;x<96;x++)cols.push(mean(Array.from({length:64},(_,y)=>values[y*96+x])));
          const m=mean(values),variance=std(values)**2;
          const corr=(dx,dy)=>{let sum=0,n=0;for(let y=0;y<64-dy;y++)for(let x=0;x<96-dx;x++){sum+=(values[y*96+x]-m)*(values[(y+dy)*96+x+dx]-m);n++;}return sum/n/variance;};
          return {std:std(values),range:Math.max(...values)-Math.min(...values),rows:std(rows),columns:std(cols),horizontal:corr(1,0),vertical:corr(0,1),diagonal:corr(1,1),changed,repeat};
        }''')
        g=report['grain']
        assert 0.1<g['std']<1.2 and g['range']<=4,g
        assert g['rows']<.25 and g['columns']<.25,g
        assert all(abs(g[k])<.08 for k in ['horizontal','vertical','diagonal']),g
        assert g['repeat']==0 and g['changed']>1000,g
        assert not report['errors'] and not report['consoleErrors'],report
        page.screenshot(path=str(ARTIFACTS/'grain86-flat.png'))
        browser.close()
    (ARTIFACTS/'grain86-report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print(json.dumps(report),flush=True)
finally:
    server.terminate();server.wait(timeout=15)

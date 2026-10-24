"""Recorded ground sounds through real Web Audio; no WebGL or user profile."""
import json
from playwright.sync_api import sync_playwright
from audio import sources
from support import ARTIFACTS
RENDER=r'''async url=>{
 const {GameAudio}=await import(url),out={};
 for(const mode of ['near','far','passenger','downed','paused','mute','truck']){
  const c=new OfflineAudioContext(2,44100*3,44100),a=new GameAudio();a.unlock(c);
  for(let i=0;i<800&&!a.buffers.reload;i++)await new Promise(r=>setTimeout(r,5));
  if(!a.buffers.footstep?.length)throw Error('Missing footsteps');
  const u={id:1,key:'infantry',hp:10,moving:true,x:mode==='far'?250:20,z:0};
  if(mode==='passenger')u.carrierId=3;if(mode==='downed')u.downed=true;
  if(mode==='truck')u.key='supplytruck';if(mode==='mute')a.enabled=false;
  a.update({time:0,units:[],buildings:[],groundUnits:[u]}, {position:{x:0,y:10,z:0},matrixWorld:{elements:[1,0,0,0]}},mode==='paused');
  const admitted=a.voices,b=await c.startRendering(),l=b.getChannelData(0),r=b.getChannelData(1);
  let peak=0,power=0,stereo=0;
  for(let i=0;i<l.length;i++){if(!Number.isFinite(l[i])||!Number.isFinite(r[i]))throw Error('Nonfinite');peak=Math.max(peak,Math.abs(l[i]),Math.abs(r[i]));power+=l[i]**2+r[i]**2;stereo+=(l[i]-r[i])**2;}
  out[mode]={peak,rms:Math.sqrt(power/(l.length*2)),stereo,admitted,remaining:a.voices};
 }
 return out;
}'''
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True,args=['--disable-gpu'])
 try: result=b.new_page().evaluate(RENDER,sources())
 finally:b.close()
assert result['near']['admitted']==1 and result['near']['remaining']==0
assert result['near']['rms']>result['far']['rms']>0
assert result['near']['stereo']>0
for mode in ['passenger','downed','paused','mute']:assert result[mode]['peak']==0,mode
assert 0<result['truck']['rms']<.1
assert all(v['peak']<.99 and v['remaining']==0 for v in result.values())
(ARTIFACTS/'audio-ground-891.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result,indent=2))

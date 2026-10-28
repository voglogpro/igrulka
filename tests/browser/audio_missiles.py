"""Missile launch and terminal signatures through real Web Audio, without WebGL."""
import base64
import json
import wave
from playwright.sync_api import sync_playwright
from audio import sources, VOICE_CAP_RENDER, validate_cap
from support import ARTIFACTS

RENDER=r'''async url=>{
 const {GameAudio}=await import(url),result={};const rate=44100;
 for(const mode of ['rocket','ballistic','dive','stress']){
  const context=new OfflineAudioContext(2,rate*6,rate),audio=new GameAudio();audio.unlock(context);
  await audio.ready;
  for(let i=0;i<800&&!audio.buffers.missileDive;i++)await new Promise(r=>setTimeout(r,5));
  if(!audio.buffers.missileDive)throw Error('Missile synthesis timeout');
  if(mode==='rocket')audio.play({type:'shot',key:'cannon',shooter:'mlrs',ground:true},120,.4);
  if(mode==='ballistic')audio.play({type:'launch',key:'ballistic'},120,.4);
  if(mode==='dive'){
   const state={projectiles:[],units:[{id:99,key:'ballistic',hp:10,total:100,travelled:10,speed:90,delay:0,tx:120,tz:0}]};
   audio.incoming(state);audio.incoming(state);
   result.diveAdmitted=audio.voices;
  }
  if(mode==='stress'){
   audio.master.gain.cancelScheduledValues(0);audio.master.gain.value=1;
   for(let i=0;i<80;i++)audio.sample(i%2?'ballisticLaunch':'rocketLaunch',0,i%2?1:-1,1,{delay:0});
   result.admitted=audio.voices;
  }
  const rendered=await context.startRendering(),channels=[rendered.getChannelData(0),rendered.getChannelData(1)];
  let peak=0,power=0,tail=0;
  const bytes=new Uint8Array(rendered.length*4),view=new DataView(bytes.buffer);
  for(let i=0;i<rendered.length;i++)for(let ch=0;ch<2;ch++){
   const v=channels[ch][i];if(!Number.isFinite(v))throw Error('Nonfinite missile PCM');
   peak=Math.max(peak,Math.abs(v));power+=v*v;if(i>rate*3)tail+=v*v;
   view.setInt16(i*4+ch*2,Math.round(Math.max(-1,Math.min(1,v))*32767),true);
  }
  result[mode]={peak,rms:Math.sqrt(power/(rendered.length*2)),tail:Math.sqrt(tail/(rendered.length*2)),voices:audio.voices};
  if(mode!=='stress'){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));result[mode].pcm=btoa(binary);}
 }
 return result;
}'''

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--disable-gpu'])
    try:
        page=browser.new_page()
        result=page.evaluate(RENDER,sources())
        result['voiceCap']=page.evaluate(VOICE_CAP_RENDER,sources())
        validate_cap(result['voiceCap'])
    finally: browser.close()
assert result['admitted']==12
assert result['diveAdmitted']==1
assert all(result[name]['voices']==0 for name in ['rocket','ballistic','dive','stress'])
assert .05<result['stress']['peak']<=.99
assert all(.001<result[name]['rms']<.2 for name in ['rocket','ballistic','dive'])
assert result['rocket']['rms']!=result['ballistic']['rms']
ARTIFACTS.mkdir(parents=True,exist_ok=True)
for name,value in result.items():
    if not isinstance(value,dict) or 'pcm' not in value: continue
    target=ARTIFACTS/f'audio-{name}-89.wav'
    with wave.open(str(target),'wb') as out:
        out.setnchannels(2);out.setsampwidth(2);out.setframerate(44100)
        out.writeframes(base64.b64decode(value.pop('pcm')))
    value['preview']=str(target)
(ARTIFACTS/'audio-missiles-89.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result,indent=2))

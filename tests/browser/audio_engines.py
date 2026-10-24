"""Recorded UAV engines through actual Web Audio; no game or WebGL."""
import base64
import json
import wave
from playwright.sync_api import sync_playwright
from audio import sources
from support import ARTIFACTS

RENDER = r'''async url=>{
 const {GameAudio}=await import(url),result={};
 const rate=44100;
 for(const mode of ['fpv','drone','heavy','far','paused','muted','stress','flyby']){
  const context=new OfflineAudioContext(2,rate*6,rate),audio=new GameAudio();audio.unlock(context);
  const camera={position:{x:0,y:40,z:0},matrixWorld:{elements:[1,0,0,0]}};
  const unit={id:1,side:0,hp:100,delay:0,status:'flying',x:120,y:60,z:0,vx:0,vy:0,vz:0,key:mode==='heavy'?'heavy':'drone',...(mode==='fpv'?{subtype:'fpv'}:{})};
  if(mode==='far')unit.x=850;
  if(mode==='flyby'){unit.x=600;unit.vx=-200;unit.subtype='fpv';}
  const state={units:mode==='stress'?Array.from({length:100},(_,i)=>({...unit,id:i+1,x:i%10,subtype:i%2?'fpv':undefined})): [unit],buildings:[],groundUnits:[]};
  if(mode==='muted')audio.set(false,0);
  if(mode==='stress'){audio.master.gain.cancelScheduledValues(0);audio.master.gain.value=1;}
  audio.update(state,camera,mode==='paused');
  let rendering;
  if(mode==='flyby'){
   let suspended=context.suspend(.25);rendering=context.startRendering();
   for(let at=.25;at<6;at+=.25){await suspended;unit.x=600-200*at;audio.update(state,camera,false);if(at+.25<6)suspended=context.suspend(at+.25);await context.resume();}
  }else rendering=context.startRendering();
  const buffer=await rendering,channels=[buffer.getChannelData(0),buffer.getChannelData(1)];
  let peak=0,power=0,difference=0;
  for(let i=0;i<buffer.length;i++){
   for(const channel of channels){if(!Number.isFinite(channel[i]))throw Error('Nonfinite engine sample');peak=Math.max(peak,Math.abs(channel[i]));power+=channel[i]**2;}
   difference+=(channels[0][i]-channels[1][i])**2;
  }
  result[mode]={peak,rms:Math.sqrt(power/(2*buffer.length)),stereo:Math.sqrt(difference/buffer.length),engineNodes:audio.engines.length,active:audio.activeEngines};
  if(['fpv','drone','heavy','flyby'].includes(mode)){
   const bytes=new Uint8Array(buffer.length*4),view=new DataView(bytes.buffer);
   for(let i=0;i<buffer.length;i++)for(let ch=0;ch<2;ch++)view.setInt16(i*4+ch*2,Math.round(Math.max(-1,Math.min(1,channels[ch][i]))*32767),true);
   let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));result[mode].pcm=btoa(binary);
  }
 }
 return result;
}'''

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--disable-gpu'])
    try:
        result=browser.new_page().evaluate(RENDER,sources())
    finally:
        browser.close()
assert result['paused']['peak']<1e-7
assert result['muted']['peak']<1e-7
assert result['stress']['peak']<=.99
assert result['stress']['active']==5
assert all(value['engineNodes']==10 for value in result.values())
assert result['drone']['rms']>result['far']['rms']*4
assert all(result[name]['rms']>.0005 for name in ['fpv','drone','heavy'])
assert result['flyby']['stereo']>.001
ARTIFACTS.mkdir(parents=True,exist_ok=True)
for name,value in result.items():
    if 'pcm' not in value: continue
    target=ARTIFACTS/f'audio-engine-{name}.wav'
    with wave.open(str(target),'wb') as output:
        output.setnchannels(2);output.setsampwidth(2);output.setframerate(44100)
        output.writeframes(base64.b64decode(value.pop('pcm')))
    value['preview']=str(target)
(ARTIFACTS/'audio-engines.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result,indent=2))
print('Recorded UAV engine regression passed; no game or WebGL loaded.')

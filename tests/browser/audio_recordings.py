"""Real downloaded ordnance through OfflineAudioContext; no WebGL or user campaign."""
import argparse
import base64
import ctypes
import json
import os
import wave
from playwright.sync_api import sync_playwright
from audio import sources, VOICE_CAP_RENDER, validate_cap
from support import ARTIFACTS

if os.name == 'nt':
    from ctypes import wintypes
    ctypes.windll.kernel32.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)

RENDER = r'''async ({url,wav})=>{
 const {GameAudio}=await import(url),result={};const rate=22050;
 let seed=8112;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 const empty={sides:[{},{}],units:[],projectiles:[],buildings:[],groundUnits:[],time:100};
 const camera={position:{x:0,y:420,z:420},matrixWorld:{elements:[1,0,0,0]}};
 for(const mode of ['mlrs','artillery','ballistic','cruise','incoming','farBallistic','flight','pressure','stress','mute']){
  const context=new OfflineAudioContext(2,rate*9,rate),audio=new GameAudio();audio.unlock(context);await audio.ready;
  audio.update(empty,camera,false);
  if(mode==='mute')audio.set(false,0);
  const launch={type:'launch',key:'ballistic',x:0,y:2,z:0};
  if(mode==='mlrs')audio.play({type:'shot',key:'cannon',shooter:'mlrs',ground:true,x:0,y:2,z:0});
  if(mode==='artillery')audio.play({type:'shot',key:'cannon',shooter:'howitzer',ground:true,x:0,y:2,z:0});
  if(mode==='ballistic'||mode==='mute')audio.play(launch);
  if(mode==='cruise')audio.play({...launch,key:'cruise'});
  if(mode==='farBallistic')audio.play({type:'launch',key:'ballistic'},2500,.2);
  if(mode==='incoming')audio.incoming({...empty,units:[{id:99,key:'ballistic',hp:10,total:100,travelled:10,speed:90,delay:0,tx:0,tz:0}]});
  if(mode==='flight')audio.update({...empty,units:[{id:99,key:'cruise',hp:10,delay:0,status:'flying',x:0,y:160,z:0,vx:50,vy:0,vz:0}]},camera,false);
  if(mode==='pressure'){
   for(let i=0;i<8;i++)audio.sample('rifle',10,0,.5,{delay:1});
   audio.play(launch);
   result.priorityAdmitted=[...audio.activeSamples].filter(voice=>voice.name==='ballisticLaunch').length;
   result.pressureVoices=audio.voices;
  }
  if(mode==='stress'){
   audio.master.gain.cancelScheduledValues(0);audio.master.gain.value=1;
   for(let i=0;i<80;i++)audio.sample(i%2?'ballisticLaunch':'rocketLaunch',0,i%2?1:-1,1.6,{delay:0});
   result.stressVoices=audio.voices;
  }
  const rendered=await context.startRendering(),channels=[rendered.getChannelData(0),rendered.getChannelData(1)];
  let peak=0,power=0,bass=0,tail=0,low=0;const alpha=1-Math.exp(-2*Math.PI*180/rate);
  for(let i=0;i<rendered.length;i++){
   const mono=(channels[0][i]+channels[1][i])*.5;low+=alpha*(mono-low);bass+=low*low;
   for(let ch=0;ch<2;ch++){const v=channels[ch][i];if(!Number.isFinite(v))throw Error('Nonfinite recorded audio');peak=Math.max(peak,Math.abs(v));power+=v*v;if(i>rate*3)tail+=v*v;}
  }
  result[mode]={peak,rms:Math.sqrt(power/(rendered.length*2)),bass:Math.sqrt(bass/rendered.length),tail:Math.sqrt(tail/(rendered.length*2)),voicesAfter:audio.voices,recordsAfter:audio.activeSamples.size};
  if(wav&&['mlrs','artillery','ballistic','incoming','flight'].includes(mode)){
   const bytes=new Uint8Array(rendered.length*4),view=new DataView(bytes.buffer);
   for(let i=0;i<rendered.length;i++)for(let ch=0;ch<2;ch++)view.setInt16(i*4+ch*2,Math.round(Math.max(-1,Math.min(1,channels[ch][i]))*32767),true);
   let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));result[mode].pcm=btoa(binary);
  }
 }
 return result;
}'''

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--wav', action='store_true')
args = parser.parse_args()
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--disable-gpu'])
    try:
        page = browser.new_page()
        result = page.evaluate(RENDER, {'url': sources(), 'wav': args.wav})
        result['voiceCap'] = page.evaluate(VOICE_CAP_RENDER, sources())
        validate_cap(result['voiceCap'])
    finally:
        browser.close()
assert result['priorityAdmitted'] == 1 and result['pressureVoices'] == 9
assert result['stressVoices'] == 12
for name in ['mlrs', 'artillery', 'ballistic', 'cruise', 'incoming', 'farBallistic', 'flight', 'pressure', 'stress']:
    assert .0005 < result[name]['rms'] < .4, (name, result[name])
    assert 0 < result[name]['peak'] <= .99, (name, result[name])
    assert result[name]['voicesAfter'] == 0 and result[name]['recordsAfter'] == 0, (name, result[name])
assert result['farBallistic']['rms'] < result['ballistic']['rms'] * .7
assert result['ballistic']['bass'] > result['ballistic']['rms'] * .15
assert result['artillery']['bass'] > result['artillery']['rms'] * .1
assert result['mlrs']['tail'] > .0001
assert result['mute']['peak'] < 1e-7
for name, metrics in result.items():
    if not isinstance(metrics, dict) or 'pcm' not in metrics:
        continue
    target = ARTIFACTS/f'audio-recorded-{name}-8112.wav'
    with wave.open(str(target), 'wb') as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(22050)
        out.writeframes(base64.b64decode(metrics.pop('pcm')))
    metrics['preview'] = str(target)
(ARTIFACTS/'audio-recordings8112.json').write_text(json.dumps(result, indent=2), encoding='utf8')
print(json.dumps(result, ensure_ascii=True))

"""Measured battlefield distance, tails, cancellation and real Web Audio voice limits."""
import json
from playwright.sync_api import sync_playwright
from audio import sources, VOICE_CAP_RENDER, validate_cap
from support import ARTIFACTS

RENDER = r'''async url=>{
 const {GameAudio}=await import(url),rate=22050,result={events:{},cancellation:{}};
 const events={droneLaunch:{type:'launch',key:'drone'},cruiseLaunch:{type:'launch',key:'cruise'},ballisticLaunch:{type:'launch',key:'ballistic'},artillery:{type:'shot',key:'cannon',shooter:'howitzer',ground:true},blast:{type:'impact',key:'ballistic'}};
 function metrics(b,end=0){
  let peak=0,power=0,bassPower=0,tailPower=0,tailN=0,latePeak=0,first=null,last=null;
  const alpha=1-Math.exp(-2*Math.PI*180/rate);
  for(let ch=0;ch<2;ch++){let low=0;const data=b.getChannelData(ch);
   for(let i=0;i<data.length;i++){const v=data[i];if(!Number.isFinite(v))throw Error('Nonfinite battlefield PCM');
    peak=Math.max(peak,Math.abs(v));power+=v*v;low+=alpha*(v-low);bassPower+=low*low;
    if(Math.abs(v)>1e-6){first=first===null?i/rate:Math.min(first,i/rate);last=last===null?i/rate:Math.max(last,i/rate)}
    if(i/rate>end+.02&&i/rate<end+1.2){tailPower+=v*v;tailN++}
    if(i/rate>14)latePeak=Math.max(latePeak,Math.abs(v));
   }
  }
  return {peak,rms:Math.sqrt(power/(b.length*2)),bassRms:Math.sqrt(bassPower/(b.length*2)),tailRms:Math.sqrt(tailPower/Math.max(1,tailN)),firstAudible:first,lastAudible:last,latePeak};
 }
 async function setup(){
  const c=new OfflineAudioContext(2,rate*16,rate),a=new GameAudio();a.unlock(c);await a.ready;
  let seed=8131;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
  const info={sources:0,decodes:0,start:null,naturalEnd:0};
  const create=c.createBufferSource.bind(c),decode=c.decodeAudioData.bind(c);
  c.decodeAudioData=(...args)=>{info.decodes++;return decode(...args)};
  c.createBufferSource=()=>{info.sources++;const s=create(),start=s.start.bind(s);s.start=(at,offset=0,...args)=>{info.start=at;info.naturalEnd=Math.max(info.naturalEnd,at+(s.buffer.duration-offset)/s.playbackRate.value);return start(at,offset,...args)};return s};
  return {c,a,info};
 }
 for(const [name,event] of Object.entries(events)){
  result.events[name]={};
  for(const distance of [0,400,2000,4000,5000]){
   const {c,a,info}=await setup();a.play(event,distance,.2);const admitted=a.voices;
   const b=await c.startRendering();result.events[name][distance]={...info,admitted,...metrics(b,info.naturalEnd),voicesAfter:a.voices,recordsAfter:a.activeSamples.size};
  }
 }
 for(const mode of ['pause','mute','clear']){
  const {c,a,info}=await setup();a.play(events.blast,0,0);a.play(events.ballisticLaunch,4000,0);
  const stopped=c.suspend(.45),rendering=c.startRendering();await stopped;
  if(mode==='pause')a.update({sides:[{},{}],units:[],projectiles:[],buildings:[],groundUnits:[],time:1},{position:{x:0,y:100,z:0},matrixWorld:{elements:[1,0,0,0]}},true);
  else if(mode==='mute')a.set(false,0);else a.clearBattleAudio();
  const clearedVoices=a.voices,clearedRecords=a.activeSamples.size,before=info.sources;
  if(mode!=='clear')a.play(events.artillery,0,0);
  const blockedNewSources=info.sources-before;await c.resume();const b=await rendering;
  let afterClearPeak=0;for(let ch=0;ch<2;ch++)for(const v of b.getChannelData(ch).subarray(Math.ceil(rate*1.5)))afterClearPeak=Math.max(afterClearPeak,Math.abs(v));
  result.cancellation[mode]={...info,...metrics(b),clearedVoices,clearedRecords,blockedNewSources,afterClearPeak,voicesAfter:a.voices,recordsAfter:a.activeSamples.size};
 }
 result.bursts={};
 for(const name of ['rifle','blastLarge']){
  const {c,a,info}=await setup();for(let i=0;i<80;i++)a.sample(name,0,0,.6,{delay:0});
  const admitted=a.voices,b=await c.startRendering();result.bursts[name]={...info,admitted,...metrics(b),voicesAfter:a.voices};
 }
 return result;
}'''


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True, args=['--disable-gpu'])
        try:
            page = browser.new_page()
            url = sources()
            result = page.evaluate(RENDER, url)
            result['voiceCap'] = page.evaluate(VOICE_CAP_RENDER, url)
        finally:
            browser.close()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / 'audio-battlefield.json').write_text(json.dumps(result, indent=2), encoding='utf8')
    validate_cap(result['voiceCap'])
    for name, distances in result['events'].items():
        for distance, m in distances.items():
            assert m['sources'] == m['admitted'] == 1 and m['decodes'] == 0, (name, distance, m)
            assert 0 < m['peak'] < .99 and m['rms'] > 1e-6 and m['bassRms'] > 0, (name, distance, m)
            assert m['voicesAfter'] == m['recordsAfter'] == 0, (name, distance, m)
            assert m['latePeak'] < 1e-7, (name, distance, m)
        assert distances['5000']['rms'] < distances['0']['rms'], (name, distances)
        assert distances['0']['tailRms'] > 1e-7, (name, distances)
    for mode, m in result['cancellation'].items():
        assert m['clearedVoices'] == m['clearedRecords'] == m['voicesAfter'] == m['recordsAfter'] == 0, (mode, m)
        assert m['blockedNewSources'] == m['decodes'] == 0 and m['afterClearPeak'] < 1e-7, (mode, m)
    assert result['bursts']['rifle']['admitted'] == 8, result['bursts']
    assert result['bursts']['blastLarge']['admitted'] == 12, result['bursts']
    for m in result['bursts'].values():
        assert m['decodes'] == 0 and m['sources'] == m['admitted'] and m['voicesAfter'] == 0, m
        assert 0 < m['peak'] < .99, m
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()

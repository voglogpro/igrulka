"""Serial real WebAudio A/B against loud 8.13.2. Run only in an agreed browser window.
python tests/browser/audio_hybrid.py [--baseline b4bf9c4] [--wav]
No game, WebGL, network sample fetch or performance claims.
"""
import argparse
import base64
import json
import os
import wave
from audio import sources
from playwright.sync_api import sync_playwright
from support import ARTIFACTS

RENDER = r"""async ({baseline, hybrid, wav}) => {
 window.Worker = undefined; // deterministic seeded PCM preparation in this isolated fixture
 const modules = {baseline: await import(baseline), hybrid: await import(hybrid)}, result = {};
 let seed = 73;
 Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
 // Prepare the baseline first and use its exact original PCM bank for both paths.
 // This deliberately isolates mixer A/B from random preset-variant generation.
 let originalBank;
 const baselineSignals={};
 for (const variant of ['baseline','hybrid']) {
  result[variant]={};
  const {GameAudio}=modules[variant], rate=22050;
  for(const mode of ['near','far','stress','muted','paused','rifle','rain']) {
   const context=new OfflineAudioContext(2,rate*10,rate), audio=new GameAudio();
   audio.unlock(context); await audio.ready;
   if(!originalBank)originalBank=audio.buffers;
   audio.buffers=originalBank;
   // renderBuffers() has already assigned its own bank's random impulse.
   // Sharing only the PCM lookup table would leave unequal outdoor reflections.
   audio.reverb.buffer=originalBank.impulse;
   seed=8132; // identical variation/selection at the admitted event boundary
   if(mode==='rain') {
    audio.update({units:[],projectiles:[],groundUnits:[],buildings:[],time:0,weather:{kind:'rain',amount:1}},
      {position:{x:0,y:200,z:0},matrixWorld:{elements:[1,0,0,0]}},false);
   } else if(mode==='rifle') {
    audio.sample('rifle',250,.25,1,{delay:0});
   } else if(mode==='stress') {
    audio.set(true,1);audio.master.gain.cancelScheduledValues(0);audio.master.gain.value=1;
    for(let i=0;i<80;i++)audio.sample('blastLarge',0,(i%2)*2-1,1.6,{delay:0});
   } else {
    audio.sample('blastLarge',mode==='far'?2500:25,.25,1.6,{delay:0,force:true});
    if(mode==='muted')audio.set(false,0);
    if(mode==='paused')audio.update({units:[],projectiles:[],groundUnits:[],buildings:[],time:0},
      {position:{x:0,y:0,z:0},matrixWorld:{elements:[1,0,0,0]}},true);
   }
   const admitted=audio.voices, buffersBefore=audio.diagnostics().bank;
   const output=await context.startRendering(), channels=[output.getChannelData(0),output.getChannelData(1)];
   let peak=0, sum=0, attack=0, tail=0, bass=0, low=0, first=0;
   for(let i=0;i<output.length;i++) {
    low+=(1-Math.exp(-2*Math.PI*180/rate))*((channels[0][i]+channels[1][i])*.5-low);
    bass+=low*low;
    for(const ch of channels) {
     const value=ch[i]; if(!Number.isFinite(value))throw Error('Nonfinite PCM');
     peak=Math.max(peak,Math.abs(value));sum+=value*value;
     if(i<rate*.12)attack+=value*value;
     if(i>rate*.35&&i<rate*1.8)tail+=value*value;
     if(i<rate*.025)first=Math.max(first,Math.abs(value));
    }
   }
   const metric={peak,firstPeak:first,rms:Math.sqrt(sum/(output.length*2)),
     attackRms:Math.sqrt(attack/(Math.floor(rate*.12)*2)),tailRms:Math.sqrt(tail/(rate*1.45*2)),
     bassRms:Math.sqrt(bass/output.length),admitted,voicesAfter:audio.voices,
     enginePool:audio.engines.length,bankBefore:buffersBefore,bankAfter:audio.diagnostics().bank};
   if(['rifle','rain'].includes(mode)) {
    if(variant==='baseline')baselineSignals[mode]=channels.map(ch=>ch.slice());
    else {
     let maxDiff=0,squaredDiff=0;
     for(let c=0;c<2;c++)for(let i=0;i<output.length;i++) {
      const delta=channels[c][i]-baselineSignals[mode][c][i];
      maxDiff=Math.max(maxDiff,Math.abs(delta));squaredDiff+=delta*delta;
     }
     metric.pcmMaxDiff=maxDiff;metric.pcmRmsDiff=Math.sqrt(squaredDiff/(output.length*2));
    }
   }
   if(wav&&['near','far'].includes(mode)) {
    const bytes=new Uint8Array(output.length*4), view=new DataView(bytes.buffer);
    for(let i=0;i<output.length;i++)for(let c=0;c<2;c++)view.setInt16((i*2+c)*2,Math.round(Math.max(-1,Math.min(1,channels[c][i]))*32767),true);
    let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    metric.pcm=btoa(binary);
   }
   result[variant][mode]=metric;
  }
 }
 return result;
}"""

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--baseline',default='b4bf9c4')
    parser.add_argument('--wav',action='store_true')
    args=parser.parse_args()
    if os.name=='nt':
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(),0x00004000)
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True,args=['--disable-gpu'])
        try:
            result=browser.new_page().evaluate(RENDER,{'baseline':sources(args.baseline),'hybrid':sources(),'wav':args.wav})
        finally:
            browser.close()
    for variant in result:
        for mode,m in result[variant].items():
            if 'pcm' in m:
                target=ARTIFACTS/f'audio-hybrid-{variant}-{mode}.wav'
                with wave.open(str(target),'wb') as out:
                    out.setnchannels(2);out.setsampwidth(2);out.setframerate(22050)
                    out.writeframes(base64.b64decode(m.pop('pcm')))
                m['preview']=str(target)
    # Persist every metric (and previews above) before any acceptance assertion.
    # A failed A/B must remain inspectable, including near/far peak and stress.
    result['baselineRevision']=args.baseline
    (ARTIFACTS/'audio-hybrid8133.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2),flush=True)
    for variant in ['baseline','hybrid']:
        for mode,m in result[variant].items():
            assert m['peak']<=.99 and m['voicesAfter']==0,(variant,mode,m)
            assert m['enginePool']==12
            if mode=='stress':assert m['admitted']==44
    # Guard against repeating the quiet-base regression. Report both peak and energy.
    for mode in ['near','far']:
        old=result['baseline'][mode];new=result['hybrid'][mode]
        assert new['attackRms']>=old['attackRms']*.95,(mode,old,new)
        assert new['peak']>=old['peak']*.9,(mode,old,new)
        assert new['tailRms']>old['tailRms']+1e-7,(mode,old,new)
        assert new['bassRms']>old['bassRms'],(mode,old,new)
    for mode in ['rifle','rain']:
        metric=result['hybrid'][mode]
        assert metric['pcmMaxDiff']<=1e-7 and metric['pcmRmsDiff']<=1e-8,(mode,metric)
        assert metric['rms']>1e-5,(mode,'unchanged signal must not be silent',metric)
    assert result['hybrid']['muted']['peak']<1e-7
    assert result['hybrid']['paused']['peak']<1e-7
    print('Hybrid A/B acceptance passed.',flush=True)

if __name__=='__main__':
    main()

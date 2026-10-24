"""Real Web Audio regression, without the game, WebGL or a historical Git dependency.

Run: python tests/browser/audio.py --wav
Optional baseline: python tests/browser/audio.py --compare dc63e9b
"""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import wave

from playwright.sync_api import sync_playwright
from support import ARTIFACTS, ROOT


def module_url(text):
    return 'data:text/javascript;base64,' + base64.b64encode(text.encode()).decode()


def sources(revision=None):
    def read(path):
        if revision:
            return subprocess.check_output(
                ['git', 'show', f'{revision}:{path}'], cwd=ROOT
            ).decode('utf-8')
        return (ROOT / path).read_text(encoding='utf-8')
    synth = module_url(read('src/audio/synth.js'))
    return module_url(read('src/audio/game-audio.js').replace("'./synth.js'", json.dumps(synth)))


RENDER = r'''async ({url, wav}) => {
  let seed = 73;
  Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const {GameAudio} = await import(url), out = {};
  const rate = 44100;
  const camera = {position:{x:0,y:100,z:0},matrixWorld:{elements:[1,0,0,0]}};
  const state = {units:[{side:1,hp:1,delay:0,status:'flying',x:0,y:0,z:0,key:'heavy'}],
    buildings:[{side:0,hp:10,x:0,z:0}],groundUnits:[]};
  for (const mode of ['siren','blast','stress','mute','demo']) {
    const context = new OfflineAudioContext(2, rate * 8, rate), audio = new GameAudio();
    audio.unlock(context);
    for(let i=0; i<400 && !audio.buffers.reload; i++)
      await new Promise(resolve => setTimeout(resolve,5));
    if (!audio.buffers.reload || !audio.buffers.blastLarge) throw Error('Synthesis did not finish');
    if(mode === 'siren' || mode === 'demo') {
      audio.update(state,camera,false);
      // Isolate siren from engines selected by the same threat state.
      for(const voice of audio.engines) {
        voice.level.gain.cancelScheduledValues(0);
        voice.level.gain.value = mode === 'demo' && voice.kind === 'moped' ? 0.025 : 0;
      }
    }
    if(mode === 'blast' || mode === 'demo')
      audio.sample('blastLarge',250,.65,1.6,{delay:mode === 'demo' ? 2 : 0});
    if(mode === 'stress') {
      // value=1 immediately: stress the actual full-volume mix, including its first attack.
      audio.set(true,1);
      audio.master.gain.cancelScheduledValues(0);
      audio.master.gain.value = 1;
      for(let i=0;i<80;i++)audio.sample('blastLarge',0,(i%2)*2-1,1.6,{delay:0});
      out.admitted = audio.voices;
    }
    if(mode === 'mute') {
      audio.sample('blastLarge',0,0,1.6,{delay:0});
      audio.set(false,0);
    }
    const buffer = await context.startRendering();
    const channels = [buffer.getChannelData(0),buffer.getChannelData(1)];
    let peak=0,sum=0,tail=0,diff=0,bass=0,low=0,latePeak=0;
    const alpha=1-Math.exp(-2*Math.PI*180/rate);
    for(let i=0;i<buffer.length;i++) {
      low += alpha*((channels[0][i]+channels[1][i])*.5-low);
      bass += low*low;
      for(let ch=0;ch<2;ch++) {
        const value=channels[ch][i];
        if(!Number.isFinite(value))throw Error(`${mode}: nonfinite PCM`);
        peak=Math.max(peak,Math.abs(value));sum+=value*value;
        if(i>rate){tail+=value*value;latePeak=Math.max(latePeak,Math.abs(value));}
        if(ch===0)diff+=(value-channels[1][i])**2;
      }
    }
    out[mode]={peak,rms:Math.sqrt(sum/(buffer.length*2)),
      tail:Math.sqrt(tail/(buffer.length*2)),stereo:Math.sqrt(diff/buffer.length),
      bass:Math.sqrt(bass/buffer.length),latePeak,voices:audio.voices};
    if(wav && ['siren','blast','demo'].includes(mode)) {
      const bytes=new Uint8Array(buffer.length*4), view=new DataView(bytes.buffer);
      for(let i=0;i<buffer.length;i++)for(let ch=0;ch<2;ch++)
        view.setInt16((i*2+ch)*2,Math.round(Math.max(-1,Math.min(1,channels[ch][i]))*32767),true);
      let binary='';
      for(let at=0;at<bytes.length;at+=32768)
        binary+=String.fromCharCode(...bytes.subarray(at,at+32768));
      out[mode].pcm=btoa(binary);
    }
  }
  return out;
}'''


def validate(current):
    assert current['admitted'] == 44, current['admitted']
    assert 0.1 < current['stress']['peak'] <= 0.99, current['stress']
    assert all(current[name]['voices'] == 0 for name in ['siren','blast','stress','mute','demo'])
    assert current['mute']['latePeak'] < 1e-7, current['mute']
    blast = current['blast']
    assert blast['stereo'] > 0.005 and blast['tail'] > 0.005, blast
    assert blast['bass'] > 0.005 and blast['bass'] > blast['rms'] * 0.15, blast
    assert 0.005 < current['siren']['rms'] < 0.05, current['siren']
    assert current['siren']['rms'] < blast['rms'], 'Siren dominates representative distant blast'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compare', metavar='REVISION', help='Optional Git baseline (e.g. dc63e9b)')
    parser.add_argument('--wav', action='store_true', help='Export 8-second stereo listening previews')
    args = parser.parse_args()
    with sync_playwright() as playwright:
        options = {'headless': True, 'args': ['--disable-gpu']}
        chrome = os.environ.get('CHROME_PATH') or 'C:/Program Files/Google/Chrome/Application/chrome.exe'
        if Path(chrome).exists():
            options['executable_path'] = chrome
        browser = playwright.chromium.launch(**options)
        page = browser.new_page()
        result = {'current': page.evaluate(RENDER, {'url': sources(), 'wav': args.wav})}
        validate(result['current'])
        if args.compare:
            result['baseline'] = page.evaluate(RENDER, {'url': sources(args.compare), 'wav': False})
            result['baselineRevision'] = args.compare
        browser.close()
    for name, metrics in result['current'].items():
        if isinstance(metrics, dict) and 'pcm' in metrics:
            path = ARTIFACTS / f'audio-{name}.wav'
            with wave.open(str(path), 'wb') as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(44100)
                output.writeframes(base64.b64decode(metrics.pop('pcm')))
            metrics['preview'] = str(path.relative_to(ROOT))
    (ARTIFACTS / 'audio-offline.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))
    print('Audio offline regression passed; no game or WebGL loaded.')


if __name__ == '__main__':
    main()

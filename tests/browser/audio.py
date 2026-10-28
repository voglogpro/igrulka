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
    entry = ROOT / 'src/audio/game-audio.js'
    if revision:
        sha = subprocess.check_output(['git', 'rev-parse', '--verify', revision], cwd=ROOT).decode().strip()
        if len(sha) != 40 or any(c not in '0123456789abcdef' for c in sha):
            raise ValueError('Invalid revision')
        cache = ARTIFACTS / 'audio-source-cache' / sha
        assert cache.resolve().is_relative_to(ARTIFACTS.resolve())
        # The audio graph also uses the small shared team/ownership helper.
        paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', sha, 'src/audio', 'src/game/factions.js'], cwd=ROOT).decode().splitlines()
        for name in paths:
            target = cache / name
            assert target.resolve().is_relative_to(cache.resolve())
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(subprocess.check_output(['git', 'show', f'{sha}:{name}'], cwd=ROOT))
        entry = cache / 'src/audio/game-audio.js'
    # Bundle the actual module graph: adding a focused audio module must not break QA.
    script = "import{build}from'esbuild';import{existsSync}from'node:fs';import path from'node:path';const worker=path.join(path.dirname(process.argv[1]),'pcm-worker.js');const define={};if(existsSync(worker)){const w=await build({entryPoints:[worker],bundle:true,write:false,format:'iife',platform:'browser'});define.__SKYFRONT_AUDIO_WORKER_SOURCE__=JSON.stringify(w.outputFiles[0].text)}const r=await build({entryPoints:[process.argv[1]],bundle:true,write:false,format:'esm',platform:'browser',define});process.stdout.write(r.outputFiles[0].text);"
    code = subprocess.check_output(['node', '--input-type=module', '-e', script, str(entry)], cwd=ROOT).decode('utf8')
    return module_url(code)


RENDER = r'''async ({url, wav}) => {
  let seed = 73;
  Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const {GameAudio} = await import(url), out = {};
  const rate = 44100;
  const camera = {position:{x:0,y:100,z:0},matrixWorld:{elements:[1,0,0,0]}};
  const state = {sides:[{},{}],units:[{side:1,hp:1,delay:0,status:'flying',x:0,y:0,z:0,key:'heavy'}],
    buildings:[{side:0,hp:10,x:0,z:0}],groundUnits:[]};
  for (const mode of ['siren','blast','stress','mute','demo','rain','rainHigh','rainPaused','rainMuted']) {
    const context = new OfflineAudioContext(2, rate * 8, rate), audio = new GameAudio();
    audio.unlock(context);
    await audio.ready;
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
    if(mode.startsWith('rain')) {
      if(mode==='rainMuted')audio.set(false,0);
      const listener=mode==='rainHigh'?{...camera,position:{x:0,y:1500,z:0}}:camera;
      audio.update({...state,units:[],weather:{kind:'rain',amount:1}},listener,mode==='rainPaused');
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
    if(wav && ['siren','blast','demo','rain'].includes(mode)) {
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
    assert 0.0001 < current['rain']['rms'] < 0.015, current['rain']
    assert current['rainHigh']['rms'] < current['rain']['rms'] * .5, current['rainHigh']
    assert current['rainPaused']['peak'] < 1e-7, current['rainPaused']
    assert current['rainMuted']['peak'] < 1e-7, current['rainMuted']


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

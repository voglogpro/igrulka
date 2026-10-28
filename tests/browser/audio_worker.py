"""Actual file:// Web Audio worker/heartbeat proof, without WebGL."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from audio import sources
from support import ARTIFACTS

fixture=ARTIFACTS/'audio-worker.html'
fixture.write_text('''<!doctype html><meta charset="utf-8"><button id="start">Start audio</button><script type="module">
import {GameAudio} from '''+json.dumps(sources())+''';
const NativeAudio=window.AudioContext;window.contextCreateMs=0;window.AudioContext=class extends NativeAudio{constructor(...args){const t=performance.now();super(...args);window.contextCreateMs=performance.now()-t}};const audio=new GameAudio();window.audio=audio;window.gaps=[];window.longTasks=[];
new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:false});
let previous=performance.now();const timer=setInterval(()=>{const now=performance.now();gaps.push(now-previous);previous=now},16);
document.querySelector('#start').onclick=async()=>{const at=performance.now();audio.unlock();window.unlockMs=performance.now()-at;await audio.ready;window.coldDone=true;clearInterval(timer)};
</script>''',encoding='utf-8')
with sync_playwright() as p:
 browser=p.chromium.launch(channel='chrome',headless=True,args=['--disable-gpu'])
 page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  page.goto(fixture.as_uri());page.wait_for_function('Boolean(window.audio)',polling=100)
  page.click('#start');page.wait_for_function('window.coldDone===true',polling=100,timeout=60000)
  result=page.evaluate('''async()=>{
   const before=audio.diagnostics(),t=performance.now();audio.unlock();const repeatedUnlockMs=performance.now()-t;
   audio.sample('rifle',0,0,.3);const voice=audio.voices;
   return {rate:audio.context.sampleRate,coldUnlockMs:unlockMs,contextCreateMs,repeatedUnlockMs,heartbeatCount:gaps.length,maxHeartbeatGapMs:Math.max(...gaps),longTasks,bank:before.bank,enginePool:before.enginePool,voice};
  }''')
  # The speculative 48 kHz bank can precede a real 44.1 kHz device bank.
  # ready applies to the context actually playing, not the first Map entry.
  active_bank=next(bank for bank in result['bank'] if bank['rate']==result['rate'])
  assert active_bank['workerJobs']>0,result
  assert active_bank['rendered']==active_bank['total'],result
  assert result['enginePool']==12 and result['voice']==1,result
  assert result['heartbeatCount']>10,result
  assert result['coldUnlockMs']-result['contextCreateMs']<100,result
  assert not errors,errors
  result['errors']=errors
  print(json.dumps(result),flush=True)
 finally:browser.close()
(ARTIFACTS/'audio-worker-report.json').write_text(json.dumps(result,indent=2),encoding='utf-8')

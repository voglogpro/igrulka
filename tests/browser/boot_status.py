import json,re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
html=(ROOT/'index.html').read_text(encoding='utf-8')
bootstrap=re.search(r'<script>([\s\S]*?)</script>',html).group(1)
folder=ROOT/'artifacts/qa/boot-status';folder.mkdir(parents=True,exist_ok=True)
prefix='''<meta charset="utf-8"><div id="app"><div class="boot-loading" role="status">Загружаем город…</div></div><script>window.listeners=new Set();const add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window);window.addEventListener=(t,f,...a)=>{if(t==='error'||t==='unhandledrejection')listeners.add(t);return add(t,f,...a)};window.removeEventListener=(t,f,...a)=>{listeners.delete(t);return remove(t,f,...a)};</script>'''
fixture=folder/'truncated.html'
fixture.write_text(prefix+'<script>'+bootstrap.replace('30000','40')+'</script>',encoding='utf-8')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True,args=['--disable-gpu'])
 page=browser.new_page();page.goto(fixture.as_uri());page.wait_for_timeout(100)
 assert page.locator('.boot-loading button').count()==1
 assert 'ещё загружается' in page.locator('.boot-loading').inner_text()
 page.evaluate("window.dispatchEvent(new ErrorEvent('error',{message:'https://secret:password@private.invalid/stack'}))")
 assert 'Не удалось' in page.locator('.boot-loading').inner_text()
 assert 'secret' not in page.locator('.boot-loading').inner_text()
 page.evaluate("window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:'PRIVATE'}))")
 assert 'PRIVATE' not in page.locator('.boot-loading').inner_text()
 page.reload();page.evaluate("document.querySelector('#app').replaceChildren(document.createTextNode('READY'))")
 page.wait_for_timeout(100)
 assert page.locator('#app').inner_text()=='READY'
 assert page.evaluate('listeners.size')==0
 browser.close()
print(json.dumps({'truncatedHTML':'PASS','timeout':'PASS','errorAndRejectionSanitized':'PASS','successfulCleanup':'PASS','fileOrigin':'PASS'}))

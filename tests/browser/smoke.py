import json
import subprocess
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

report = {'errors': [], 'consoleErrors': [], 'network': [], 'checks': []}
server = subprocess.Popen(
    ['node', str(ROOT / 'scripts/dev-server.mjs'), '--no-open', '--port=0'],
    cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf8',
)
try:
    address = server.stdout.readline().strip().removeprefix('Skyfront: ')
    assert address.startswith('http://127.0.0.1:'), address
    with sync_playwright() as p:
        browser = launch_browser(p)
        for target, offline in [((ROOT / 'play/Skyfront.html').as_uri(), True), (address, False)]:
            context = browser.new_context(offline=offline, viewport={'width':1152,'height':768})
            page = context.new_page()
            page.set_default_timeout(90000)
            page.on('pageerror', lambda e: report['errors'].append(str(e)))
            page.on('console', lambda e: report['consoleErrors'].append(e.text[:1500]) if e.type=='error' else None)
            if offline:
                page.on('request', lambda r: report['network'].append(r.url) if r.url.startswith('http') else None)
            else:
                page.on('response', lambda r: report['errors'].append(f'HTTP {r.status} {r.url}') if r.status>=400 else None)
            page.goto(target, wait_until='load', timeout=120000)
            page.wait_for_function('Boolean(window.skyfront)')
            assert page.title().startswith('8.6.0')
            page.locator('[data-action="start"]').click()
            page.keyboard.press('Space')
            assert page.evaluate('skyfront.isPaused()')
            for name in ['attack','army','research','economy','settings','help']:
                page.evaluate('name=>skyfront.openPanel(name,true)', name)
                assert page.locator('#panel').is_visible()
            page.keyboard.press('Escape')
            page.evaluate('''()=>{const E=skyfront.engine,w=skyfront.getWorld(),s=w.state;
                for(const key of ['infantry','mog','apc','leopard','gepard','shilka'])s.groundUnits.push(E.makeGround(s,0,key,-500+s.groundUnits.length*16,70));
                w.sync();skyfront.selectArmy([s.groundUnits[0].id]);}''')
            assert page.locator('#formation').is_visible()
            assert page.evaluate('skyfront.getWorld().groundModels.size')==6
            assert page.evaluate('skyfront.getWorld().renderer.info.render.calls')>0
            report['checks'].append('offline bundle' if offline else 'source modules via HTTP')
            context.close()
        browser.close()
    assert not report['errors'] and not report['consoleErrors'] and not report['network'], report
    (ARTIFACTS / 'smoke-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(report),flush=True)
finally:
    server.terminate()
    server.wait(timeout=15)

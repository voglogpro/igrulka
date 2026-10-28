"""Poor-city UI regression using the ordinary paid campaign checkpoint.

First: node tests/soak/recovery-orders.mjs && npm run build
Then: python tests/browser/recovery_orders.py
The isolated profile never reads or writes the player's actual browser saves.
"""
import json
import subprocess
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

checkpoint = ARTIFACTS / 'recovery-orders8133-poor-save.json'
if not checkpoint.exists():
    generated = subprocess.run(['node', 'tests/soak/recovery-orders.mjs'], cwd=ROOT, capture_output=True, text=True, encoding='utf8')
    assert generated.returncode == 0, generated.stderr
raw = checkpoint.read_text(encoding='utf8')
fixture = json.loads(raw)
assert fixture['sides'][0]['credits'] == 0
road_id = next(r['id'] for r in fixture['roads'] if r['side'] == 0 and r.get('removed') and not r.get('connectorTo'))
report = {'errors': [], 'requests': [], 'checks': []}

with sync_playwright() as p:
    browser = launch_browser(p)
    try:
        context = browser.new_context(offline=True, viewport={'width': 1024, 'height': 600})
        context.add_init_script("if(!localStorage.getItem('skyfront-realtime-v3'))localStorage.setItem('skyfront-realtime-v3'," + json.dumps(raw) + ");")
        page = context.new_page()
        page.set_default_timeout(90000)
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.on('request', lambda r: report['requests'].append(r.url) if r.url.startswith('http') else None)

        def start_paused():
            page.wait_for_function('Boolean(window.skyfront)&&skyfront.getWorld().shadersReady')
            page.locator('[data-action="start"]').click()
            page.wait_for_function('!skyfront.isPaused()')
            page.keyboard.press('Space')
            assert page.evaluate('skyfront.isPaused()')

        def status():
            return page.evaluate('''()=>{const E=skyfront.engine,s=skyfront.getWorld().state;
                return {credits:s.sides[0].credits,road:s.sides[0].roadRecovery,
                    order:E.factoryOrderStatus(s,0),stock:E.weaponStock(s,0,'drone'),
                    connected:E.economy(s,0).connected};}''')

        page.goto((ROOT / 'play/Skyfront.html').as_uri(), wait_until='load', timeout=120000)
        start_paused()
        assert page.title().startswith('8.13.3')
        page.evaluate('skyfront.openPanel("attack",true)')
        page.locator('[data-factory-order-quantity="20"]').click()
        assert page.locator('#factory-order-count').input_value() == '20'
        order_button = page.locator('[data-produce="drone"]')
        assert order_button.is_enabled() and order_button.inner_text() == '+20'
        order_button.click()
        page.wait_for_function('skyfront.engine.factoryOrderStatus(skyfront.getWorld().state,0).unpaid===20')
        queued = status()
        assert queued['credits'] == 0 and queued['order']['paid'] == 0
        assert 'Ожидание денег' in page.locator('#queue-status').inner_text()
        queue_bounds = page.locator('#queue-status').bounding_box()
        assert queue_bounds and queue_bounds['y'] + queue_bounds['height'] <= 600, queue_bounds
        page.wait_for_timeout(350)
        page.screenshot(path=str(ARTIFACTS / 'recovery-orders8133-queue.png'))
        report['checks'].append('20 can be ordered at zero funds without payment')

        page.evaluate('skyfront.save()')
        page.reload(wait_until='load')
        start_paused()
        assert status()['order']['unpaid'] == 20
        report['checks'].append('actual browser save and reload preserve unpaid order')
        page.evaluate('skyfront.openPanel("economy",true)')
        recovery = page.locator('#road-recovery')
        assert recovery.is_visible()
        page.locator('#road-recovery-site').select_option(str(road_id))
        start = page.locator('#road-recovery-start')
        assert start.is_enabled()
        bounds = start.bounding_box()
        assert bounds and bounds['y'] >= 0 and bounds['y'] + bounds['height'] <= 600, bounds
        start.click()
        page.wait_for_function('Boolean(skyfront.getWorld().state.sides[0].roadRecovery)')
        page.evaluate('''()=>{const w=skyfront.getWorld();skyfront.engine.advance(w.state,15);w.sync();skyfront.openPanel('economy',true);}''')
        mid = status()
        assert mid['credits'] == 0 and mid['road']['paid'] > 26.9
        assert mid['connected'] == 0
        page.wait_for_timeout(350)
        page.screenshot(path=str(ARTIFACTS / 'recovery-orders8133-recovery.png'))
        report['checks'].append('removed road can be restored from visible economy control at zero funds')

        page.evaluate('''()=>{const w=skyfront.getWorld(),E=skyfront.engine;for(let i=0;i<60;i++){
            E.advance(w.state,1);if(E.factoryOrderStatus(w.state,0).paid>0)break;}
            w.sync();skyfront.openPanel('attack',true);}''')
        first = status()
        assert first['road'] is None and first['connected'] >= 14
        assert first['order']['paid'] == 1 and first['order']['unpaid'] == 19
        cash = first['credits']
        page.locator('[data-cancel-production="drone"]').click()
        page.wait_for_function('skyfront.engine.factoryOrderStatus(skyfront.getWorld().state,0).unpaid===0')
        canceled = status()
        assert canceled['credits'] == cash and canceled['order']['paid'] == 1
        page.evaluate('''()=>{const w=skyfront.getWorld();skyfront.engine.advance(w.state,50);w.sync();}''')
        final = status()
        assert final['stock'] == 1 and final['order']['unpaid'] == final['order']['paid'] == 0
        report['checks'].append('real production charges one drone, cancellation leaves that paid drone intact')
        report.update({'queued': queued, 'midRecovery': mid, 'firstPayment': first, 'afterCancel': canceled, 'final': final})
        assert not report['errors'] and not report['requests'], report
    finally:
        browser.close()

(ARTIFACTS / 'recovery-orders8133-browser.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps({'passed': True, 'checks': report['checks'], 'errors': report['errors']}), flush=True)

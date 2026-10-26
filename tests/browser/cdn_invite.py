"""Real CDN invite against an existing internet host; never starts/stops servers."""
import argparse
import json
import time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
from support import ARTIFACTS, launch_browser

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True, help='Existing local internet-host URL')
args = parser.parse_args()
report = {'errors': [], 'checks': []}
with sync_playwright() as p:
    browser = launch_browser(p)
    contexts = [browser.new_context(viewport={'width': 1152, 'height': 768}) for _ in range(2)]
    pages = [c.new_page() for c in contexts]
    host, guest = pages
    try:
        for page in pages:
            page.set_default_timeout(60000)
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.add_init_script('window.requestAnimationFrame=()=>0;')
        host.goto(args.url.rstrip('/') + '/?multiplayer=1', wait_until='load')
        host.wait_for_function('Boolean(window.skyfront)', polling=100)
        host.locator('#net-name').fill('CDN probe host')
        host.locator('[data-net-mode="coop"]').click()
        host.locator('[data-net="create"]').click()
        host.wait_for_function('document.querySelector("#net-invite-link")?.value.includes("?room=")&&!document.querySelector("[data-net=copy]").disabled', polling=100)
        invitation = host.locator('#net-invite-link').input_value()
        parsed = urlparse(invitation)
        assert parsed.hostname == 'voglogpro.github.io', 'Invitation must use the configured CDN'
        assert parse_qs(parsed.query).get('server', [''])[0].startswith('wss://'), 'CDN invite needs its public WSS endpoint'
        started = time.monotonic()
        guest.goto(invitation, wait_until='domcontentloaded', timeout=90000)
        guest.wait_for_function('Boolean(window.skyfront)', timeout=90000, polling=100)
        report['cdnAppReadySeconds'] = round(time.monotonic()-started, 3)
        report['cdnNavigation'] = guest.evaluate('''()=>{const n=performance.getEntriesByType('navigation')[0];return {firstByteMs:n.responseStart,downloadMs:n.responseEnd-n.responseStart,transferBytes:n.transferSize}}''')
        report['cdnTitle'] = guest.title()
        assert '8.11.1' in report['cdnTitle']
        guest.locator('#net-name').fill('CDN probe guest')
        guest.locator('[data-net="join"]').click()
        guest.locator('[data-net="ready"]').wait_for()
        host.locator('[data-net="ready"]').click()
        guest.locator('[data-net="ready"]').click()
        host.locator('[data-net="start"]').click()
        for page in pages:
            page.wait_for_function('skyfront.network()?.room.phase==="playing"&&skyfront.getState().sides.length===4', polling=100)
            assert page.evaluate('skyfront.getState().buildings.filter(b=>b.key==="hq").length') == 4
        assert host.evaluate('skyfront.network().side') == 0
        assert guest.evaluate('skyfront.network().side') == 2
        report['checks'].append('real CDN invitation joins public WSS, both ready/start, sides 0/2 and four HQ')
        for owner in pages:
            road = owner.evaluate('''async()=>{const E=skyfront.engine,s=skyfront.getState(),hq=E.hqOf(s,0);return await skyfront.command('road',{a:{x:hq.x,z:hq.z-45},b:{x:hq.x,z:hq.z-125}})}''')
            assert isinstance(road, dict) and 'id' in road, road
            for page in pages:
                page.wait_for_function('id=>skyfront.getState().roads.some(r=>r.id===id)', arg=road['id'], polling=100)
        report['checks'].append('paid road from each human synchronizes to both clients')
        guest.evaluate('skyfront.openPanel("settings",true)')
        guest.locator('#panel [data-action="network"]').click()
        guest.locator('[data-net="leave"]').click()
        for page in pages:
            page.wait_for_function('skyfront.network()===null', polling=100)
        report['checks'].append('own temporary room closed')
        assert not report['errors'], report['errors']
        print(json.dumps(report, ensure_ascii=False), flush=True)
    except Exception as error:
        report['failure'] = str(error)
        report['hostStatus'] = host.locator('#net-error').text_content(timeout=2000) if host.locator('#net-error').count() else ''
        raise
    finally:
        for page in pages:
            try:
                if page.evaluate('Boolean(window.skyfront?.network())'):
                    if not page.locator('[data-net=leave]').is_visible():
                        page.evaluate('skyfront.openPanel("settings",true)')
                        page.locator('#panel [data-action=network]').click(timeout=2000)
                    page.locator('[data-net=leave]').click(timeout=2000)
            except Exception:
                pass
        browser.close()
        (ARTIFACTS/'cdn-invite-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')

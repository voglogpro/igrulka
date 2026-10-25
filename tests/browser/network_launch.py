"""Portable HTML explains hosting, recovers from a stopped server and joins co-op."""
import json
import socket
import subprocess
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS, launch_browser

report = {'errors': [], 'checks': []}
server = subprocess.Popen(
    ['node', 'server/index.mjs', '--port=0'], cwd=ROOT,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf8',
)
unavailable = socket.socket()
unavailable.bind(('127.0.0.1', 0))
try:
    address = server.stdout.readline().strip().removeprefix('Skyfront multiplayer: ')
    assert address.startswith('http://127.0.0.1:'), address
    with sync_playwright() as p:
        browser = launch_browser(p)
        contexts = [browser.new_context(viewport={'width': 1152, 'height': 768}) for _ in range(2)]
        pages = [context.new_page() for context in contexts]
        for page in pages:
            page.set_default_timeout(90000)
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            # Simulation and UI remain real; this scenario does not test rendered frames.
            page.add_init_script('window.requestAnimationFrame=()=>0;')
        host, guest = pages
        host.goto((ROOT / 'play/Skyfront.html').as_uri() + '?multiplayer=1', wait_until='load')
        host.wait_for_function('Boolean(window.skyfront)')
        assert host.locator('#net-file-guide').is_visible()
        assert host.locator('#net-file-guide').evaluate("el=>!el.closest('details')")
        assert 'Играть через интернет.cmd' in host.locator('#net-file-guide').inner_text()
        host.screenshot(path=str(ARTIFACTS / 'network-launch-file-guide.png'))
        backup = host.evaluate('localStorage.getItem("skyfront-realtime-v3")')
        host.locator('[data-net-mode="coop"]').click()
        host.locator('.net-connection').evaluate('el=>el.open=true')
        host.locator('#net-address').fill('http://127.0.0.1:' + str(unavailable.getsockname()[1]))
        host.locator('[data-net="create"]').click()
        host.wait_for_function('document.querySelector("#net-error")?.classList.contains("warning")')
        failed = host.locator('#net-error').inner_text()
        assert 'восстановить' not in failed.lower(), failed
        assert host.evaluate('skyfront.network()===null')
        assert host.locator('[data-net="resume"]').count() == 0
        assert host.locator('[data-net="create"]').is_enabled()
        report['checks'].append('failed first connection never offers a nonexistent saved seat')
        report['failureMessage'] = failed
        host.locator('.net-connection').evaluate('el=>el.open=true')
        host.locator('#net-address').fill(address)
        host.locator('[data-net="create"]').click()
        host.locator('.net-room-code').wait_for()
        host.wait_for_function('document.querySelector("#net-invite-link")?.value.includes("?room=")&&!document.querySelector("[data-net=copy]").disabled')
        invitation = host.locator('#net-invite-link').input_value()
        assert invitation.startswith(address + '/?room='), invitation
        guest.goto(invitation, wait_until='load')
        guest.wait_for_function('Boolean(window.skyfront)')
        assert guest.locator('#net-file-guide').count() == 0
        guest.locator('[data-net="join"]').click()
        guest.locator('[data-net="ready"]').wait_for()
        host.locator('[data-net="ready"]').click()
        guest.locator('[data-net="ready"]').click()
        host.locator('[data-net="start"]').click()
        for page in pages:
            page.wait_for_function('skyfront.network()?.room.phase==="playing"&&skyfront.getState().sides.length===4')
            assert page.evaluate('skyfront.getState().buildings.filter(b=>b.key==="hq").length') == 4
        assert guest.evaluate('skyfront.network().side') == 2
        assert host.evaluate('localStorage.getItem("skyfront-realtime-v3")') == backup
        report['checks'].append('portable host retries with a running server and starts four-city co-op with an HTTP guest')
        roads = []
        for owner in pages:
            road = owner.evaluate('''async()=>{
                const E=skyfront.engine,s=skyfront.getState(),hq=E.hqOf(s,0);
                return await skyfront.command('road',{a:{x:hq.x,z:hq.z-45},b:{x:hq.x,z:hq.z-125}});
            }''')
            assert isinstance(road, dict) and 'id' in road, road
            roads.append(road['id'])
            for page in pages:
                page.wait_for_function('id=>skyfront.getState().roads.some(r=>r.id===id)', arg=road['id'])
        report['checks'].append('roads bought by either human city appear in both clients')
        report['sharedRoadIds'] = roads
        guest.evaluate('skyfront.openPanel("settings",true)')
        guest.locator('#panel [data-action="network"]').click()
        guest.locator('[data-net="leave"]').click()
        for page in pages:
            page.wait_for_function('skyfront.network()===null')
        browser.close()
    assert not report['errors'], report
    print(json.dumps(report, ensure_ascii=False), flush=True)
finally:
    unavailable.close()
    server.terminate()
    server.wait(timeout=15)
    (ARTIFACTS / 'network-launch-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')

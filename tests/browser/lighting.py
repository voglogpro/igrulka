import json,math
from pathlib import Path
from playwright.sync_api import sync_playwright

from support import ROOT as root, ARTIFACTS, launch_browser
report={'errors':[],'consoleErrors':[],'network':[]}
sample='''()=>{const w=skyfront.getWorld(),v=w.sun.position.clone().sub(w.sun.target.position).normalize();return {direction:[v.x,v.y,v.z],color:w.sun.color.toArray(),intensity:w.sun.intensity,time:w.state.time,x:w.controls.target.x,z:w.controls.target.z};}'''
def delta(a,b):return math.sqrt(sum((x-y)**2 for x,y in zip(a['direction'],b['direction'])))
with sync_playwright() as p:
    browser=launch_browser(p)
    context=browser.new_context(offline=True,viewport={'width':1000,'height':700},device_scale_factor=1)
    page=context.new_page();page.set_default_timeout(90000)
    page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.on('console',lambda e:report['consoleErrors'].append(e.text[:1500]) if e.type=='error' else None)
    page.on('request',lambda r:report['network'].append(r.url) if r.url.startswith('http') else None)
    def open_game(name):
        page.goto(((root/'play/Skyfront.html') if name=='skyfront-infantry8.html' else ARTIFACTS/'baseline-before-lighting8.html').as_uri(),wait_until='load',timeout=120000)
        page.wait_for_function('Boolean(window.skyfront)')
        page.locator('[data-action="start"]').click();page.keyboard.press('Space')
        assert page.evaluate('skyfront.isPaused()')
    def setup(time):
        page.evaluate('''time=>{const w=skyfront.getWorld();w.controls.focus(-500,0,300);w.controls.update(3);w.shadowFocus=w.controls.target.clone();w.state.time=time;w.lastDayUpdate=undefined;w.updateDaylight();}''',time)
    def pan():
        before=page.evaluate(sample);page.keyboard.down('w')
        page.wait_for_function('p=>Math.hypot(skyfront.getWorld().controls.target.x-p.x,skyfront.getWorld().controls.target.z-p.z)>45',arg=before)
        page.keyboard.up('w');return before,page.evaluate(sample)
    if ((ARTIFACTS/'baseline-before-lighting8.html')).exists():
        open_game('skyfront-before-lighting8.html');setup(1000)
        before,after=pan();old_delta=delta(before,after)
        assert old_delta>.5,(before,after)
        report['previousDirectionJumpDegrees']=math.degrees(2*math.asin(min(1,old_delta/2)))
        print('Reproduced old lighting direction jump while panning:',report['previousDirectionJumpDegrees'],flush=True)
    open_game('skyfront-infantry8.html')
    assert '8.8.0' in page.title()
    report['fixedPans']=[]
    for time in [0,700,1000]:
        setup(time);before,after=pan()
        assert delta(before,after)<1e-10,(before,after)
        assert before['color']==after['color'] and before['intensity']==after['intensity']
        report['fixedPans'].append({'time':time,'directionDelta':delta(before,after)})
    print('Fixed night, morning and afternoon lighting stays constant during actual WASD movement',flush=True)
    before=page.evaluate(sample)
    page.mouse.move(460,310);page.mouse.down(button='right');page.mouse.move(525,335,steps=3);page.mouse.up(button='right')
    page.wait_for_timeout(250)
    assert delta(before,page.evaluate(sample))<1e-10
    print('Right-drag rotation keeps lighting stable',flush=True)
    minimap=page.locator('#minimap');bounds=minimap.bounding_box()
    minimap.click(position={'x':bounds['width']*.7,'y':bounds['height']*.5})
    page.wait_for_function('skyfront.getWorld().controls.target.distanceTo(skyfront.getWorld().controls.desired)<1')
    assert delta(before,page.evaluate(sample))<1e-10
    print('Minimap jump keeps lighting stable',flush=True)
    report['rotationAndMinimapStable']=True
    page.evaluate('skyfront.getWorld().focus(-500,0,300)')
    page.wait_for_function('skyfront.getWorld().controls.target.distanceTo(skyfront.getWorld().controls.desired)<1')
    page.screenshot(path=str((ARTIFACTS/'lighting8-fixed.png')),timeout=120000)
    before=page.evaluate(sample);page.keyboard.press('Space')
    page.wait_for_function('t=>skyfront.getState().time>t+.4',arg=before['time'])
    page.keyboard.press('Space');after=page.evaluate(sample)
    assert after['time']>before['time'] and delta(before,after)<.03*(after['time']-before['time'])
    report['liveCycleContinues']=True
    report['liveDirectionDelta']=delta(before,after)
    report['shadowResolution']=page.evaluate('skyfront.getWorld().sun.shadow.mapSize.toArray()')
    assert not report['errors'] and not report['consoleErrors'] and not report['network'],report
    browser.close()
((ARTIFACTS/'lighting8-report.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report),flush=True)

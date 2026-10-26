"""Large army controls in an isolated DOM-only Chrome; no user save or WebGL."""
import json
import subprocess
from playwright.sync_api import sync_playwright
from support import ROOT, ARTIFACTS

ENTRY = r'''
import * as E from '../../src/game/index.js';
import {renderSquadRoster} from '../../src/ui/deployment.js';
import {recruitmentHTML, updateArmyRecruitment} from '../../src/ui/army-recruitment.js';
let state, ids;
const roster=document.querySelector('#groups-bar');
window.uiTest={
 setup(count=500) {
  state=E.createGame(8112);ids=[];
  for(let i=0;i<count;i++){
   const u=E.makeGround(state,0,'infantry',-1100,-300);
   u.squadId=10000+Math.floor(i/5);state.groundUnits.push(u);ids.push(u.id);
  }
  for(let n=1;n<=9;n++)state.groups[0][n]=ids.slice();
  renderSquadRoster(state,[]);
 },
 select(indices){renderSquadRoster(state,indices.map(i=>ids[i]));},
 removeFirst(){state.groundUnits[0].hp=0;renderSquadRoster(state,[]);},
 setupArmy(){
  state=E.createGame(8112);
  for(let i=0;i<40;i++){
   const u=E.makeGround(state,0,'infantry',-1100+(i%10)*8,-300+Math.floor(i/10)*8);
   u.autoDefense=true;u.stance={mode:'defend',post:'auto'};
   state.groundUnits.push(u);
  }
  document.querySelector('#panel').innerHTML=recruitmentHTML({state});
  this.updateArmy();
 },
 updateArmy(){updateArmyRecruitment({state,recruitCount:1});},
 status(){return E.defenseAttackStatus(state,0);},
 allLost(){for(const u of state.groundUnits)u.hp=0;this.updateArmy();},
};
window.clicked=[];
roster.addEventListener('click',e=>{
 const button=e.target.closest('button');if(button)clicked.push({...button.dataset});
});
'''


def bundle():
    entry = ARTIFACTS / 'army-roster-entry.mjs'
    entry.write_text(ENTRY, encoding='utf8')
    script = "import{build}from'esbuild';const r=await build({entryPoints:[process.argv[1]],bundle:true,write:false,format:'iife',platform:'browser'});process.stdout.write(r.outputFiles[0].text);"
    return subprocess.check_output(
        ['node', '--input-type=module', '-e', script, str(entry)], cwd=ROOT
    ).decode('utf8')


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--disable-gpu'])
    report = {'errors': [], 'conditions': 'DOM-only native Chrome, no WebGL or campaign storage'}
    try:
        page = browser.new_page(viewport={'width': 1280, 'height': 720}, offline=True)
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        css = '\n'.join((ROOT/'src/ui'/name).read_text(encoding='utf8') for name in ['style.css', 'army.css', 'recruitment.css'])
        page.set_content('<style>'+css+'</style><div id="game"><aside id="groups-bar" class="glass"></aside><aside id="panel" class="army-panel glass"></aside></div>')
        page.add_script_tag(content=bundle())
        page.evaluate('uiTest.setup(500)')
        assert page.locator('[data-squad]').count() == 100
        page.evaluate('window.keptWave=document.querySelector(\'[data-squad="10020"]\');window.keptRole=document.querySelector(\'[data-army-role="infantry"]\')')
        page.evaluate('uiTest.select([100])')
        assert page.locator('[data-squad="10020"]').evaluate('e=>e===keptWave&&e.classList.contains("active")')
        assert page.locator('[data-army-role="infantry"]').evaluate('e=>e===keptRole&&e.classList.contains("active")')
        page.evaluate('uiTest.select([499])')
        assert not page.locator('[data-squad="10020"]').evaluate('e=>e.classList.contains("active")')
        assert page.locator('[data-squad="10099"]').evaluate('e=>e.classList.contains("active")')
        assert page.locator('[data-roster-selected]').inner_text() == ' · выбрано 1'
        button = page.locator('[data-squad="10020"]')
        button.scroll_into_view_if_needed()
        rect = button.bounding_box()
        page.mouse.move(rect['x']+rect['width']/2, rect['y']+rect['height']/2)
        page.mouse.down()
        page.evaluate('uiTest.select([0])')
        page.mouse.up()
        assert page.evaluate('clicked.at(-1)?.squad') == '10020', 'polling between press and release must preserve the clickable button'
        report['roster'] = {'ground': 500, 'waves': 100, 'groups': 9, 'stableButtons': True, 'clickDuringPoll': True}
        page.evaluate('uiTest.removeFirst()')
        assert '499' in page.locator('.roster-head').inner_text()
        page.evaluate('uiTest.setupArmy()')
        attack = page.locator('[data-action="defense-attack"]')
        assert attack.count() == 1
        assert not attack.is_disabled()
        assert attack.inner_text() == 'В атаку · 30% (12)'
        for width, height in [(1280, 720), (1024, 600)]:
            page.set_viewport_size({'width': width, 'height': height})
            rect = attack.bounding_box()
            assert rect['x'] >= 0 and rect['y'] >= 0 and rect['x']+rect['width'] <= width and rect['y']+rect['height'] <= height, rect
        attack.evaluate('e=>e.dataset.pending="true"')
        page.evaluate('uiTest.updateArmy()')
        assert attack.is_disabled(), 'live polling must not re-enable an in-flight network command'
        attack.evaluate('e=>delete e.dataset.pending')
        page.evaluate('uiTest.updateArmy()')
        assert not attack.is_disabled()
        page.evaluate('uiTest.allLost()')
        assert attack.is_disabled()
        assert attack.inner_text() == 'В атаку · 30% (0)'
        report['attackButton'] = {'defenders': 40, 'dispatchedPreview': 12, 'pendingGuard': True, 'emptyDisabled': True}
        assert not report['errors'], report['errors']
    finally:
        browser.close()
    (ARTIFACTS/'army-roster8112.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(report, ensure_ascii=True))

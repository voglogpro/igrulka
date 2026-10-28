import subprocess
import sys
from pathlib import Path

folder = Path(__file__).resolve().parent
scenarios=['smoke','camera','infantry','army_controls','deployment','combat','migrations','lighting','territory_routes','production','logistics89','multiplayer','audio','audio_missiles','audio_ground','atmosphere','grain','frontline','audit891','coop_cities','network_launch','inspector_compact','settlement_cities','field_crates','audio_worker','army_roster','audio_recordings','audio_battlefield','defense_8112','depot_battle','native_army_input','army_logistics','selection_coverage','trenches_8131']
requested=sys.argv[1:] or scenarios
if any(name not in scenarios for name in requested):
    raise SystemExit('Unknown scenario. Choose: '+', '.join(scenarios))
failed=[]
for name in requested:
    print(f'Browser scenario: {name}', flush=True)
    result=subprocess.run([sys.executable, str(folder / (name + '.py'))])
    if result.returncode:
        failed.append(name)
        print(f'Browser scenario FAILED: {name} (exit {result.returncode})', flush=True)
if failed:
    raise SystemExit('Browser failures: '+', '.join(failed))
print(f'Browser scenarios passed: {len(requested)}/{len(requested)}', flush=True)

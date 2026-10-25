import subprocess
import sys
from pathlib import Path

folder = Path(__file__).resolve().parent
scenarios=['smoke','camera','infantry','army_controls','deployment','combat','migrations','lighting','territory_routes','production','logistics89','multiplayer','audio','audio_missiles','audio_ground','atmosphere','grain','frontline','audit891','coop_cities']
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

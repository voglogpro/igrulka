import subprocess
import sys
from pathlib import Path

folder = Path(__file__).resolve().parent
scenarios=['smoke','camera','infantry','army_controls','combat','migrations','lighting','multiplayer']
requested=sys.argv[1:] or scenarios
if any(name not in scenarios for name in requested):
    raise SystemExit('Unknown scenario. Choose: '+', '.join(scenarios))
for name in requested:
    print(f'Browser scenario: {name}', flush=True)
    subprocess.run([sys.executable, str(folder / (name + '.py'))], check=True)

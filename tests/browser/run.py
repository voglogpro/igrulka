import subprocess
import sys
from pathlib import Path

folder = Path(__file__).resolve().parent
for name in ['smoke', 'camera', 'infantry', 'combat', 'migrations', 'lighting']:
    print(f'Browser scenario: {name}', flush=True)
    subprocess.run([sys.executable, str(folder / (name + '.py'))], check=True)

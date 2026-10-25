"""Real two-browser invitation, independent allied cities, reconnect and solo recovery."""
import subprocess
import sys
from pathlib import Path

raise SystemExit(subprocess.run([sys.executable,str(Path(__file__).with_name('multiplayer.py')),'--coop',*sys.argv[1:]]).returncode)

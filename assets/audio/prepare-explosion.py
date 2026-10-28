"""Prepare the licensed field explosion; no generated noise or weapon layers."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import wave

ROOT = Path(__file__).resolve().parent
SOURCE_SHA = '03ede4462a6657fdd181fa65f9aab9d6fcc181be6cdbb2fb461ee2aa638da318'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', required=True, type=Path)
args = parser.parse_args()
assert hashlib.sha256(args.source.read_bytes()).hexdigest() == SOURCE_SHA, 'Unexpected source'
raw = subprocess.check_output([
    shutil.which('ffmpeg') or 'ffmpeg', '-v', 'error', '-threads', '1',
    '-i', str(args.source), '-t', '4.4', '-af', 'highpass=f=28,lowpass=f=6500',
    '-ac', '1', '-ar', '16000', '-f', 'f32le', '-',
])
samples = list(struct.unpack('<%df' % (len(raw) // 4), raw))
dc = sum(samples) / len(samples)
samples = [x - dc for x in samples]
gain = 0.72 / max(abs(x) for x in samples)
for i, value in enumerate(samples):
    edge = min(1, i / 48, (len(samples) - 1 - i) / 6400)
    samples[i] = round(value * gain * edge * 32767)
target = ROOT / 'explosion-field.wav'
with wave.open(str(target), 'wb') as out:
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(16000)
    out.writeframes(struct.pack('<%dh' % len(samples), *samples))
print(json.dumps({'file': str(target), 'bytes': target.stat().st_size,
                  'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                  'seconds': len(samples) / 16000, 'peak': max(abs(x) for x in samples) / 32767}))

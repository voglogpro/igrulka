"""Rebuild small PCM assets from verified real recordings; no synthesized weapon layer.

Requires FFmpeg on PATH. Reuse downloaded files with --sources-dir artifacts/qa.
Without cached files the public source URLs are downloaded with normal TLS checks.
"""
import argparse
import array
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import urllib.request
import wave

HERE = Path(__file__).resolve().parent
creation_flags = 0
if os.name == 'nt':
    import ctypes
    from ctypes import wintypes
    ctypes.windll.kernel32.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
    creation_flags = subprocess.BELOW_NORMAL_PRIORITY_CLASS | subprocess.CREATE_NO_WINDOW
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--sources-dir', type=Path, default=HERE.parents[1]/'artifacts/audio-sources')
parser.add_argument('--proxy')
args = parser.parse_args()
args.sources_dir.mkdir(parents=True, exist_ok=True)
manifest = json.loads((HERE/'ordnance-sources.json').read_text(encoding='utf8'))
opener = urllib.request.build_opener(urllib.request.ProxyHandler({'https': args.proxy}) if args.proxy else urllib.request.ProxyHandler())
for source in manifest['sources'].values():
    target = args.sources_dir/source['file']
    if not target.exists():
        with opener.open(source['download'], timeout=60) as response:
            target.write_bytes(response.read(70_000_001))
    raw = target.read_bytes()
    if len(raw) > 70_000_000 or hashlib.sha256(raw).hexdigest() != source['sha256']:
        raise ValueError('Unexpected source bytes: '+source['file'])

report = []
for clip in manifest['clips']:
    source = args.sources_dir/manifest['sources'][clip['source']]['file']
    filters = [f"atrim=start={clip['start']}:duration={clip['duration']}", 'asetpts=PTS-STARTPTS',
               'highpass=f=35', 'lowpass=f=7000', 'bass=g=3:f=135:w=0.7']
    output = subprocess.check_output(['ffmpeg', '-v', 'error', '-threads', '1', '-filter_threads', '1',
                                     '-i', str(source), '-vn', '-af', ','.join(filters),
                                     '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'],
                                    creationflags=creation_flags)
    samples = array.array('f')
    samples.frombytes(output)
    if sys.byteorder != 'little':
        samples.byteswap()
    if not samples or not all(math.isfinite(value) for value in samples):
        raise ValueError('Empty or invalid recording: '+clip['name'])
    dc = sum(samples)/len(samples)
    samples = [value-dc for value in samples]
    if clip.get('loop'):
        # Keep the author-created loop duration. A short crossfade removes only
        # the codec seam, using neighbouring samples of the same recording.
        width = 320
        for i in range(width):
            amount = i/(width-1)
            samples[i] = samples[-width+i]*(1-amount)+samples[i]*amount
    else:
        for i in range(round(clip['fadeIn']*16000)):
            samples[i] *= i/max(1, round(clip['fadeIn']*16000)-1)
        for i in range(round(clip['fadeOut']*16000)):
            samples[-1-i] *= i/max(1, round(clip['fadeOut']*16000)-1)
    peak = max(abs(value) for value in samples)
    if peak < 0.0001:
        raise ValueError('Silent source recording: '+clip['name'])
    gain = 0.82/peak
    pcm = array.array('h', [max(-32768, min(32767, round(value*gain*32767))) for value in samples])
    if sys.byteorder != 'little':
        pcm.byteswap()
    target = HERE/(clip['name']+'.wav')
    with wave.open(str(target), 'wb') as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(16000)
        writer.writeframes(pcm.tobytes())
    report.append({'name': target.name, 'bytes': target.stat().st_size,
                   'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
print(json.dumps({'assets': report, 'totalWavBytes': sum(item['bytes'] for item in report)}))

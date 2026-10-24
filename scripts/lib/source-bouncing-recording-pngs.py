"""Validate every retained full-recording PNG without retaining the movie in RAM.

Uses an existing Pillow installation; never installs dependencies. Only the
original frames manifest selects images. Output directory must be new.
"""
import hashlib
import json
from pathlib import Path
import platform
import sys
import time
import PIL
from PIL import Image

reference, output = map(Path, sys.argv[1:])
output.mkdir()
sha = lambda data: hashlib.sha256(data).hexdigest()
frames = json.loads((reference / 'frames.json').read_text())
if not 1 <= len(frames) <= 10000:
    raise RuntimeError('Frame manifest outside capacity')
report = {'status': 'running', 'python': platform.python_version(), 'pillow': PIL.__version__, 'frames': 0}
started = time.monotonic()
try:
    with (output / 'frames.jsonl').open('x') as stream:
        for index, frame in enumerate(frames):
            if frame['frame'] != index or frame['width'] != 1500 or frame['height'] != 1800:
                raise RuntimeError('Unexpected full-frame identity or size')
            directory = reference / ('frame-' + str(index))
            evidence = directory / 'pixels.json'
            hashes = json.loads(evidence.read_text())
            paths = [evidence, directory / 'point-draw.json', directory / 'artwork-boundary.txt', directory / 'artwork.png', directory / 'final.png']
            with Image.open(directory / 'artwork.png') as image:
                if image.mode != 'RGBA' or image.size != (1500, 1800):
                    raise RuntimeError('Unexpected artwork PNG representation')
                if sha(image.convert('RGB').tobytes()) != hashes['artworkRgbSha256']:
                    raise RuntimeError('Artwork PNG differs from original glReadPixels RGB')
            with Image.open(directory / 'final.png') as image:
                if image.mode != 'RGBA' or image.size != (1500, 1800):
                    raise RuntimeError('Unexpected final PNG representation')
                if sha(image.tobytes()) != hashes['finalRgbaSha256'] or sha(image.getchannel('A').tobytes()) != hashes['finalAlphaSha256']:
                    raise RuntimeError('Final PNG differs from original framebuffer')
            if index and hashes['encoderInputSha256'] != hashes['finalRgbaSha256']:
                raise RuntimeError('Original VideoRecorder input differs from PNG')
            stream.write(json.dumps({'frame': index, 'pixels': hashes, 'files': {str(path): sha(path.read_bytes()) for path in paths}}) + '\n')
            stream.flush()
            report['frames'] += 1
    report['status'] = 'passed'
except BaseException as error:
    report['status'] = 'failed'
    report['error'] = str(error)
    raise
finally:
    report['elapsedSeconds'] = time.monotonic() - started
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)

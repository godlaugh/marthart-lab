"""Independent composed-base → enhancement → software bicubic image oracle.
Reuses the retained Python bytecode/OpenJDK transcripts, never product JS.
This is not original JVM execution or original GL/TeX screenshot parity.
"""
import argparse, contextlib, hashlib, io, json, runpy
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--input-json', required=True)
parser.add_argument('--output-rgba', required=True)
parser.add_argument('--output-json', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
with contextlib.redirect_stdout(io.StringIO()):
    enhancement = runpy.run_path(str(root / 'source-paused-image-oracle.py'))
    bicubic = runpy.run_path(str(root / 'source-paused-upscale-oracle.py'))
source = json.loads(Path(args.input_json).read_text())
w, h, scale, pixels = source['width'], source['height'], source['scale'], source['pixels']
if type(w) is not int or type(h) is not int or w < 1 or h < 1 or w*h > 1024*1024:
    raise ValueError('bounded oracle base dimensions invalid')
if scale not in [1,3,5] or len(pixels) != w*h*4 or any(type(v) is not int or not 0 <= v <= 255 for v in pixels):
    raise ValueError('oracle input invalid')
enhanced = enhancement['enhance'](pixels,w,h)
output = enhanced if scale == 1 else bicubic['oracle'](w,h,enhanced,scale)
Path(args.output_rgba).write_bytes(bytes(output))
result = {'basis':'Independent retained MathArt bytecode enhancement and OpenJDK21 default software bicubic transcripts; no original JVM execution',
          'width':w*scale,'height':h*scale,'scale':scale,
          'compositedBaseSha256':hashlib.sha256(bytes(pixels)).hexdigest(),
          'enhancedBaseSha256':hashlib.sha256(bytes(enhanced)).hexdigest(),
          'rgbaSha256':hashlib.sha256(bytes(output)).hexdigest(),
          'sources':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['source-paused-image-oracle.py','source-paused-upscale-oracle.py']}}
Path(args.output_json).write_text(json.dumps(result,indent=2)+'\n')

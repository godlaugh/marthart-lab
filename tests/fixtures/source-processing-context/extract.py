"""Extract original VIEW/RUN observations, never product-derived matrices.

Usage: python3 extract.py OUTPUT.json NAME=CAPTURE_DIRECTORY ...
Explicit source captures are required; this does not launch any application.
"""
import hashlib,json,struct,sys
from pathlib import Path

def words(values):
 return [struct.unpack('<I',struct.pack('<f',float(value)))[0] for value in values]

def snapshot(value):
 out={name:words([value[key][(i%4)*4+i//4] for i in range(16)]) for name,key in [('projection','projection'),('modelview','modelview'),('transform','projmodelview')]}
 out['normalMatrix']=words([value['modelviewInv'][i] for i in [0,1,2,4,5,6,8,9,10]])
 return out

def extract(argument):
 name,directory=argument.split('=',1);root=Path(directory);pins={}
 def read(file):
  data=(root/file).read_bytes();pins[file]=hashlib.sha256(data).hexdigest()
  # Java's JSON writer emits negative float zero as -0. Python's default int
  # parser would erase its sign before we convert the observed value to bits.
  return json.loads(data,parse_int=lambda token:-0.0 if token=='-0' else int(token))
 run=read('run.json');assert run['status']=='observed' and run['exit']==0 and run['processGroupAfter']==[]
 assert run['sourceBefore']==run['sourceAfter']
 auth=read('authorization.json');assert auth['VIEW'] and auth['RUN'] and auth['watermark']
 descriptor=read('descriptor.json');source=read('source.json');frames=[]
 for frame in descriptor['frames']:
  prefix='frame-'+str(frame['index'])+'/'
  draws=read(prefix+'draws.json');runtime=read(prefix+'runtime.json')
  passes=[]
  for draw in draws:
   if draw['ownerMethod']=='runUpdatePass':
    passes.append([{'name':key.removesuffix('[0]'),'type':u['type'],'size':u['size'],'bits':words(u['values'])} for key,u in draw['uniforms'].items()])
  observed={}
  for local,file in [('before','context-before-run.json'),('after','context-after-run.json'),('end','context-after-end.json')]:
   if (root/prefix/file).exists():observed[local]=snapshot(read(prefix+file))
  world=[snapshot(d['worldGraphicsContext']) for d in draws if 'worldGraphicsContext' in d]
  frames.append({'index':frame['index'],'rawDt':frame['rawDt'],'reinitializeScene':frame.get('reinitializeScene',False),'cameraBits':words([runtime['camera'][k] for k in ['phi','theta','gamma','focalDistance','zoom']]),'passes':passes,'contexts':observed,'world':world})
 return {'name':name,'capture':directory,'sourceIdentity':run['sourceBefore'],'pins':pins,'source':source,'viewport':descriptor['sourceViewport'],'watermark':auth['watermark'],'frames':frames}

output=Path(sys.argv[1]);assert not output.exists()
fixture={'scope':'Original MathArt 1.7.8 normal VIEW/RUN: matrices, camera values and linked GL uniforms. Expected uint32 words are extracted only from observed Float32 values. No full-image/export/app-routing claim. Captures have retained endDraw OpenGL 1282 stderr.','extractorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'cases':[extract(arg) for arg in sys.argv[2:]]}
output.write_text(json.dumps(fixture,separators=(',',':'))+'\n')

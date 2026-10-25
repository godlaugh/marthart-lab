"""Extract original normal VIEW/RUN seed and result bits; launches no program.
Usage: python3 extract.py CAPTURE_DIRECTORY NEW_OUTPUT.json
"""
import json,hashlib,struct,sys
from pathlib import Path
root=Path(sys.argv[1]);out=Path(sys.argv[2]);assert not out.exists();pins={}
def raw(name):
 data=(root/name).read_bytes();pins[name]=hashlib.sha256(data).hexdigest();return data
def read(name):return json.loads(raw(name),parse_int=lambda n:-0.0 if n=='-0' else int(n))
def words(name):
 data=raw(name);assert len(data)==64*16;return list(struct.unpack('<256I',data))
run=read('run.json');assert run['status']=='observed' and run['exit']==0 and run['processGroupAfter']==[] and run['sourceBefore']==run['sourceAfter']
auth=read('authorization.json');assert auth['VIEW'] and auth['RUN'] and auth['watermark'];descriptor=read('descriptor.json');assert descriptor['batchSize']==64
source=read('source.json');initial=read('runtime-before.json');seed=words('frame-0/state-initial-level-0.bin');frames=[]
for f in descriptor['frames']:
 prefix='frame-'+str(f['index'])+'/';draws=read(prefix+'draws.json')
 frames.append({'index':f['index'],'rawDt':f['rawDt'],'steps':[d['uniforms']['iterations']['values'][0] for d in draws if d['ownerMethod']=='runUpdatePass'],'expectedBits':words(prefix+'state-current-level-0.bin')})
fixture={'scope':'Actual original MathArt 1.7.8 VIEW/RUN, 64 particles exposing 123 values across particle x/y. No reference reflection/context values supplied to native computation. No full-image/export/world-stage replay claim. Original endDraw1282 retained.','capture':str(root),'sourceIdentity':run['sourceBefore'],'extractorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'compileDegree':int(initial['mobject']['runtimeSymmetryDegree']),'watermark':auth['watermark'],'source':source,'viewport':descriptor['sourceViewport'],'seedBits':seed,'frames':frames,'pins':pins}
out.write_text(json.dumps(fixture,separators=(',',':'))+'\n')

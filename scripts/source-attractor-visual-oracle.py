#!/usr/bin/env python3
"""Independent ManimColors.gradient and Attractor visual defaults reference.
Retained classfile arithmetic only; no original runtime or framebuffer.
"""
import hashlib,json,struct,sys,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
APP=ROOT.parent/'.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar'
SHA='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'
CLASSES={'AbstractVisualConfig':'d14010da3a23da71e35b92a5217fd9466f3547c1ed09d20fddf842afe66dfd1c','JsonAttractorConfig':'ec8b62dd7c0b7d2532035017254dc7edb5e3fd65f2ea566545aa1c013bfb27ed','StrangeAttractor':'5c0d4359c63dc72190cc25cde783908b4294c52158092fb3813901416da6dcfc','ParticleSystemMobject':'b62b1bed37bb557af50d2386136555889a52ec421085680f8602e6694cec1a8d'}
def f(x):return struct.unpack('>f',struct.pack('>f',x))[0]
def lerp(a,b,t):
 t=max(0,min(1,t));output=0
 for shift in [24,16,8,0]:
  left=(a>>shift)&255;right=(b>>shift)&255
  output|=int(f(left+f((right-left)*t)))<<shift
 return output
def sample(palette,count,index,wrong_order=False):
 n=len(palette)
 if n==1:return palette[0]
 position=0 if count==1 else f(f(f(n-1)*f(index))/f(count-1))
 if wrong_order and count>1:position=f(f(f(index)/f(count-1))*f(n-1))
 segment=int(position);fraction=f(position%1)
 if index==count-1:fraction=1;segment=n-2
 segment=max(0,min(n-2,segment))
 return lerp(palette[segment],palette[segment+1],fraction)
def main():
 assert hashlib.sha256(APP.read_bytes()).hexdigest()==SHA
 evidence=[]
 with zipfile.ZipFile(APP) as archive:
  for name in list(CLASSES)+['ManimColors','ConfigUtils']:
   path=ROOT/'.cache/v2-camera-source'/f'{name}.json';raw=path.read_bytes();data=json.loads(raw)
   sha=hashlib.sha256(archive.read(data['entry'])).hexdigest();assert sha==data['classSha256']
   if name in CLASSES:assert sha==CLASSES[name]
   evidence.append({'entry':data['entry'],'classSha256':sha,'evidenceSha256':hashlib.sha256(raw).hexdigest()})
 default=[0xfffc6255,0xffff862f,0xffffcd62,0xff83c167,0xff58c4dd,0xff9a72ac]
 palettes=[('default',default),('one-alpha',[0x12010203]),('transparent-rgb',[0x00ff0000,0x4000ff00,0x800000ff,0xffffffff]),('alternating',[0xff000000,0xffffffff,0xff000000,0xffffffff])]
 cases=[]
 for name,palette in palettes:
  for count in [0,1,2,3,7,31,255,256,511,2147483647]:
   indices=list(range(count)) if count<=31 else sorted(set([0,1,count//3,count//2,count-2,count-1]))
   cases.append({'id':f'{name}-{count}','colors':['#'+format(c,'08X') for c in palette],'count':count,'samples':[{'index':i,'packed':sample(palette,count,i)} for i in indices]})
 # Find an actual packed-byte witness for multiply-before-divide, not merely a
 # differing intermediate scalar. Retain one exact finite case.
 witness=None
 for count in range(2,2049):
  palette=palettes[3][1]
  for index in range(count):
   good=sample(palette,count,index);wrong=sample(palette,count,index,True)
   if good!=wrong:
    witness={'colors':['#'+format(c,'08X') for c in palette],'count':count,'index':index,'packed':good,'normalizedFirst':wrong};break
  if witness:break
 assert witness is not None
 out={'kind':'independent-python-retained-bytecode-transcription','artifactSha256':SHA,'sourceEvidence':evidence,'defaults':{'settingsAbsent':{'dotRadius':2,'lineWeight':1,'lifetime':4,'show':True,'fade':False,'fadePoints':False},'settingsPresent':{'dotRadius':2,'lineWeight':f(.8),'lifetime':3,'show':True,'fade':False,'fadePoints':False}},'cases':cases,'operationOrderWitness':witness,'limits':['No original JVM/JOGL runtime or original pixels.','Initial/applyPalette ManimColors.gradient only; later gradient-animation callbacks have different sampling semantics.']}
 path=ROOT/'tests/fixtures/source-attractor/visual.json';text=json.dumps(out,indent=2)+'\n'
 if '--check' in sys.argv:assert path.read_text()==text,'source Attractor visual fixture drift'
 else:path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
 print(f'{len(cases)} initial palette cases verified; multiply-before-divide witness={witness}')
if __name__=='__main__':main()

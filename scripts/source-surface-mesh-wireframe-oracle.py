#!/usr/bin/env python3
"""Independent retained MeshSurface CPU wireframe arithmetic, no product imports.
Source JAR a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018.
MeshSurface$WireframeEdgeSet.mix/add/emit ordering; drawIsoCurveImmediate.
"""
import argparse,json,struct,pathlib,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/source-surface-mesh/wireframe.json'
def f(v):return struct.unpack('>f',struct.pack('>f',v))[0]
def mix(k):
 mask=(1<<64)-1
 k^=k>>33;k=(k*-49064778989728563)&mask
 k^=k>>33;k=(k*-4265267296055464877)&mask
 k^=k>>33
 return k&0xffffffff
def edges(nu,nv,triangles):
 cap=1
 while cap<max(64,(nu-1)*(nv-1)*6)*2:cap*=2
 table=[None]*cap
 for a,b,c in zip(triangles[::3],triangles[1::3],triangles[2::3]):
  for x,y in [(a,b),(b,c),(c,a)]:
   if x==y:continue
   lo,hi=sorted([x,y]);k=(lo<<32)|hi;slot=mix(k)&(cap-1)
   while table[slot] is not None and table[slot]!=k:slot=(slot+1)&(cap-1)
   table[slot]=k
 return [[k>>32,k&0xffffffff] for k in table if k is not None]
def curve(const_u,fixed,samples,invalid=False,offset=0):
 out=[];prev=None
 for i in range(samples+1):
  t=f(i/samples);u,v=(fixed,t) if const_u else(t,fixed)
  if invalid and v==.5:prev=None;continue
  p=[f(u+offset),v,f(u*v)]
  if prev is not None:out.extend(prev+p)
  prev=p
 return out
def fixtures():
 triangles=[0,1,3,0,3,2]
 return {'identity':{'jarSha256':'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018','kind':'independent-python-bytecode-arithmetic'},'hashEdges':[{'numU':2,'numV':2,'triangles':triangles,'expected':edges(2,2,triangles)},{'numU':2,'numV':3,'triangles':[0,1,3,0,3,2,2,3,5,2,5,4,4,5,1,4,1,0],'expected':edges(2,3,[0,1,3,0,3,2,2,3,5,2,5,4,4,5,1,4,1,0])}], 'decoupled':{'samples':16,'uOnly':curve(True,0,16)+curve(True,1,16),'bothAxes':curve(True,0,16)+curve(True,1,16)+curve(False,0,16)+curve(False,1,16),'invalidMidpoint':curve(True,0,16,True)+curve(True,1,16,True),'offset':curve(True,0,16,offset=f(.01))+curve(True,1,16,offset=f(.01))}}
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');a=parser.parse_args()
 text=json.dumps(fixtures(),indent=2)+'\n'
 if a.check:
  if OUT.read_text()!=text:raise SystemExit('fixture mismatch')
 else:OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(text)
 print(hashlib.sha256(text.encode()).hexdigest())
if __name__=='__main__':main()

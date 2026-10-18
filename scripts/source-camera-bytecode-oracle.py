#!/usr/bin/env python3
"""Independent MathArt 1.7.8/Processing scalar oracle; never imports product code.
Run from studio: python3 scripts/source-camera-bytecode-oracle.py [--check]
Evidence inputs are retained classfile disassemblies in .cache. This computes
host reference values, not an executed Java/JOGL oracle or framebuffer golden.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
PINS = {
 'roots-native-camera-bytecode.json': '80a478f361fdcbca2d8aeda2cc96f55e500a3527fa889ffd69765d815d0be9dd',
 'roots-native-scene-bytecode.json': '1237defdd1a14b13e63669cbf5dfdab517cb2e4587c47264fff4b87fb6f58e53',
 'roots-projection-matrix-rotate.json': '037bf25c8ca287341f71d44c497a5bada41d00bd66fc969cfc0430251abff92a',
 'roots-projection-matrix-methods.json': '037bf25c8ca287341f71d44c497a5bada41d00bd66fc969cfc0430251abff92a',
 'roots-projection-processing-transforms.json': 'a0129d4660d76f8f881dd867bef85f3bfab547f10db63616d482b7f8881c736c',
 'roots-projection-camera-primitives.json': 'a0129d4660d76f8f881dd867bef85f3bfab547f10db63616d482b7f8881c736c',
}
def f(x): return struct.unpack('>f', struct.pack('>f', x))[0]
def add(a,b): return f(a+b)
def sub(a,b): return f(a-b)
def mul(a,b): return f(a*b)
def div(a,b): return f(a/b)
def ident(): return [[float(i==j) for j in range(4)] for i in range(4)]
def multiply(a,b):
 return [[add(add(add(mul(a[r][0],b[0][c]),mul(a[r][1],b[1][c])),mul(a[r][2],b[2][c])),mul(a[r][3],b[3][c])) for c in range(4)] for r in range(4)]
def translate(a,x,y,z):
 for row in a: row[3]=add(row[3],add(add(mul(x,row[0]),mul(y,row[1])),mul(z,row[2])))
def rotate(a,axis,angle):
 c,s=f(math.cos(angle)),f(math.sin(angle));t=sub(1,c)
 # PMatrix3D.rotate(angle,x,y,z), not specialized rotateX/rotateZ.
 v=[1.,0.,0.] if axis=='x' else [0.,0.,1.]
 x,y,z=v;p=lambda a,b:mul(mul(t,a),b)
 r=[[add(p(x,x),c),sub(p(x,y),mul(s,z)),add(p(x,z),mul(s,y)),0],
    [add(p(x,y),mul(s,z)),add(p(y,y),c),sub(p(y,z),mul(s,x)),0],
    [sub(p(x,z),mul(s,y)),add(p(y,z),mul(s,x)),add(p(z,z),c),0],[0,0,0,1]]
 return multiply(a,r)
def length(v):return f(math.sqrt(add(add(mul(v[0],v[0]),mul(v[1],v[1])),mul(v[2],v[2]))))
def norm(v):
 size=length(v)
 return [div(x,size) for x in v] if size>=2**-23 else v

def source(case):
 c={'phi':f(math.pi/2),'theta':0.,'gamma':0.,'center':[0.,0.,0.],'zoom':1.,'focalDistance':20.}
 c.update(case.get('frame',{}));c={k:([f(x) for x in v] if k=='center' else f(v)) for k,v in c.items()}
 v=case['viewport'];w,h=f(v['logicalWidth']),f(v['logicalHeight'])
 scale=1. if v['target']=='primary' else div(h,f(v['referenceLogicalHeight']))
 base=div(div(25,2),c['focalDistance']);fov=max(f(.001),min(f(3.1405928134918213),mul(2,f(math.atan(div(base,c['zoom']))))))
 cz=div(div(h,2),base);aspect=div(w,h);near,far=div(cz,100),mul(cz,50)
 z=norm([0.,0.,cz]);x=norm([sub(mul(1,z[2]),mul(0,z[1])),add(mul(-0.,z[2]),mul(0,z[0])),sub(mul(0,z[1]),mul(1,z[0]))]);y=norm([sub(mul(z[1],x[2]),mul(z[2],x[1])),add(mul(-z[0],x[2]),mul(z[2],x[0])),sub(mul(z[0],x[1]),mul(z[1],x[0]))])
 model=[x+[0.],y+[0.],z+[0.],[0.,0.,0.,1.]]
 translate(model,-div(w,2),-div(h,2),-cz);translate(model,div(w,2),div(h,2),0)
 if abs(sub(scale,1))>f(.001):
  for row in model:
   for col in range(3):row[col]=mul(row[col],scale)
 rotation=ident()
 for axis,angle in [('z',-c['gamma']),('x',c['phi']),('z',c['theta'])]:
  rotation=rotate(rotation,axis,angle);model=rotate(model,axis,angle)
 translate(model,*[-x for x in c['center']])
 ortho_far=None
 if v['projectionPass']=='scene-fade-orthographic':
  dz=div(div(h,2),f(math.tan(div(f(math.pi/3),2))));ortho_far=mul(length([0,0,dz]),10)
  left,right,bottom,top=div(-w,2),div(w,2),div(-h,2),div(h,2);rw,rh=sub(right,left),sub(top,bottom)
  projection=[[div(2,rw),0,0,div(-add(right,left),rw)],[0,-div(2,rh),0,div(-add(top,bottom),rh)],[0,0,div(-2,ortho_far),div(-ortho_far,ortho_far)],[0,0,0,1]]
 else:
  top=mul(near,f(math.tan(div(fov,2))));bottom=-top;left,right=mul(bottom,aspect),mul(top,aspect)
  n2,rw,rh,rd=mul(2,near),sub(right,left),sub(top,bottom),sub(far,near)
  projection=[[div(n2,rw),0,div(add(right,left),rw),0],[0,div(-n2,rh),div(add(top,bottom),rh),0],[0,0,div(-add(far,near),rd),div(-mul(n2,far),rd)],[0,0,-1,0]]
 return {'camera':c,'displayScale':scale,'rotation':sum(rotation,[]),'modelView':sum(model,[]),'projection':sum(projection,[]),'optics':{'halfSensorOverFocal':base,'fov':fov,'cameraZ':cz,'aspect':aspect,'near':near,'far':far,'orthographicFar':ortho_far}}

def main():
 evidence=[]
 for filename,sha in PINS.items():
  path=ROOT/'.cache'/filename;raw=path.read_bytes();d=json.loads(raw)
  if d['classSha256']!=sha:raise ValueError(f'Unexpected artifact identity: {filename}')
  evidence.append({'path':'.cache/'+filename,'entry':d['entry'],'classSha256':sha,'evidenceSha256':hashlib.sha256(raw).hexdigest()})
 viewport={'logicalWidth':96,'logicalHeight':64,'referenceLogicalHeight':64,'target':'primary','projectionPass':'perspective'}
 def case(name,frame=None,**view):return {'id':name,'frame':frame or {},'viewport':dict(viewport,**view)}
 cases=[case('scene-default'),case('zero',{'phi':0}),case('theta-quarter',{'phi':0,'theta':math.pi/2}),case('phi-quarter',{'phi':math.pi/2}),case('gamma-quarter',{'phi':0,'gamma':math.pi/2}),case('mixed',{'phi':.3,'theta':.4,'gamma':.2}),case('mixed-center',{'phi':.3,'theta':.4,'gamma':.2,'center':[1.25,-2.5,3.75]}),case('rodrigues-rounding',{'phi':1.58}),case('offscreen-optics',{'phi':.3,'theta':-.4,'gamma':.2,'center':[1,-2,3],'zoom':2,'focalDistance':35},logicalWidth=64,logicalHeight=96,target='offscreen'),case('fade-ortho',{'phi':.3,'gamma':.2},projectionPass='scene-fade-orthographic'),case('scale-threshold-below',{},logicalHeight=2001,referenceLogicalHeight=2000,target='offscreen'),case('scale-threshold-above',{},logicalHeight=1001,referenceLogicalHeight=999,target='offscreen')]
 for row in cases:row['expected']=source(row)
 out={'schemaVersion':1,'model':'mathart-1.7.8-v1','kind':'independent-python-bytecode-transcription','artifactSha256':'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018','sourceEvidence':evidence,'cases':cases,'limits':['No original app execution or original framebuffer.','Host Python/JS libm final bits are not asserted equal to Java/driver across all values.','Ordinary Scene matrix facts only; no family display policy or 2D viewport invented.']}
 path=ROOT/'tests/fixtures/source-camera/matrices.json';text=json.dumps(out,indent=2)+'\n'
 if '--check' in sys.argv:
  if path.read_text()!=text:raise SystemExit('source camera fixture drift')
 else:path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
 print(f'{len(cases)} source camera fixtures verified' if '--check' in sys.argv else f'{len(cases)} source camera fixtures written')
if __name__=='__main__':main()

"""Independent packed-ARGB transcript of OpenJDK21 default software route.
No production imports, original application/class/JVM execution, or Canvas.
Reference: retained roots-paused-image-openjdk21 source files/manifests.
This oracle uses full byte lookup tables + arbitrary precision fixed coordinates;
production instead uses reduced LUT expressions + two-part coordinate stepping.
"""
import math,json,hashlib,struct
from pathlib import Path
M=[[0]*256 for _ in range(256)]
D=[[0]*256 for _ in range(256)]
for i in range(1,256):
 inc=(i<<16)+(i<<8)+i;val=inc+(1<<23)
 for j in range(1,256):M[i][j]=val>>24;val+=inc
 inc=((255<<24)+i//2)//i;val=1<<23
 for j in range(i):D[i][j]=val>>24;val+=inc
 for j in range(i,256):D[i][j]=255
C=[0]*513;A=-.5
for i in range(256):
 x=i/256.;x=((A+2)*x-(A+3))*x*x+1;C[i]=int(x*256)
for i in range(256,384):
 x=i/256.;x=((A*x-5*A)*x+8*A)*x-4*A;C[i]=int(x*256)
C[384]=(256-C[128]*2)//2
for i in range(385,513):C[i]=256-(C[512-i]+C[i-256]+C[768-i])
def oracle(w,h,rgba,scale):
 dstw=w*scale;dsth=h*scale
 src=[]
 for p in range(w*h):
  r,g,b,a=rgba[p*4:p*4+4];src.append([M[a][r],M[a][g],M[a][b],a])
 sx=1./(dstw/w);sy=1./(dsth/h);dx=int(sx*(1<<32));dy=int(sy*(1<<32))
 xb=int((.5*sx)*(1<<32))-(1<<31);yb=int((.5*sy)*(1<<32))-(1<<31)
 out=[]
 for y in range(dsth):
  yf=yb+y*dy;yi=yf>>32;yp=(yf&0xffffffff)>>24;yc=[C[yp+256],C[yp],C[256-yp],C[512-yp]]
  for x in range(dstw):
   xf=xb+x*dx;xi=xf>>32;xp=(xf&0xffffffff)>>24;xc=[C[xp+256],C[xp],C[256-xp],C[512-xp]]
   sums=[1<<15]*4
   for iy in range(4):
    for ix in range(4):
     sample=src[max(0,min(h-1,yi+iy-1))*w+max(0,min(w-1,xi+ix-1))]
     for c in range(4):sums[c]+=sample[c]*xc[ix]*yc[iy]
   a=max(0,min(255,sums[3]>>16));rgb=[max(0,min(a,sums[c]>>16)) for c in range(3)]
   # SrcOver onto calloc/zero TYPE_INT_ARGB: unchanged zero when alpha0.
   out.extend([D[a][v] if a<255 else v for v in rgb]+[a])
 return out
def fixtures():
 cases=[]
 def add(name,w,h,pixels):
  for scale in [3,5]:
   out=oracle(w,h,pixels,scale)
   cases.append(dict(name=name,scale=scale,width=w,height=h,pixels=pixels,expected=out,sha256=hashlib.sha256(bytes(out)).hexdigest()))
 add('opaque-single',1,1,[13,125,244,255]);add('partial-single',1,1,[1,127,253,128]);add('alpha-one',1,1,[127,128,255,1]);add('transparent-single',1,1,[255,120,87,0])
 add('opaque-edge',4,1,[0,20,240,255,128,35,128,255,255,240,0,255,0,20,240,255])
 add('alpha-edge',3,1,[255,0,0,0,0,255,0,128,0,0,255,255])
 add('mixed-nonsquare',3,2,[244,20,120,0,1,127,253,1,255,10,7,17,15,202,151,128,97,21,254,254,12,67,210,255])
 add('vertical-edge',1,4,[10,255,90,255,253,7,40,17,0,200,255,0,240,190,100,128])
 add('overshoot',4,3,[v for y in range(3) for x in range(4) for v in ([0,0,0,255] if x<2 else [255,255,255,255])])
 add('fixed-center',5,3,[v for y in range(3) for x in range(5) for v in [(x*53+y*11)%256,(x*31+y*73)%256,(x*97+y*2)%256,255]])
 result={'reference':'OpenJDK jdk-21.0.7+6 default software bicubic; not original runtime output','coefficientSha256':hashlib.sha256(struct.pack('<513h',*C)).hexdigest(),'mul8Sha256':hashlib.sha256(bytes(v for row in M for v in row)).hexdigest(),'div8Sha256':hashlib.sha256(bytes(v for row in D for v in row)).hexdigest(),'cases':cases}
 path=Path('tests/fixtures/source-paused-upscale-openjdk21.json');path.parent.mkdir(exist_ok=True,parents=True);path.write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'cases':len(cases),'outputPixels':sum(len(x['expected'])//4 for x in cases),'fixtureSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'partial':cases[2]['expected'][:4],'alpha-one':cases[4]['expected'][:4]}))

if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--input-json');parser.add_argument('--output-json');args=parser.parse_args()
 if args.input_json:
  inp=json.loads(Path(args.input_json).read_text())
  if inp['scale'] not in [3,5] or len(inp['pixels'])!=inp['width']*inp['height']*4:raise ValueError('invalid oracle input')
  pixels=oracle(inp['width'],inp['height'],inp['pixels'],inp['scale'])
  out={'reference':'OpenJDK21 default software transcript, not original runtime', 'width':inp['width']*inp['scale'],'height':inp['height']*inp['scale'],'pixels':pixels,'sha256':hashlib.sha256(bytes(pixels)).hexdigest()}
  if args.output_json:Path(args.output_json).write_text(json.dumps(out,separators=(',',':'))+'\n')
  else:print(json.dumps(out,separators=(',',':')))
 else:fixtures()

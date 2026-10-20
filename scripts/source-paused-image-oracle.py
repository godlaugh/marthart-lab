# Independent integer-ARGB transcript of retained MathArt 1.7.8 bytecode.
# No production imports, Java/JVM or original application execution.
import math,struct,json,hashlib
F=lambda x:struct.unpack('f',struct.pack('f',x))[0]
rnd=lambda x:math.floor(x+.5)
clamp=lambda x,a,b:max(a,min(b,x))
def luma(c):return (54*((c>>16)&255)+183*((c>>8)&255)+19*(c&255))>>8
def enhance(rgba,w,h):
 src=[(rgba[i+3]<<24)|(rgba[i]<<16)|(rgba[i+1]<<8)|rgba[i+2] for i in range(0,len(rgba),4)]
 lum=list(map(luma,src));aa=src.copy()
 for y in range(1,h-1):
  for x in range(1,w-1):
   i=y*w+x;adj=[i-1,i+1,i-w,i+w];edge=abs(lum[adj[0]]-lum[adj[1]])+abs(lum[adj[2]]-lum[adj[3]])
   if edge<=20:continue
   weight=F(clamp(F((edge-20)/100),0,1)*F(.3));out=src[i]&0xff000000
   for shift in [16,8,0]:
    c=(src[i]>>shift)&255;avg=sum((src[j]>>shift)&255 for j in adj)>>2
    out|=clamp(rnd(F(F(c*F(1-weight))+F(avg*weight))),0,255)<<shift
   aa[i]=out
 lum=list(map(luma,aa));blur=[]
 for y in range(h):
  for x in range(w):
   v=0
   for dy,wy in [(-1,1),(0,2),(1,1)]:
    for dx,wx in [(-1,1),(0,2),(1,1)]:v+=lum[clamp(y+dy,0,h-1)*w+clamp(x+dx,0,w-1)]*wx*wy
   blur.append(v>>4)
 out=[]
 for i,c in enumerate(aa):
  if (c>>24)&255:
   delta=lum[i]-blur[i]
   if abs(delta)<2:delta=0
   amount=rnd(F(delta*F(.42)))
   c=(c&0xff000000)|sum(clamp(((c>>s)&255)+amount,0,255)<<s for s in [16,8,0])
  out.extend([(c>>16)&255,(c>>8)&255,c&255,(c>>24)&255])
 return out
cases=[]
for edge in [20,21,24]:
 vals=[145,145,145,145-edge//2,20,145+(edge-edge//2),145,145,145]
 rgba=[n for v in vals for n in [v,v,v,0]]
 cases.append({'name':'edge'+str(edge),'width':3,'height':3,'input':rgba,'output':enhance(rgba,3,3)})
rgba=[(i*73+11)%256 for i in range(7*5*4)]
cases.append({'name':'mixed7x5','width':7,'height':5,'input':rgba,'output':enhance(rgba,7,5)})
print(json.dumps({'basis':'retained MathArt applyEdgeAwareAa/buildGaussianBlurLuma/buildEnhancedImage static transcript; no native execution','cases':cases},indent=2))

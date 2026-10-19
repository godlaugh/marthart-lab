#!/usr/bin/env python3
"""Execute retained Processing ellipse and closed-3D stroke instruction arrays.
Only bounded allocation/style recording and Java library/LUT primitives are
adapted. It is not an original JVM execution or a native libm parity claim.
"""
import importlib.util,json,pathlib,hashlib,zipfile,math,struct,sys
SPEC=importlib.util.spec_from_file_location('seed_vm',pathlib.Path(__file__).with_name('source-bouncing-bytecode-seeds.py'));base=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(base)
F,Obj=base.F,base.Obj
ROOT=base.ROOT;CORE=base.JAR.parent/'core-4.5.0-acdf3bce2932985b9d091c284407a54.jar';CORE_SHA='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a';assert hashlib.sha256(CORE.read_bytes()).hexdigest()==CORE_SHA
CORE_ZIP=zipfile.ZipFile(CORE)
def obj(name,**fields):v=Obj(name);v.update(fields);return v
def matrix(values):return obj('processing/core/PMatrix3D',**{f'm{r}{c}':F(values[r*4+c]) for r in range(4) for c in range(4)})
def words(values):return [struct.unpack('I',struct.pack('f',x))[0] for x in values]
class BoundaryVM(base.VM):
 def __init__(self):
  super().__init__();self.evidence={}
  for name in ['PGraphics','PGraphicsOpenGL','PGraphicsOpenGL$Tessellator','PGraphicsOpenGL$TessGeometry']:
   self.load(ROOT/'.cache/v2-camera-source'/f'{name}.json')
  for name in ['PGraphicsOpenGL$InGeometry','PGraphicsOpenGL$IndexCache']:
   self.load(ROOT/'.cache/v2-bouncing-source'/f'{name}.json')
  self.cos=[F(math.cos(F(F(i*F(math.pi/180))*.5))) for i in range(720)]
  self.sin=[F(math.sin(F(F(i*F(math.pi/180))*.5))) for i in range(720)]
 def load(self,p):
  x=json.loads(p.read_text());actual=hashlib.sha256(CORE_ZIP.read(x['entry'])).hexdigest();assert actual==x['classSha256'];self.classes[x['entry'][:-6]]=x;self.evidence[str(p.relative_to(ROOT))]={'entry':x['entry'],'classSha256':actual,'instructionSha256':hashlib.sha256(p.read_bytes()).hexdigest()}
 def static(self,ref):
  name,field,desc=ref.split(' ')
  if name=='processing/opengl/PGL':return {'FLOAT_EPS':2**-23,'MIN_CAPS_JOINS_WEIGHT':2.,'MAX_CAPS_JOINS_LENGTH':1000,'MAX_VERTEX_INDEX1':32768}[field]
  return super().static(ref)
 def call(self,name,method,desc,receiver,args):
  if name=='java/lang/Integer' and method=='parseInt':
   value=int(args[0],args[1]);assert -2147483648<=value<=2147483647;return value
  if name=='java/lang/String' and method=='replace':return receiver.replace(args[0],args[1])
  if name=='processing/core/PApplet':
   if method in ['min','max']:return (min if method=='min' else max)(args)
   if method=='dist':x1,y1,x2,y2=args;dx=F(x2-x1);dy=F(y2-y1);return F(math.sqrt(F(F(dx*dx)+F(dy*dy))))
  if name=='processing/opengl/PGraphicsOpenGL' and method.startswith('access$'):
   return self.cos if method in ['access$500','access$700'] else self.sin
  if name=='processing/core/PGraphics':
   if method in ['pushStyle','popStyle','hint','noFill']:return None
   if method=='stroke':self.color=[F(x) for x in args];return None
   if method=='strokeWeight':self.width=args[0];return None
   if method=='ellipseImpl':return self.call('processing/opengl/PGraphicsOpenGL$InGeometry','addEllipse','(FFFFZZ)V',self.ing,[*args,0,1])
   if method=='beginShape':return None
   if method=='vertex':self.points.extend(args);return None
   if method=='endShape':
    path=obj('processing/opengl/PGraphicsOpenGL$Tessellator',beginPath=0,pathVertexCount=0,pathVertices=[0.]*2048,pathColors=[0]*512,pathWeights=[0.]*512);path['in']=self.ing
    for i in range(0,len(self.points),3):self.call(path.name,'addStrokeVertex','(FFFIF)V',path,[*self.points[i:i+3],0,self.width])
    self.call(path.name,'endStrokePath','(Z)V',path,[1]);return None
  if name=='processing/opengl/PGraphicsOpenGL$InGeometry':
   if method=='edgeCheck':assert receiver.get('edgeCount',0)<512;return None
   if method=='addVertex' and desc=='(FFIZ)I':index=len(self.points)//3;self.points.extend([args[0],args[1],0]);return index
  if name=='processing/opengl/PGraphicsOpenGL$TessGeometry' and method in ['lineVertexCheck','lineIndexCheck']:assert args[0]<=4096;return None
  if name=='processing/opengl/PGraphicsOpenGL$IndexCache' and method=='arrayCheck':assert receiver['size']<8;return None
  return super().call(name,method,desc,receiver,args)
 def execute(self,case):
  b,v,plan=case['boundary'],case['visual'],case['plan'];transform=v['transform'];self.points=[];self.color=None;self.width=0
  pg=obj('processing/opengl/PGraphicsOpenGL',ellipseMode=3,modelview=matrix(plan['modelView']['rowMajor']),projection=matrix(plan['projection']['rowMajor']),width=plan['viewport']['logicalWidth'],height=plan['viewport']['logicalHeight'],flushMode=1)
  self.ing=obj('processing/opengl/PGraphicsOpenGL$InGeometry',pg=pg,edgeCount=0,edges=[[0,0,0] for _ in range(512)],renderMode=0)
  config={**transform,'polygonVertices':sum(b.get('vertices',[]),[]),'containerShape':b['kind'].upper(),'boundaryCenterX':b.get('center',[0,0])[0],'boundaryCenterY':b.get('center',[0,0])[1],'circleRadius':b.get('radius',0),'ellipseSemiMajorAxis':b.get('a',0),'ellipseSemiMinorAxis':b.get('b',0),'lineWeight':v['lineWeight'],'boundaryColor':v['boundaryColor']}
  boundary=obj('mathart/bouncing/BouncingBoundaryMobject');self.call(boundary.name,'<init>','(Lmathart/bouncing/config/BouncingParticlesConfig;)V',boundary,[config]);self.call(boundary.name,'display','(Lprocessing/core/PGraphics;Lmathart/scene/CameraController;FFFF)V',boundary,[pg,None,0,pg['width'],pg['height'],plan['displayScale']])
  edges=self.ing['edges'][:self.ing['edgeCount']];effective=(max(max(edge[:2]) for edge in edges)+1) if edges else 0;path=self.points[:effective*3]
  cache=obj('processing/opengl/PGraphicsOpenGL$IndexCache',size=0,counter=None,indexCount=[0]*8,indexOffset=[0]*8,vertexCount=[0]*8,vertexOffset=[0]*8)
  tess=obj('processing/opengl/PGraphicsOpenGL$TessGeometry',pg=pg,renderMode=0,lineVertexCount=0,lineIndexCount=0,lineIndexCache=cache,lineVertices=[0.]*16384,lineDirections=[0.]*16384,lineColors=[0]*4096,lineIndices=[0]*4096)
  owner=obj('processing/opengl/PGraphicsOpenGL$Tessellator',tess=tess,strokeColor=0,strokeColors=[0]*(len(self.points)//3),strokeWeight=self.width,strokeWeights=[self.width]*(len(self.points)//3),strokeVertices=self.points,transformScale=-1.,transform=pg['modelview'],is3D=1,firstLineIndexCache=-1,lastLineIndexCache=-1);owner['in']=self.ing
  if edges:self.call(owner.name,'tessellateEdges3D','()V',owner,[])
  return {'pathWords':words(path),'detail':effective if b['kind']!='polygon' else None,'lineWidth':self.width,'colorChannels':self.color,'edges':edges,'positionWords':words(tess['lineVertices'][:tess['lineVertexCount']*4]),'directionWords':words(tess['lineDirections'][:tess['lineVertexCount']*4]),'indices':tess['lineIndices'][:tess['lineIndexCount']],'vertexCount':tess['lineVertexCount'],'indexCount':tess['lineIndexCount'],'joins':not bool(self.call(owner.name,'noCapsJoins','()Z',owner,[])),'instructions':self.work,'calls':dict(self.calls)}
if __name__=='__main__':
 cases=json.load(open(sys.argv[1]));output=[];evidence={}
 for case in cases:
  vm=BoundaryVM();evidence.update(vm.evidence)
  try:output.append({'name':case['name'],'result':vm.execute(case)})
  except Exception as error:
   import traceback
   output.append({'name':case['name'],'error':str(error),'trace':traceback.format_exc()})
 json.dump({'jarSha256':base.JAR_SHA,'processingJarSha256':CORE_SHA,'mathartEvidence':{k:v for k,v in base.EVIDENCE.items() if k.endswith('/BouncingBoundaryMobject.json')},'evidence':evidence,'cases':output,'limitations':['Independent original-instruction interpreter, not JVM execution.','Array capacities preallocated and bounded; native allocation/capacity failure and >32768 index split not verified.','PApplet.dist and trig LUT are explicit source-derived Float32/libm adapters. Native transcendental last bits unverified.','Style/vertex recording adapted; draw-edge generation uses original addEdge/closeEdge and original tessellator methods.']},sys.stdout)

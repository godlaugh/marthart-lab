#!/usr/bin/env python3
"""Small, bounded interpreter of retained original sampler/mobject bytecode.

This executes instruction arrays, not translated shape formulas. Java library
primitives are explicit adapters. Math uses host libm: no native JVM claim.
Input is canonical configuration, so native JSON parsing is outside this oracle.
Formula wrapper bytecode executes unchanged. Its FastExpression adapter accepts
only Python AST numeric literals, x/y, unary +/- and binary +/-/*// for explicit
fixtures. This does not verify the original expression parser or its full grammar.
"""
import ast,collections,hashlib,json,math,pathlib,re,struct,sys,zipfile

ROOT=pathlib.Path(__file__).resolve().parents[1]
JAR=ROOT.parent/'.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar'
JAR_SHA='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'
assert hashlib.sha256(JAR.read_bytes()).hexdigest()==JAR_SHA
ARCHIVE=zipfile.ZipFile(JAR)
EVIDENCE={}
def F(x):
 try:return struct.unpack('f',struct.pack('f',x))[0]
 except OverflowError:return math.copysign(math.inf,x)
def div(a,b):return a/b if b else (math.nan if not a else math.copysign(math.inf,a*math.copysign(1,b)))
def jint(x):return (int(x)+2**31)%2**32-2**31
class Obj(dict):
 def __init__(self,name):super().__init__();self.name=name
class Random:
 def __init__(self,seed):self.state=(int(seed)^0x5deece66d)&((1<<48)-1)
 def bits(self,n):self.state=(self.state*0x5deece66d+11)&((1<<48)-1);return self.state>>(48-n)
 def nextFloat(self):return self.bits(24)/2**24
 def nextDouble(self):return ((self.bits(26)<<27)+self.bits(27))/2**53
class Expression:
 def __init__(self,text):
  self.node=ast.parse(text.strip(),mode='eval').body
  for node in ast.walk(self.node):
   if not isinstance(node,(ast.Constant,ast.Name,ast.Load,ast.BinOp,ast.UnaryOp,ast.Add,ast.Sub,ast.Mult,ast.Div,ast.UAdd,ast.USub)) or isinstance(node,ast.Name) and node.id not in ('x','y'):raise ValueError('Formula outside independent arithmetic adapter')
 def evaluate(self,values):
  def run(n):
   if isinstance(n,ast.Constant):return float(n.value)
   if isinstance(n,ast.Name):return values[0 if n.id=='x' else 1]
   if isinstance(n,ast.UnaryOp):return -run(n.operand) if isinstance(n.op,ast.USub) else run(n.operand)
   a,b=run(n.left),run(n.right)
   return a+b if isinstance(n.op,ast.Add) else a-b if isinstance(n.op,ast.Sub) else a*b if isinstance(n.op,ast.Mult) else div(a,b)
  return run(self.node)
class VM:
 def __init__(self):
  self.classes={};self.work=0;self.calls=collections.Counter()
  for p in (ROOT/'.cache/v2-bouncing-source').glob('*.json'):
   x=json.loads(p.read_text())
   if 'methods' in x:
    actual=hashlib.sha256(ARCHIVE.read(x['entry'])).hexdigest()
    assert actual==x['classSha256'],f'Pinned class hash mismatch: {p}'
    EVIDENCE[str(p.relative_to(ROOT))]={'classEntry':x['entry'],'classSha256':actual,'instructionEvidenceSha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    self.classes[x['entry'][:-6]]=x
 def signature(self,s):
  args=[];i=1
  while s[i]!=')':
   start=i
   while s[i]=='[':i+=1
   if s[i]=='L':i=s.index(';',i)+1
   else:i+=1
   args.append(s[start:i])
  return args,s[i+1:]
 def call(self,name,method,desc,obj,args):
  self.calls[name+'.'+method]+=1
  if name=='java/lang/Object':return None
  if name=='java/util/Random':return getattr(obj,method)()
  if name=='java/lang/Math':
   if method=='max':value=max(args)
   elif method=='min':value=min(args)
   elif method=='signum':value=math.copysign(1,args[0]) if args[0] else args[0]
   else:
    fn={'abs':abs,'pow':math.pow,'atan2':math.atan2,'cos':math.cos,'sin':math.sin,'sqrt':math.sqrt,'ceil':math.ceil}[method]
    try:value=fn(*args)
    except (ValueError,OverflowError):value=math.nan
   return F(value) if desc.endswith('F') else value
  if name=='java/lang/String':
   if method=='equals':return int(obj==args[0])
   if method=='equalsIgnoreCase':return int(obj.upper()==args[0].upper())
   if method=='hashCode':
    h=0
    for c in obj:h=jint(h*31+ord(c))
    return h
   if method=='toUpperCase':return obj.upper()
   if method=='trim':return obj.strip(''.join(map(chr,range(33))))
   if method=='isEmpty':return int(not obj)
   if method=='indexOf':return obj.find(args[0])
   if method=='length':return len(obj)
   if method=='substring':return obj[args[0]:args[1] if len(args)>1 else None]
  if name=='mathart/core/FastExpressionParser' and method=='parse':return Expression(args[0])
  if name=='mathart/core/FastExpression' and method=='eval':return obj.evaluate(args[0])
  if name=='mathart/bouncing/config/BouncingParticlesConfig':return obj[method[3].lower()+method[4:]]
  if name.startswith('org/apache/logging/'):return None
  if name=='mathart/bouncing/shapes/ShapeSampler' and method=='sample':name=obj.name
  candidates=[m for m in self.classes.get(name,{}).get('methods',[]) if m['name']==method and m['descriptor']==desc]
  if not candidates:raise ValueError(f'Unimplemented library or method: {name}.{method}{desc}')
  m=candidates[0];ins={i['offset']:i for i in m['instructions']};offsets=list(ins);following=dict(zip(offsets,offsets[1:]));stack=[];locals={};slot=0
  if obj is not None:locals[slot]=obj;slot+=1
  types,_=self.signature(desc)
  for kind,value in zip(types,args):locals[slot]=value;slot+=2 if kind in ['D','J'] else 1
  pc=0
  while True:
   self.work+=1
   if self.work>40_000_000:raise ValueError('Independent bytecode work cap')
   i=ins[pc];op=int(i['opcode'],16);raw=bytes.fromhex(i['args']);ref=i['reference'];nextpc=following.get(pc);s=stack
   n=lambda signed=False:int.from_bytes(raw,'big',signed=signed)
   if op==0x00:pass
   elif op==0x01:s.append(None)
   elif 0x02<=op<=0x08:s.append(op-3)
   elif 0x09<=op<=0x0f:s.append([0,1,0.,1.,2.,0.,1.][op-9])
   elif op in [0x10,0x11]:s.append(n(True))
   elif op in [0x12,0x13,0x14]:s.append(ref)
   elif 0x15<=op<=0x19:s.append(locals[n()])
   elif 0x1a<=op<=0x2d:s.append(locals[(op-0x1a)%4])
   elif 0x2e<=op<=0x35:index=s.pop();a=s.pop();s.append(a[index])
   elif 0x36<=op<=0x3a:locals[n()]=s.pop()
   elif 0x3b<=op<=0x4e:locals[(op-0x3b)%4]=s.pop()
   elif 0x4f<=op<=0x56:value=s.pop();index=s.pop();a=s.pop();a[index]=value
   elif op==0x57:s.pop()
   elif op==0x59:s.append(s[-1])
   elif op==0x5c:s.extend(s[-2:])
   elif 0x60<=op<=0x73:
    b=s.pop();a=s.pop();group=(op-0x60)//4;kind=(op-0x60)%4
    value=[lambda:a+b,lambda:a-b,lambda:a*b,lambda:div(a,b),lambda:math.fmod(a,b)][group]()
    s.append(F(value) if kind==2 else jint(value) if kind==0 else value)
   elif 0x74<=op<=0x77:s.append(-s.pop())
   elif op==0x84:locals[raw[0]]=jint(locals[raw[0]]+int.from_bytes(raw[1:],'big',signed=True))
   elif op in [0x85,0x86,0x87,0x8b,0x8c,0x8d,0x8e,0x8f,0x90]:
    value=s.pop();s.append(F(value) if op in [0x86,0x90] else int(value) if op in [0x85,0x8b,0x8c,0x8e,0x8f] else float(value))
   elif 0x94<=op<=0x98:
    b=s.pop();a=s.pop();s.append((-1 if op in [0x95,0x97] else 1) if math.isnan(a) or math.isnan(b) else (a>b)-(a<b))
   elif 0x99<=op<=0xa6:
    b=s.pop();a=s.pop() if op>=0x9f else b
    if op<0x9f:b=0;relation=op-0x99
    else:relation=op-0x9f
    yes=[lambda:a==b,lambda:a!=b,lambda:a<b,lambda:a>=b,lambda:a>b,lambda:a<=b,lambda:a==b,lambda:a!=b][relation]()
    if yes:nextpc=pc+n(True)
   elif op==0xa7:nextpc=pc+n(True)
   elif op in [0xaa,0xab]:
    key=s.pop();default=int.from_bytes(raw[:4],'big',signed=True);target=default
    if op==0xaa:
     low=int.from_bytes(raw[4:8],'big',signed=True);high=int.from_bytes(raw[8:12],'big',signed=True)
     if low<=key<=high:target=int.from_bytes(raw[12+4*(key-low):16+4*(key-low)],'big',signed=True)
    else:
     count=int.from_bytes(raw[4:8],'big')
     for j in range(count):
      if key==int.from_bytes(raw[8+j*8:12+j*8],'big',signed=True):target=int.from_bytes(raw[12+j*8:16+j*8],'big',signed=True)
    nextpc=pc+target
   elif 0xac<=op<=0xb0:return s.pop()
   elif op==0xb1:return None
   elif op==0xb2:s.append(ref.split(' ')[1])
   elif op==0xb4:obj1=s.pop();key=ref.split(' ')[1];s.append(obj1.get(key,0))
   elif op==0xb5:value=s.pop();obj1=s.pop();obj1[ref.split(' ')[1]]=value
   elif op in [0xb6,0xb7,0xb8,0xb9]:
    owner,called,sig=ref.split(' ');types,ret=self.signature(sig);values=[s.pop() for _ in types][::-1];receiver=None if op==0xb8 else s.pop();value=self.call(owner,called,sig,receiver,values)
    if ret!='V':s.append(value)
   elif op==0xbb:s.append(Obj(ref))
   elif op in [0xbc,0xbd]:s.append([0]*s.pop())
   elif op==0xbe:s.append(len(s.pop()))
   elif op==0xc0:pass
   elif op in [0xc6,0xc7]:
    value=s.pop()
    if (value is None)==(op==0xc6):nextpc=pc+n(True)
   else:raise ValueError(f'Unsupported opcode {hex(op)} at {name}.{method}+{pc}')
   if nextpc is None:raise ValueError('Fell off method')
   pc=nextpc
 def seeds(self,c,count):
  sampler=self.call('mathart/bouncing/shapes/ShapeSamplerFactory','createSampler','(Lmathart/bouncing/config/BouncingParticlesConfig;)Lmathart/bouncing/shapes/ShapeSampler;',None,[c])
  p=Obj('mathart/bouncing/BouncingParticlesMobject');p['config']=c;p['shapeSampler']=sampler;p['containerShapeUniform']={'CIRCLE':1,'ELLIPSE':2}.get(c['containerShape'],0);p['polygonVertexCount']=len(c['polygonVertices'])//2;p['polygonVertices']=[F(v+c['boundaryCenter'+('X' if i%2==0 else 'Y')]) for i,v in enumerate(c['polygonVertices'])]
  rng=Random(c['seed']);state=[]
  for _ in range(count):
   xy=self.call(p.name,'sampleInitialPosition','(Ljava/util/Random;)[F',p,[rng]);v=self.call(p.name,'sampleInitialVelocity','(Ljava/util/Random;FFFFF)[F',p,[rng,*xy,c['initialAngle'],c['initialAngleSpread'],c['initialSpeed']]);state.extend([*xy,*v])
  return{'words':[struct.unpack('I',struct.pack('f',x))[0] for x in state],'randomState48':str(rng.state),'instructions':self.work,'calls':dict(self.calls)}
if __name__=='__main__':
 payload=json.load(open(sys.argv[1]));out=[]
 for case in payload:
  try:out.append({'name':case['name'],'result':VM().seeds(case['configuration'],case['count'])})
  except Exception as error:out.append({'name':case['name'],'error':str(error)})
 json.dump({'cases':out,'pinnedJarSha256':JAR_SHA,'evidence':EVIDENCE},sys.stdout)

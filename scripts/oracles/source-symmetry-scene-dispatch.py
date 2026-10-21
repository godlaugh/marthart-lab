"""Execute original GenericSymmetryChaosScene.update with a counting Mobject.
The subclass records update calls instead of executing GL. Original scene,
manager, config parsing and queue dispatch execute unmodified. No window opens.
Usage: python3 SCRIPT APP NEW_OUTPUT
"""
import ctypes as C
import hashlib
import json
from pathlib import Path
import struct
import sys

root = Path(__file__).resolve().parents[2]
app, output = [Path(p).resolve() for p in sys.argv[1:]]
fixture = json.loads((root/'tests/fixtures/symmetry/replay-runtime.json').read_text())
jvm = app/'Contents/runtime/Contents/Home/lib/server/libjvm.dylib'
jars = sorted((app/'Contents/app').glob('*.jar'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
sources = [{'name':p.name,'sha256':sha(p)} for p in jars]
if sources != fixture['sources'] or sha(jvm) != fixture['jvmSha256']:
    raise ValueError('Pinned original classpath/JVM identity differs')
output.mkdir()

# A tiny classfile, version 49: no Java compiler or application patching needed.
u2=lambda n:struct.pack('>H',n)
u4=lambda n:struct.pack('>I',n)
cp=[]
def item(value):
    cp.append(value);return len(cp)
def utf(s):
    b=s.encode();return item(b'\x01'+u2(len(b))+b)
def cls(s):return item(b'\x07'+u2(utf(s)))
def ref(tag,owner,name,desc):return item(bytes([tag])+u2(owner)+u2(item(b'\x0c'+u2(utf(name))+u2(utf(desc)))))
name='ReaSymmetryUpdateProbe'
self_class=cls(name);parent=cls('mathart/symmetrychaos/SymmetryChaosMobject')
code_name=utf('Code');fields=[];refs={}
for field,kind in [('count','I'),('firstTime','F'),('firstDt','F'),('lastTime','F'),('lastDt','F')]:
    fields.append(u2(1)+u2(utf(field))+u2(utf(kind))+u2(0));refs[field]=ref(9,self_class,field,kind)
def op(code,index):return bytes([code])+u2(index)
def method(name,desc,code,stack,locals):
    body=u2(stack)+u2(locals)+u4(len(code))+code+u2(0)+u2(0)
    return u2(1)+u2(utf(name))+u2(utf(desc))+u2(1)+u2(code_name)+u4(len(body))+body
init_desc='(Lprocessing/core/PApplet;Lmathart/symmetrychaos/config/SymmetryChaosConfig;)V'
init=method('<init>',init_desc,b'\x2a\x2b\x2c'+op(0xb7,ref(10,parent,'<init>',init_desc))+b'\xb1',3,3)
code=b'\x2a'+op(0xb4,refs['count'])+b'\x9a\x00\x0d'
for field,load in [('firstTime',0x23),('firstDt',0x24)]:code+=b'\x2a'+bytes([load])+op(0xb5,refs[field])
code+=b'\x2a\x59'+op(0xb4,refs['count'])+b'\x04\x60'+op(0xb5,refs['count'])
for field,load in [('lastTime',0x23),('lastDt',0x24)]:code+=b'\x2a'+bytes([load])+op(0xb5,refs[field])
update=method('update','(FF)V',code+b'\xb1',3,3)
bytecode=b'\xca\xfe\xba\xbe'+u2(0)+u2(49)+u2(len(cp)+1)+b''.join(cp)+u2(0x21)+u2(self_class)+u2(parent)+u2(0)+u2(len(fields))+b''.join(fields)+u2(2)+init+update+u2(0)
(output/(name+'.class')).write_bytes(bytecode)

class Option(C.Structure):_fields_=[('optionString',C.c_char_p),('extraInfo',C.c_void_p)]
class Args(C.Structure):_fields_=[('version',C.c_int),('nOptions',C.c_int),('options',C.POINTER(Option)),('ignoreUnrecognized',C.c_ubyte)]
class Value(C.Union):_fields_=[('z',C.c_ubyte),('i',C.c_int),('f',C.c_float),('d',C.c_double),('l',C.c_void_p)]
strings=[('-Djava.class.path='+':'.join(map(str,jars))).encode(),b'-Djava.awt.headless=true',b'-Xmx256m']
options=(Option*len(strings))(*[Option(s,None) for s in strings]);args=Args(0x10008,len(strings),options,0);vm=C.c_void_p();env=C.c_void_p()
lib=C.CDLL(str(jvm));create=lib.JNI_CreateJavaVM;create.argtypes=[C.POINTER(C.c_void_p),C.POINTER(C.c_void_p),C.POINTER(Args)];create.restype=C.c_int
if create(C.byref(vm),C.byref(env),C.byref(args)):raise RuntimeError('JNI_CreateJavaVM failed')
p=C.c_void_p;s=C.c_char_p;table=C.cast(env,C.POINTER(C.POINTER(p))).contents
def fn(i,ret,*types):return C.CFUNCTYPE(ret,p,*types)(table[i])
def check():
    if fn(15,p)(env):fn(16,None)(env);fn(17,None)(env);raise RuntimeError('Java exception')
def cl(name):
    result=fn(6,p,s)(env,name.encode());check();return result
def mid(c,name,desc,static=False):
    result=fn(113 if static else 33,p,p,s,s)(env,c,name.encode(),desc.encode());check();return result
def vals(items):
    result=(Value*len(items))()
    for i,(kind,value) in enumerate(items):setattr(result[i],kind,value)
    return result
def call(index,ret,obj,m,items=()):
    result=fn(index,ret,p,p,C.POINTER(Value))(env,obj,m,vals(items));check();return result
def new(c,desc,items=()):return call(30,p,c,mid(c,'<init>',desc),items)
def field(c,name,kind):
    result=fn(94,p,p,s,s)(env,c,name.encode(),kind.encode());check();return result
def get(obj,c,name,kind):
    result=fn(100 if kind=='I' else 102 if kind=='F' else 95,C.c_int if kind=='I' else C.c_float if kind=='F' else p,p,p)(env,obj,field(c,name,kind));check();return result
try:
    loader_class=cl('java/lang/ClassLoader');loader=call(116,p,loader_class,mid(loader_class,'getSystemClassLoader','()Ljava/lang/ClassLoader;',True))
    probe=fn(5,p,s,p,s,C.c_int)(env,name.encode(),loader,bytecode,len(bytecode));check()
    jc=cl('processing/data/JSONObject');sc=cl('mathart/scene/Scene');gc=cl('mathart/symmetrychaos/GenericSymmetryChaosScene');mc=cl('mathart/symmetrychaos/SymmetryChaosMobject');cc=cl('mathart/symmetrychaos/config/JsonSymmetryChaosConfig')
    rows=[]
    for mode,timeline in [('empty',[]),('zero',[{'type':'wait','duration':0}]),('short',[{'type':'wait','duration':.15}])]:
      for flags in [(False,False),(True,False),(False,True)]:
        text=json.dumps({'settings':{'batch_size':4,'burn_in_steps':0},'timeline':timeline}).encode();js=fn(167,p,s)(env,text);check()
        doc=call(116,p,jc,mid(jc,'parse','(Ljava/lang/String;)Lprocessing/data/JSONObject;',True),[('l',js)])
        applet=new(cl('processing/core/PApplet'),'()V')
        config=new(cc,'(Lprocessing/core/PApplet;Lprocessing/data/JSONObject;)V',[('l',applet),('l',doc)])
        scene=new(gc,init_desc[:-2]+'Z)V',[('l',applet),('l',config),('z',False)])
        call(63,None,scene,mid(gc,'setup','()V'))
        if get(scene,sc,'initializationError','Ljava/lang/Exception;'):raise RuntimeError('Original scene initialization failed')
        instance=new(probe,init_desc,[('l',applet),('l',config)])
        fn(104,None,p,p,p)(env,scene,field(gc,'mobject','Lmathart/symmetrychaos/SymmetryChaosMobject;'),instance);check()
        objects=get(scene,sc,'mobjects','Ljava/util/List;');call(63,None,objects,mid(cl('java/util/List'),'clear','()V'))
        call(63,None,scene,mid(sc,'add','(Lmathart/mobject/Mobject;)V'),[('l',instance)])
        call(63,None,scene,mid(sc,'setRenderMode','(F)V'),[('f',10)])
        for key,value in zip(['replayRebuildPending','replayActive'],flags):fn(105,None,p,p,C.c_ubyte)(env,instance,field(mc,key,'Z'),value)
        check();frames=[]
        for paused in [False,False,True,False,False]:
          fn(109,None,p,p,C.c_int)(env,instance,field(probe,'count','I'),0);check()
          call(63,None,scene,mid(gc,'update','(Z)V'),[('z',paused)])
          n=get(instance,probe,'count','I')
          if not 0<=n<=2:raise RuntimeError('Unexpected update count; capture schema must be expanded')
          frames.append({'paused':paused,'count':n,'calls':[] if not n else ([{'time':get(instance,probe,'firstTime','F'),'dt':get(instance,probe,'firstDt','F')}] if n==1 else [{'time':get(instance,probe,'firstTime','F'),'dt':get(instance,probe,'firstDt','F')},{'time':get(instance,probe,'lastTime','F'),'dt':get(instance,probe,'lastDt','F')}]),'sceneTime':call(57,C.c_float,scene,mid(sc,'getTime','()F')),'frameDeltaTime':call(57,C.c_float,scene,mid(sc,'getFrameDeltaTime','()F'))})
        rows.append({'queue':mode,'pending':flags[0],'replayActive':flags[1],'frames':frames})
    report={'scope':'original GenericSymmetryChaosScene/Scene/config/queue execution with a substituted counting Mobject.update; no original GL or window','jvmSha256':sha(jvm),'sources':sources,'probeSha256':hashlib.sha256(bytecode).hexdigest(),'rows':rows}
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    expected=root/'tests/fixtures/symmetry/scene-dispatch.json'
    if expected.exists() and json.loads(expected.read_text())!=report:raise RuntimeError('Original dispatch differs from pinned evidence')
    print(json.dumps({'cases':len(rows),'counts':[(r['queue'],r['pending'],r['replayActive'],[f['count'] for f in r['frames']]) for r in rows]}))
finally:
    vt=C.cast(vm,C.POINTER(C.POINTER(p))).contents;C.CFUNCTYPE(C.c_int,p)(vt[3])(vm)

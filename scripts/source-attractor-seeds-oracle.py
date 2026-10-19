#!/usr/bin/env python3
"""Independent retained Java Random / StrangeAttractor seed arithmetic.
No product imports, native JVM execution, integration, or original pixels.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zipfile
ROOT=Path(__file__).resolve().parents[1]
JAR=ROOT.parent/'.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar'
JAR_SHA='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'
PINS={'v2-camera-source/JsonAttractorConfig.json':'ec8b62dd7c0b7d2532035017254dc7edb5e3fd65f2ea566545aa1c013bfb27ed','v2-camera-source/StrangeAttractor.json':'5c0d4359c63dc72190cc25cde783908b4294c52158092fb3813901416da6dcfc','v2-camera-source/ConfigUtils.json':'ab0847601571bd0469e73cad05d415df2373fa2eef0196db2258a86d631a0278','roots-native-solver/Random.json':'6d286ed0ead23f50f8f202c3fa2de164d49dbea3a6de9e9df0f66df6234d02e3'}
def f(x):return struct.unpack('>f',struct.pack('>f',x))[0]
def i32(x):return (x+2**31)%2**32-2**31
class Random:
 def __init__(self,seed):self.state=(seed^25214903917)&(2**48-1);self.steps=0
 def next(self,bits):
  self.state=(self.state*25214903917+11)&(2**48-1);self.steps+=1
  return self.state>>(48-bits)
 def next_float(self):return self.next(24)/2**24
 def next_double(self):return (self.next(26)*2**27+self.next(27))/2**53
 def next_int(self,bound):
  bits=self.next(31)
  if bound&(bound-1)==0:return bound*bits//2**31
  while True:
   val=bits%bound
   if i32(bits-val+bound-1)>=0:return val
   bits=self.next(31)
def source(settings,initialization):
 # Numeric fixture inputs only. Native omission and alias precedence are kept
 # separate from the Float32 computation, with no production parser reuse.
 s=settings or {};init=initialization or {};bounds=init.get('bounds',{})
 count_cpu=s.get('particle_count_cpu',s.get('particle_count',250));count_cpu=min(count_cpu,10000)
 count_gpu=s.get('particle_count_gpu',s.get('particle_count',200000) if 'particle_count_cpu' not in s else 200000)
 gpu=s.get('render_mode','CPU').upper()=='GPU';count=count_gpu if gpu else count_cpu
 if 'time_step_min' in s or 'time_step_max' in s:dt_min,dt_max=f(s.get('time_step_min',.005)),f(s.get('time_step_max',.01))
 elif 'time_step' in s:dt_min=dt_max=f(s['time_step'])
 else:dt_min,dt_max=f(.005),f(.01)
 if dt_min>dt_max:dt_min,dt_max=dt_max,dt_min
 span=f(dt_max-dt_min);rng=Random(12345);warm=Random(12345)
 low=max(0,init.get('warmup_stagger_min',0));high=max(0,init.get('warmup_stagger_max',0));low=min(low,high)
 extent=i32(high-low+1) if high>0 else 0;base=init.get('warmup_steps',0)
 seeds=[]
 for index in range(min(count,8)):
  raw=[];pos=[]
  for axis in 'xyz':
   minimum,maximum=f(bounds.get('min_'+axis,-1)),f(bounds.get('max_'+axis,1))
   value=f(minimum+f(rng.next_float()*f(maximum-minimum)));raw.append(value)
   pos.append(f(f(value*f(s.get('scale_'+axis,1)))+f(s.get('offset_'+axis,0))))
  dt=f(dt_min+f(rng.next_float()*span)) if span>0 else dt_min
  steps=0 if gpu else i32(base+(low+warm.next_int(extent) if extent>0 else 0))
  seeds.append({'index':index,'raw':raw,'position':pos,'dt':dt,'warmupSteps':steps})
 return {'count':count,'variableDt':span>0,'seeds':seeds,'positionRngState':str(rng.state),'warmupRngState':str(warm.state)}
def main():
 assert hashlib.sha256(JAR.read_bytes()).hexdigest()==JAR_SHA
 sources=[]
 with zipfile.ZipFile(JAR) as jar:
  for name,sha in PINS.items():
   raw=(ROOT/'.cache'/name).read_bytes();decoded=json.loads(raw);assert decoded['classSha256']==sha
   if decoded['entry'].startswith('mathart/'):assert hashlib.sha256(jar.read(decoded['entry'])).hexdigest()==sha
   sources.append({'path':'.cache/'+name,'classSha256':sha,'evidenceSha256':hashlib.sha256(raw).hexdigest()})
 cases=[('default',None,None),('fixed-dt',{'particle_count':8,'time_step':.01},None),('one-particle',{'particle_count':1},None),('reversed-dt-and-bounds',{'particle_count':8,'time_step_min':.03,'time_step_max':-.01,'scale_x':-2.1,'scale_y':.01,'scale_z':123.456,'offset_x':.33,'offset_z':-99.9},{'bounds':{'min_x':4,'max_x':-3,'min_y':-.001,'max_y':.002},'warmup_steps':19,'warmup_stagger_min':2,'warmup_stagger_max':7}),('cpu-count-clamp',{'particle_count_cpu':10001},None),('gpu-skips-cpu-warmup',{'render_mode':'GPU','particle_count_gpu':8},{'warmup_steps':13,'warmup_stagger_min':3,'warmup_stagger_max':20}),('negative-stagger',{'particle_count_cpu':8},{'warmup_steps':5,'warmup_stagger_min':-2,'warmup_stagger_max':-3}),('stagger-min-clamped',{'particle_count_cpu':8},{'warmup_steps':2,'warmup_stagger_min':20,'warmup_stagger_max':3}),('negative-base',{'particle_count_cpu':8},{'warmup_steps':-100,'warmup_stagger_min':2,'warmup_stagger_max':7}),('warmup-sum-overflow',{'particle_count_cpu':8},{'warmup_steps':2147483647,'warmup_stagger_min':1,'warmup_stagger_max':3}),('stagger-range-overflow',{'particle_count_cpu':8},{'warmup_steps':5,'warmup_stagger_min':0,'warmup_stagger_max':2147483647}),('dt-rounds-fixed',{'particle_count_cpu':8,'time_step_min':1,'time_step_max':1+2**-25},None),('rejection-sampling',{'particle_count_cpu':8},{'warmup_steps':1,'warmup_stagger_min':1,'warmup_stagger_max':1073741825})]
 result=[]
 for name,s,i in cases:result.append({'id':name,'settings':s,'initialization':i,'expected':source(s,i)})
 rng=[]
 for seed in [0,12345,-1,9223372036854775807]:
  random=Random(seed);ops=[]
  for bound in [1,2,3,16,1073741824,1073741825,2147483647,7]*2:
   for method in ['float','int','double']:
    before=random.steps;value=random.next_float() if method=='float' else random.next_int(bound) if method=='int' else random.next_double()
    ops.append({'method':method,'bound':bound,'value':value,'state':str(random.state),'steps':random.steps-before})
  rng.append({'seed':str(seed),'operations':ops})
 output={'kind':'independent-python-retained-bytecode-transcription','artifactSha256':JAR_SHA,'sources':sources,'cases':result,'rng':rng,'limitations':['No original Java/JOGL runtime, integration or original pixels.','Random class identity is pinned to retained runtime evidence; app class identities additionally verified from fixed JAR.']}
 path=ROOT/'tests/fixtures/source-attractor/seeds.json';text=json.dumps(output,indent=2)+'\n'
 if '--check' in sys.argv:assert path.read_text()==text,'source Attractor seed fixture drift'
 else:path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
 print(f'{len(result)} source seed fixtures; {len(rng)} mixed Java Random streams verified')
if __name__=='__main__':main()

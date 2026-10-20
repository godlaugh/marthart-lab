#!/usr/bin/env python3
"""Independently interpret pinned SimplexNoise2D scalar bytecode into source LUT.

From studio/: python3 scripts/source-samila-noise-oracle.py [--output DIRECTORY]
[--check] [--jar PATH]. No product imports, original JVM or native renderer.
Writes noise-lut.f32 (little-endian 256x256) and report.json/report.md. Inputs
and Java float instruction order come from fixed class disassembly. The outer
LUT coordinate loop is transcribed from SamilaMobject.initNoiseLUT PC78-142.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import time
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('source_evidence',ROOT/'scripts/source-zero-duration-oracle.py')
e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
F=e.f

class NoiseBytecode:
    """Closed numeric opcode set of the verified class; unknown instructions fail."""
    def __init__(self,data):
        self.methods={}
        for method in data['methods']:
            if method['name']=='<init>':continue
            code=[(i['offset'],int(i['opcode'],16),i['args'],i['reference']) for i in method['instructions']]
            self.methods[method['name']]=(code,{i[0]:n for n,i in enumerate(code)})
        assert set(self.methods)=={'noise','mod289','permute','fract'}
    def run(self,name,arguments,depth=0):
        assert depth<8
        code,offsets=self.methods[name];local=list(arguments)+[0]*40;stack=[];cursor=0
        for _ in range(1000):
            pc,op,arg,ref=code[cursor];cursor+=1
            if 0x03<=op<=0x08:stack.append(op-0x03)
            elif 0x0b<=op<=0x0d:stack.append(float(op-0x0b))
            elif op in (0x12,0x13):assert isinstance(ref,(int,float));stack.append(ref)
            elif 0x22<=op<=0x25:stack.append(local[op-0x22])
            elif op in (0x15,0x17):stack.append(local[int(arg,16)])
            elif 0x43<=op<=0x46:local[op-0x43]=stack.pop()
            elif op in (0x36,0x38):local[int(arg,16)]=stack.pop()
            elif op==0x62:b=stack.pop();stack.append(F(stack.pop()+b))
            elif op==0x66:b=stack.pop();stack.append(F(stack.pop()-b))
            elif op==0x6a:b=stack.pop();stack.append(F(stack.pop()*b))
            elif op==0x8d:pass
            elif op==0x90:stack.append(F(stack.pop()))
            elif op in (0x95,0x96):
                b,a=stack.pop(),stack.pop();stack.append((-1 if op==0x95 else 1) if math.isnan(a) or math.isnan(b) else (a>b)-(a<b))
            elif op in (0x99,0x9e,0xa7):
                value=0 if op==0xa7 else stack.pop()
                if op==0xa7 or op==0x99 and value==0 or op==0x9e and value<=0:cursor=offsets[pc+int.from_bytes(bytes.fromhex(arg),'big',signed=True)]
            elif op==0xb8:
                owner,method,descriptor=ref.split(' ');count=len(descriptor.split(')')[0])-1;values=stack[-count:];del stack[-count:]
                if owner=='mathart/samila/SimplexNoise2D':result=self.run(method,values,depth+1)
                elif owner=='java/lang/Math' and method=='floor':result=float(math.floor(values[0]))
                elif owner=='java/lang/Math' and method=='max':result=max(values)
                elif owner=='java/lang/Math' and method=='abs':result=abs(values[0])
                else:raise AssertionError(ref)
                stack.append(result)
            elif op==0xae:assert len(stack)==1;return stack.pop()
            else:raise AssertionError((name,pc,op,arg,ref))
        raise AssertionError('bytecode work bound exceeded')

def build(jar):
    evidence=e.Evidence(jar)
    data=evidence.read('.cache/v2-samila-splat-source/SimplexNoise2D.class.json')
    host=evidence.read('.cache/v2-samila-timeline-source/SamilaMobject.class.json')
    method=next(m for m in host['methods'] if m['name']=='initNoiseLUT')
    assert any(i['offset']==139 and i['reference']=='mathart/samila/SimplexNoise2D noise (FF)F' for i in method['instructions'])
    vm=NoiseBytecode(data);values=[]
    for y in range(256):
        py=F(F(((y+.5)/256)*2-1)*F(.5))
        for x in range(256):
            px=F(F(((x+.5)/256)*2-1)*F(.5));values.append(vm.run('noise',[px,py]))
    binary=struct.pack('<65536f',*values)
    points=[[0,0],[.1,-.2],[-.1,.2],[.5,.5],[-.5,-.5],[.25,.25],[.25,.25000003],[1,1],[-1,1],[289,-289],[1e-8,-1e-8]]
    samples=[dict(input=list(map(F,p)),value=vm.run('noise',list(map(F,p)))) for p in points]
    report=dict(evidenceKind='independent Python interpretation of original numeric bytecode; no product import/JVM execution',jarSha256=e.JAR_SHA,evidence=evidence.rows,dimensions=[256,256],format='little-endian row-major Float32 single channel',coordinates='F(F(((index + .5 double)/256 double)*2 double - 1 double)*.5F)',sha256=hashlib.sha256(binary).hexdigest(),bytes=len(binary),min=min(values),max=max(values),samples=samples,limits=['Complete source SimplexNoise2D scalar method opcodes are interpreted with explicit IEEE754 float32 after every float operation; Java Math.floor inputs here are finite and exactly represented.','Outer coordinate loop is separately transcribed from fixed host bytecode PC78–142. No OpenGL texture interpolation, original JVM, window, GPU or source random stream is exercised.','This CPU-generated source LUT must not be replaced by GPU shader snoise; fused arithmetic may differ even when algebraic formulas look identical.','CPU time, peak RSS and token usage are not measured; elapsed wall time is diagnostic only.'])
    return report,binary

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--jar',type=Path,default=ROOT.parent/'.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar');p.add_argument('--output',type=Path,default=ROOT/'.cache/samila-noise-oracle');p.add_argument('--check',action='store_true');a=p.parse_args();started=time.perf_counter();report,binary=build(a.jar);text=json.dumps(report,indent=2)+'\n'
    if a.check:
        assert (a.output/'noise-lut.f32').read_bytes()==binary,'LUT bytes changed';assert (a.output/'report.json').read_text()==text,'oracle metadata changed'
    else:
        a.output.mkdir(parents=True,exist_ok=True);(a.output/'noise-lut.f32').write_bytes(binary);(a.output/'report.json').write_text(text);(a.output/'report.md').write_text('# Original Samila CPU noise LUT oracle\n\n65,536 scalar calls interpreted from fixed Java bytecode; no original runtime execution.\n\nLUT SHA256: `'+report['sha256']+'`.\n\n'+'\n'.join('- '+x for x in report['limits'])+'\n')
    print(json.dumps(dict(status='checked' if a.check else 'generated',output=str(a.output),sha256=report['sha256'],samples=65536,elapsedSeconds=time.perf_counter()-started)))
if __name__=='__main__':main()

#!/usr/bin/env python3
"""Source-derived independent Surface parameter numeric witnesses.

Python binary64 sin/asin with source F32 easing/dt boundaries; not native JVM
execution. This script never imports product code. --check verifies the fixture.
"""
import argparse, hashlib, json, math, struct
from pathlib import Path

f=lambda v:struct.unpack('>f',struct.pack('>f',v))[0]
tau=2*math.pi

def edge(phase,window=.4,floor=.5):
 p=phase
 while p>tau:p-=tau
 while p<0:p+=tau
 def distance(x):
  d=abs(p-x)%tau
  return tau-d if d>math.pi else d
 q=max(0,min(1,min(distance(math.pi/2),distance(3*math.pi/2))/max(1e-6,window)))
 eased=f(math.sin(f(f(f(q)*f(math.pi))/f(2))))
 return floor+(1-floor)*eased

def witness(name,initial,step,minimum,maximum,dt,fps,scale=1,window=.4,floor=.5,count=3):
 span=maximum-minimum;middle=(minimum+maximum)/2;half=span/2
 phase=0 if span<=1e-6 else math.asin(max(-1,min(1,(initial-middle)/half)))
 if span>1e-6 and step<0:phase=math.pi-phase
 out=dict(name=name,inputs=dict(initial=initial,step=step,min=minimum,max=maximum,dt=f(dt),frameRate=f(fps),scale=scale,edge=dict(window=window,floor=floor,easing='SINE_OUT')),initialPhase=phase,frames=[])
 for _ in range(count):
  old=phase;gain=edge(old,window,floor)
  if span<=1e-6:value=minimum;delta=0
  else:
   delta=((abs(step)*scale)*gain)/half*(f(dt)*(f(fps) if f(fps)>1 else 60))
   phase+=delta
   if phase>tau:phase-=tau
   value=middle+half*math.sin(phase)
  out['frames'].append(dict(phaseBefore=old,edgeScale=gain,delta=delta,phase=phase,value=value,geometryFloat=f(value)))
 return out


def fixtures():
    rows = [
        witness('positive-inside-default-edge',.25,.1,-1,1,.25,4,scale=.5,count=4),
        witness('negative-inside-default-edge',.25,-.1,-1,1,.25,4,count=4),
        witness('outside-positive-starts-upper',5,.1,-1,1,.25,4,count=3),
        witness('outside-negative-starts-lower',-5,-.1,-1,1,.25,4,count=3),
        witness('reverse-range-keeps-min',.25,.1,2,-2,.25,4,count=2),
        witness('narrow-range-keeps-min-even-zero-gain',.25,.1,2,2.0000001,.25,4,scale=0,count=2),
        witness('stored-phase-only-one-subtraction',0,20,-1,1,.25,4,count=3),
        witness('frameRate-one-uses-sixty',0,.1,-1,1,.25,1,count=2),
        witness('frameRate-four-is-not-fixed-sixty',0,.1,-1,1,.25,4,count=2),
        witness('named-json-edge-default-differs',5,.1,-1,1,.25,4,window=.5,floor=.25,count=3),
        witness('zero-gain-still-clamps-first-value',5,.1,-1,1,.25,4,scale=0,count=2),
    ]
    return dict(metadata=dict(
      evidenceKind='Independent Python bytecode transcription; no native JVM or rendered frame execution',
      artifactSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
      methods=['SurfaceParameterAnimator.addParam/start/update', 'OscillationEdgeEasing.speedScale/angularDistance/wrapPhase', 'Easings.easeOutSine'],
      sourceDetails='See retained .cache/v2-surface-parameter-runtime-audit.json for class hashes and instruction offsets',
      precision='double recurrence, original F32 frame inputs and easing intermediates; Python libm transcendental final ulps may differ from JVM/JS'), witnesses=rows)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    path=Path(__file__).resolve().parents[1]/'tests/fixtures/source-surface-parameters/numerics.json'
    rendered=json.dumps(fixtures(),indent=2,allow_nan=False)+'\n'
    if args.check:
        if not path.exists() or path.read_text()!=rendered:
            raise SystemExit('FAIL: parameter fixture differs; regenerate and review')
    else:
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(rendered)
    print(json.dumps(dict(status='checked' if args.check else 'written',sha256=hashlib.sha256(rendered.encode()).hexdigest())))

if __name__=='__main__':main()

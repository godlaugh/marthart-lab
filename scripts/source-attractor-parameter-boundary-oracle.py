#!/usr/bin/env python3
"""Small source-boundary witnesses: ATTRACTOR has no parameter animator.

Static bytecode transcription, not target execution. Run from studio with
--check to verify tests/fixtures/source-attractor/parameter-boundary.json.
The witnesses intentionally do not invent a Surface oscillator for Attractor.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
JAR_SHA = 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'
JAR = ROOT.parent / '.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar'
F = lambda value: struct.unpack('>f', struct.pack('>f', value))[0]


def main():
    assert hashlib.sha256(JAR.read_bytes()).hexdigest() == JAR_SHA
    evidence = []
    with zipfile.ZipFile(JAR) as archive:
        for name in ['JsonAttractorConfig', 'GenericDifferentialEquation', 'StrangeAttractor', 'GenericScene', 'CameraAnimator', 'EulerIntegrator']:
            path = f'.cache/v2-camera-source/{name}.json'
            raw = (ROOT/path).read_bytes(); data = json.loads(raw)
            assert hashlib.sha256(archive.read(data['entry'])).hexdigest() == data['classSha256']
            evidence.append(dict(path=path, classSha256=data['classSha256'], evidenceSha256=hashlib.sha256(raw).hexdigest()))
            if name == 'JsonAttractorConfig':
                methods = {method['name']: method for method in data['methods']}
                setup = {i['offset']: i for i in methods['setupTimeline']['instructions']}
                apply = methods['applyAction']['instructions']
                assert setup[480]['opcode'] == '0x99' and setup[480]['args'] == '00a3'  # unknown type ->643
                assert apply[-1]['offset'] == 267 and apply[-1]['opcode'] == '0xb1'
                literals = [i['reference'] for i in apply if i['opcode'] in ['0x12','0x13']]
                assert literals == ['rotateTheta','rotatePhi','zoom','focal','track','stopTracking','stopAmbient','setRates','ambient']
                assert not any('param' in str(i['reference']).lower() for i in methods['setupTimeline']['instructions'])
        classes = [n for n in archive.namelist() if n.startswith('mathart/') and n.endswith('.class')]
        equation_references = [n for n in classes if b'mathart/attractor/math/GenericDifferentialEquation' in archive.read(n)]
        assert equation_references == ['mathart/attractor/config/JsonAttractorConfig.class','mathart/attractor/math/GenericDifferentialEquation.class']
        parameter_animators = [n for n in classes if 'AttractorParam' in n and '/animation/' in n]

    rows = []
    def witness(name, timeline, queue, error=None):
        rows.append(dict(id=name,timeline=timeline,expected=dict(queue=queue,parameterWrites=0,error=error)))
    ignored = {'method':'paramStart','args':[{'parameters':{'a':{'min':'bad','max':{},'step':[]}}}]}
    witness('param-start-array-is-wait', [dict(type='animate',duration=2,actions=[ignored])], [dict(type='wait',duration=2)])
    witness('param-stop-object-is-wait', [dict(type='animate',duration=1,actions=[dict(method='paramStop',args={'parameters':False})])], [dict(type='wait',duration=1)])
    witness('unknown-array-129-not-inspected', [dict(type='animate',duration=3,actions=[dict(method='paramStart',args=[None]*128+[{'malformed':{'a':[]}}])])], [dict(type='wait',duration=3)])
    witness('unknown-scalar-args-is-wait', [dict(type='animate',duration=0,actions=[dict(method='paramStart',args='not numeric')])], [dict(type='wait',duration=0)])
    witness('standalone-param-skips-all-payload', [dict(type='param',duration='not numeric',easing={},parameters=False,actions=17)], [])
    witness('standalone-param-does-not-consume-time', [dict(type='wait',duration=1),dict(type='PARAM',duration=100,parameters={}),dict(type='wait',duration=2)], [dict(type='wait',duration=1),dict(type='wait',duration=2)])
    witness('disabled-skips-even-type', [dict(enabled=False,type=17,duration={},parameters=[])], [])
    witness('ignored-action-does-not-erase-zoom', [dict(type='animate',duration=2,actions=[dict(method='zoom',args=[3]),ignored])], [dict(type='animate',duration=2,actions=[dict(method='zoom',args={'value':3})])])
    witness('known-zoom-ignores-long-tail', [dict(type='animate',duration=2,actions=[dict(method='zoom',args=[3]+[None]*128)])], [dict(type='animate',duration=2,actions=[dict(method='zoom',args={'value':3})])])
    witness('set-rates-alias-reads-only-first-three', [dict(type='animate',duration=2,actions=[dict(method='setRates',args=[1,2,3]+[{}]*126)])], [dict(type='animate',duration=2,actions=[dict(method='ambient',args={'phiSpeed':1,'thetaSpeed':2,'gammaSpeed':3})])])
    witness('empty-method-is-unknown', [dict(type='animate',duration=1,actions=[dict(method='',args=[])])], [dict(type='wait',duration=1)])
    witness('missing-method-still-errors', [dict(type='animate',duration=1,actions=[dict(args=[])])], [], 'required-method-string')
    witness('nonstring-method-still-errors', [dict(type='animate',duration=1,actions=[dict(method=7,args=[])])], [], 'required-method-string')

    captures = []
    for name,value,dt in [('a',2.,.5),('x',3.,.5),('a',16777217.,2**-24)]:
        # createGenericEquation maps x/y/z to0/1/2, THEN parameter to3.
        # GenericDifferentialEquation.<init> PC100-121 snapshots double; compute
        # PC12-29 updates only0..2 and PC36-42 narrows evaluated derivative to F.
        initial_params = [0.,0.,0.,value]
        mutated_map = {name:1000.}
        thread_values = initial_params[:]  # lambda$new$0 clone, even after map edit
        derivative = F(thread_values[3]); position = F(1.)
        step = lambda x: F(x + F(derivative*F(dt)))  # EulerIntegrator separate fmul/fadd
        for _ in range(2): position = step(position)
        warm = position; frames = []
        for _ in range(2):
            for _ in range(3): position = step(position)
            frames.append(position)
        captures.append(dict(parameter=name,initialDouble=value,configMapAfterConstruction=mutated_map,
            equationDx=name,compiledSlot=3,initialX=1,dt=dt,warmupSteps=2,substepsPerActiveFrame=3,
            expected=dict(capturedDouble=thread_values[3],derivativeFloat=derivative,afterWarmupX=warm,frameX=frames)))
    out=dict(schemaVersion=1,artifactSha256=JAR_SHA,evidenceKind='independent static-bytecode boundary witnesses; no target execution',
        sourceEvidence=evidence,attractorRecognizedCameraMethods=literals,equationStaticReferences=equation_references,
        otherFamilyParameterAnimatorClasses=parameter_animators,dispatch=rows,equationCaptures=captures,
        limits=['No ATTRACTOR parameter animation exists in the inspected dispatcher/runtime; no oscillator numeric oracle is claimed.',
                'Expected wait normalizes a native empty CameraAnimator to its actual Wait; import may preserve an empty animate author representation.',
                'Equation captures use one parameter and direct-variable dx, avoiding invented Java HashMap iteration order.',
                'Static absence of a setter does not establish native UI rebuild behavior; no live UI or framebuffer was executed.'])
    path=ROOT/'tests/fixtures/source-attractor/parameter-boundary.json'; text=json.dumps(out,indent=2)+'\n'
    if '--check' in sys.argv:
        assert path.read_text()==text, 'Attractor parameter-boundary fixture drift'
    else:
        path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
    print(f'{len(rows)} dispatch and {len(captures)} captured-equation witnesses '+('verified' if '--check' in sys.argv else 'written'))


if __name__ == '__main__': main()

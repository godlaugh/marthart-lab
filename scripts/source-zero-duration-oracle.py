#!/usr/bin/env python3
"""Independent retained-bytecode oracle for nonpositive ordinary queue durations.

python3 scripts/source-zero-duration-oracle.py [--check] [--jar PATH]
Never imports product code or executes the target. Easing functions are evaluated
by a bounded interpreter over the retained JVM instructions, not copied TS code.
Lifecycle is a PC-annotated transcription. Special floats are JSON strings.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
JAR_SHA = 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'
DEFAULT_JAR = ROOT.parent / '.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar'


def f(value):
    try:
        return struct.unpack('>f', struct.pack('>f', value))[0]
    except OverflowError:
        return math.copysign(math.inf, value)


def div(a, b):
    if b == 0:
        return math.nan if a == 0 or math.isnan(a) else math.copysign(math.inf, a * math.copysign(1, b))
    return a / b


def constrain(x):
    return 0. if x < 0 else 1. if x > 1 else x


def lerp(a, b, t):
    return f(a + f(f(b - a) * t))


def encode(value):
    if isinstance(value, float) and value == 0 and math.copysign(1, value) < 0:
        return '-0'
    if isinstance(value, float) and not math.isfinite(value):
        return 'NaN' if math.isnan(value) else 'Infinity' if value > 0 else '-Infinity'
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    if isinstance(value, list):
        return [encode(v) for v in value]
    return value


class Evidence:
    def __init__(self, jar):
        assert hashlib.sha256(jar.read_bytes()).hexdigest() == JAR_SHA, 'Unexpected artifact'
        self.jar = zipfile.ZipFile(jar)
        self.rows = []

    def read(self, path):
        raw = (ROOT / path).read_bytes()
        data = json.loads(raw)
        assert hashlib.sha256(self.jar.read(data['entry'])).hexdigest() == data['classSha256'], path
        self.rows.append(dict(path=path, entry=data['entry'], classSha256=data['classSha256'], evidenceSha256=hashlib.sha256(raw).hexdigest()))
        return data


class Easings:
    """Only the finite set of numerical opcodes present in pinned Easings methods."""
    def __init__(self, evidence):
        main = evidence.read('.cache/v2-camera-source/Easings.json')
        self.methods = {(m['name'], m['descriptor']): m for m in main['methods']}
        self.names = {}
        for i in self.methods['<clinit>', '()V']['instructions']:
            if i['opcode'] in ['0x12', '0x13'] and isinstance(i['reference'], str):
                name = i['reference']
            if i['opcode'] == '0xbb' and i['reference'].startswith('mathart/animation/Easings$'):
                number = int(i['reference'].split('$')[-1])
                row = evidence.read(f'.cache/spirograph-easings-complete/Easings-{number}.json')
                self.names[name] = next(m for m in row['methods'] if m['name'] == 'apply')
        assert len(self.names) == 46

    def apply(self, name, value):
        return self.run(self.names[name], [None, f(value)])

    def run(self, method, arguments, depth=0):
        assert depth < 20
        code = method['instructions']; offsets = {i['offset']: n for n, i in enumerate(code)}
        local = dict(enumerate(arguments)); stack = []; cursor = 0
        for _ in range(2000):
            i = code[cursor]; cursor += 1; op = int(i['opcode'], 16); arg = i['args']; ref = i['reference']
            if 0x0b <= op <= 0x0d: stack.append(float(op - 0x0b))
            elif op in [0x12, 0x13]: stack.append(ref)
            elif 0x22 <= op <= 0x25: stack.append(local[op - 0x22])
            elif op == 0x17: stack.append(local[int(arg, 16)])
            elif 0x43 <= op <= 0x46: local[op - 0x43] = stack.pop()
            elif op == 0x38: local[int(arg, 16)] = stack.pop()
            elif op == 0x59: stack.append(stack[-1])
            elif op in [0x62, 0x66, 0x6a, 0x6e]:
                b, a = stack.pop(), stack.pop()
                stack.append(f({0x62: lambda: a+b, 0x66: lambda: a-b, 0x6a: lambda: a*b, 0x6e: lambda: div(a,b)}[op]()))
            elif op == 0x76: stack.append(-stack.pop())
            elif op == 0x8d: pass  # f2d is exact in the host representation
            elif op == 0x90: stack.append(f(stack.pop()))
            elif op in [0x95, 0x96]:
                b, a = stack.pop(), stack.pop()
                stack.append((-1 if op == 0x95 else 1) if math.isnan(a) or math.isnan(b) else (a > b) - (a < b))
            elif op in [0x9a, 0x9c, 0x9e, 0xa7]:
                value = 0 if op == 0xa7 else stack.pop()
                if op == 0xa7 or {0x9a: value != 0, 0x9c: value >= 0, 0x9e: value <= 0}.get(op, False):
                    cursor = offsets[i['offset'] + int.from_bytes(bytes.fromhex(arg), 'big', signed=True)]
            elif op == 0xb8:
                owner, name, descriptor = ref.split(' ')
                count = len(descriptor.split(')')[0]) - 1
                values = stack[-count:]; del stack[-count:]
                if owner == 'mathart/animation/Easings':
                    result = self.run(self.methods[name, descriptor], values, depth+1)
                elif owner == 'java/lang/Math':
                    try: result = getattr(math, name)(*values)
                    except ValueError: result = math.nan
                    except OverflowError: result = math.inf
                else: raise AssertionError(ref)
                stack.append(result)
            elif op == 0xae: return stack.pop()
            else: raise AssertionError((method['name'], i))
        raise AssertionError('Bytecode budget exceeded')


class Queue:
    def __init__(self, case, easing):
        self.ease = easing; self.case = case; self.index = 0; self.time = 0.; self.particle_updates = 0
        self.camera = dict(phi=1., theta=2., gamma=3., zoom=1., focal=20., center=[0., 0., 0.], rates=[0., 0., 0.])
        self.camera['rates'] = list(map(f, self.camera['rates']))
        self.target = [4., 5., 6.]; self.tracking = False
        self.gradient = dict(running=False, speedScale=0., targetSpeed=0., progress=0.)
        self.clips = [self.build(spec) for spec in case['clips']]

    def build(self, spec):
        duration = f(spec['duration']); actions = spec.get('actions', [])
        # CameraAnimator.build PC268–329: Wait, one child, or group(max(0,d)).
        children = [dict(action=a, duration=duration, started=False, finished=False, runtime=0.) for a in actions]
        # A gradient clip also wraps an empty-camera Wait, per Json*Config.setupTimeline.
        if any(a in ['gradientStart', 'gradientStop'] for a in actions):
            children.insert(0, dict(action='wait', duration=duration, started=False, finished=False, runtime=0.))
        if not children: children = [dict(action='wait', duration=duration, started=False, finished=False, runtime=0.)]
        return dict(duration=max(0., duration) if len(children)>1 else duration,
                    children=children, started=False, runtime=0., easing=spec.get('easing', 'LINEAR'))

    def start(self, child):
        a = child['action']; child['started'] = True
        if a in ['phi', 'zoom', 'focal']: child['start'] = self.camera[a]
        elif a == 'alignPhi':
            child['start'] = self.camera['phi']
            child['end'] = f(f(f(f(math.floor(f(div(self.camera['phi'], f(2*math.pi)))))+1)*f(2*math.pi))+.5)
        elif a == 'track':
            self.tracking = False; child['start'] = self.camera['center'][:]
        elif a == 'rates': child['start'] = self.camera['rates'][:]
        elif a == 'gradientStart':
            self.gradient.update(running=True, speedScale=0., targetSpeed=180., progress=0.)
        elif a == 'gradientStop':
            child['finished'] = not self.gradient['running']
            child['start'] = self.gradient['speedScale']

    def update(self, child, dt, easing):
        if child['finished']: return None
        child['runtime'] = f(child['runtime'] + dt)
        alpha = constrain(f(div(child['runtime'], child['duration'])))  # Animation.update PC29–46
        a = child['action']; t = self.ease.apply(easing, alpha) if a != 'wait' else alpha
        if a in ['phi', 'zoom', 'focal']: self.camera[a] = lerp(child['start'], {'phi': 4., 'zoom': 2., 'focal': 40.}[a], t)
        elif a == 'alignPhi': self.camera['phi'] = lerp(child['start'], child['end'], t)
        elif a == 'track': self.camera['center'] = [lerp(x,y,t) for x,y in zip(child['start'], self.target)]
        elif a == 'rates': self.camera['rates'] = [lerp(x,y,t) for x,y in zip(child['start'], [1.,2.,3.])]
        elif a == 'gradientStart': self.gradient['speedScale'] = 0. if t < 0 else t
        elif a == 'gradientStop':
            scale = child['start'] * (1. - t); self.gradient['speedScale'] = 0. if scale < 0 else scale
        def affected():
            if a in ['phi', 'zoom', 'focal', 'rates']: return copy.deepcopy(self.camera[a])
            if a == 'alignPhi': return self.camera['phi']
            if a == 'track': return dict(center=self.camera['center'][:], tracking=self.tracking)
            if a.startswith('gradient'): return self.gradient.copy()
            return None
        transient = affected()
        if child['runtime'] >= child['duration']:  # finish follows onUpdate; no intermediate finite guard
            child['finished'] = True
            if a == 'rates': self.camera['rates'] = [1., 2., 3.]
            elif a == 'track': self.tracking = True  # startTracking only stores the PVector reference
            elif a == 'gradientStart': self.gradient['speedScale'] = 1.
            elif a == 'gradientStop': self.gradient.update(running=False, speedScale=0., targetSpeed=0.)
        return dict(action=a, alpha=alpha, eased=t, afterOnUpdate=transient, afterFinish=affected())

    def step(self, raw_dt):
        raw_dt = f(raw_dt); complete = self.index >= len(self.clips); events = []; active = 0.
        if not complete:
            clip = self.clips[self.index]
            remaining = max(0., f(clip['duration'] - clip['runtime']))
            for later in self.clips[self.index+1:]: remaining = f(remaining + max(0., later['duration']))
            active = min(raw_dt, remaining) if remaining > 0 else 0.
            self.time = f(self.time + active)
            if not clip['started']:
                clip['started'] = True
                for child in clip['children']: self.start(child)  # Group starts ALL before updates
            clip['runtime'] = f(clip['runtime'] + active)
            for child in clip['children']:
                event = self.update(child, active, clip['easing'])
                if event: events.append(event)
            if clip['runtime'] >= clip['duration'] and all(c['finished'] for c in clip['children']): self.index += 1
            self.particle_updates += 1  # Scene dispatch even activeDt=0, after queue children finish
            self.advance_gradient(active)
            # Explicit supplied target mutation represents the bound particle owner's update.
            delta = self.case.get('targetDeltaPerActiveFrame', 0.)
            self.target = [f(x+delta) for x in self.target]
        else:
            remaining = 0.; self.time = f(self.time + raw_dt)
        if raw_dt > 0:  # CameraController.update PC0–25; zero dt does not repair tracking center
            if self.tracking: self.camera['center'] = self.target[:]
            for key, rate in zip(['phi','theta','gamma'], self.camera['rates']): self.camera[key] = f(self.camera[key] + f(rate*raw_dt))
        if self.case.get('rawGradientPhase', False): self.advance_gradient(raw_dt)
        camera_finite = all(math.isfinite(x) for x in [self.camera[k] for k in ['phi','theta','gamma','zoom','focal']] + self.camera['center'] + self.camera['rates'])
        return dict(rawDt=raw_dt, activeDt=active, remaining=remaining, sceneTime=self.time, cameraFinite=camera_finite,
                    queueIndex=self.index, queueComplete=self.index>=len(self.clips), activeObjectUpdates=self.particle_updates,
                    camera=copy.deepcopy(self.camera), tracking=self.tracking, target=self.target[:], gradient=self.gradient.copy(), events=events)

    def advance_gradient(self, dt):
        g = self.gradient
        if g['running'] and dt > 0:
            progress = g['progress'] + (g['targetSpeed']*g['speedScale'])*dt/360.
            g['progress'] = progress - math.floor(progress)


def cases():
    rows = []
    def add(name, clips, steps, **extra): rows.append(dict(id=name, clips=clips, rawDts=steps, **extra))
    for duration, label in [(0., 'zero'), (-1., 'negative'), (-0., 'negative-zero')]:
        for action in ['wait', 'phi', 'alignPhi', 'zoom', 'focal', 'rates', 'track', 'gradientStart']:
            add(f'{label}-{action}-initial-zero-dt', [dict(duration=duration, actions=[] if action=='wait' else [action])], [0., .25])
        add(f'{label}-zoom-positive-raw-all-remaining-zero', [dict(duration=duration, actions=['zoom'])], [.25])
        add(f'{label}-zoom-positive-following-wait', [dict(duration=duration, actions=['zoom']), dict(duration=1.)], [.25,.25])
    add('zero-waits-one-per-frame', [dict(duration=0.),dict(duration=0.)], [.25,.25,.25])
    add('zero-track-post-mobject-reference', [dict(duration=0.,actions=['track'])], [.25,.25], targetDeltaPerActiveFrame=1.)
    add('zero-track-mixed-zoom-final-invalid', [dict(duration=0.,actions=['track','zoom','rates'])], [.25])
    add('zero-gradient-start-stop', [dict(duration=0.,actions=['gradientStart','gradientStop'])], [0.,.25])
    add('zero-gradient-stop-start', [dict(duration=0.,actions=['gradientStop','gradientStart'])], [0.,.25])
    add('zero-gradient-stop-running', [dict(duration=1.,actions=['gradientStart']),dict(duration=0.,actions=['gradientStop'])], [1.,0.,.25])
    add('zero-gradient-active-only-attractor', [dict(duration=0.,actions=['gradientStart'])], [.25,.25])
    add('zero-gradient-active-and-raw-root-policy', [dict(duration=0.,actions=['gradientStart'])], [.25,.25], rawGradientPhase=True)
    add('zero-zoom-then-positive-zoom-cannot-repair-nan-start', [dict(duration=0.,actions=['zoom']),dict(duration=1.,actions=['zoom'])], [0.,1.])
    add('negative-multi-child-clamped-group-duration', [dict(duration=-1.,actions=['zoom','rates'])], [.25])
    add('roots-positive-duration-preserved', [dict(duration=f(.001),actions=['zoom'])], [0., f(1/60)])
    return rows


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--check',action='store_true'); parser.add_argument('--jar',type=Path,default=DEFAULT_JAR); args=parser.parse_args()
    evidence=Evidence(args.jar); easing=Easings(evidence)
    for name in ['Animation','AnimationGroup','SceneManager','Scene','CameraAnimator','CameraController','MoveCamera','ZoomCamera','SmoothFocalDistance','SetAmbientRotation','CameraTrackTransition','AlignCamera','StartGradientAnimation','StopGradientAnimation','GradientAnimator','GradientRuntimeState','JsonAttractorConfig','StrangeAttractor','SurfaceParameterAnimator','StartSurfaceParamAnimation','StopSurfaceParamAnimation','AnimateSurfaceParam']:
        evidence.read(f'.cache/v2-camera-source/{name}.json')
    evidence.read('.cache/spirograph-clock-Wait-bytecode.json')
    rows=cases()
    for row in rows:
        queue=Queue(row,easing); row['expected']=[queue.step(dt) for dt in row['rawDts']]
    ease_rows=[dict(name=name,nan=easing.apply(name,math.nan),negativeZero=easing.apply(name,-0.),zero=easing.apply(name,0.),one=easing.apply(name,1.)) for name in easing.names]
    assert all(math.isnan(row['nan']) for row in ease_rows), 'Unexpected easing NaN recovery'
    surface_scales=[]
    for duration in [0.,-1.,-0.]:
        for dt in [0.,.25]:
            t=easing.apply('LINEAR',constrain(f(div(f(dt),f(duration)))))
            surface_scales.append(dict(duration=duration,activeDt=dt,eased=t,
                start=dict(onStart=0.,onUpdate=0. if t<=0 else t,onFinish=1.),
                stopWhileRunning=dict(captured=1.,onUpdate=0. if 1-t<0 else 1-t,onFinish=0.),
                stopWhileNotRunning=dict(finishedOnStart=True,updateCalled=False,finishCalled=False)))
    payload=encode(dict(schemaVersion=1,kind='independent-retained-bytecode-oracle',artifactSha256=JAR_SHA,
        sourceEvidence=evidence.rows,initialCamera=dict(phi=1.,theta=2.,gamma=3.,zoom=1.,focal=20.,center=[0.,0.,0.],rates=[0.,0.,0.]),
        easings=ease_rows,surfaceParameterScales=surface_scales,cases=rows,
        limits=['No target JVM/app/framebuffer execution; native parity is not established.',
                'Camera and HUE_ROTATE gradient scalar lifecycle only, not a particle-motion or palette pixel oracle.',
                'Active object counts establish dispatch only; CPU Attractor fixed substeps are tested by its motion owner.',
                'targetDeltaPerActiveFrame is an explicit synthetic mutable-target fixture, not a native particle equation.',
                'Root rawGradientPhase is an explicit family caller policy; ordinary CPU Attractor advances only during active object update.',
                'Host libm last bits are not guaranteed identical to Java Math.']))
    path=ROOT/'tests/fixtures/source-camera/zero-duration.json'; output=json.dumps(payload,indent=2,allow_nan=False)+'\n'
    if args.check:
        assert path.read_text()==output, 'Zero-duration fixture drift'
    else:
        path.parent.mkdir(parents=True,exist_ok=True); path.write_text(output)
    print(f'{len(rows)} lifecycle cases, {len(ease_rows)} easing NaN/endpoints '+('verified' if args.check else 'written'))


if __name__=='__main__': main()

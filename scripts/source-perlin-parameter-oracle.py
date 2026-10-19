#!/usr/bin/env python3
"""Independent static transcription of MathArt 1.7.8 Perlin parameter bytecode.

No product TypeScript, JVM execution, frame capture, noise, or geometry oracle.
Input groups are parsed canonical configurations. Their eager onStart happens
before ordered onUpdate/onFinish, then object drifts. Queue supplies eased F32
progress/completion; duration/easing and JSON coercion are outside this oracle.
"""
import argparse
import copy
import hashlib
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/source-perlin/parameters.json'
NAMES = ['noise_offset', 'noise_scale', 'curve_noise_scale', 'curve_angle_scale']
INITIAL = dict(zip(NAMES, [0., 12., 1.25, 3.5]))
FLOORS = dict(noise_scale=.0001, curve_noise_scale=.01, curve_angle_scale=.1)


def f(value):
    return struct.unpack('>f', struct.pack('>f', value))[0]


def wrap(value):
    # wrapPhase uses repeated subtraction, preserving exact TAU rather than 0.
    while value > math.tau:
        value -= math.tau
    while value < 0:
        value += math.tau
    return value


def phase(value, config):
    # PerlinNoiseField.phaseForValue PC0-102. Initial phase is not wrapped.
    lo, hi, step = config['min'], config['max'], config['step']
    half = (hi-lo)*.5
    if half <= 1e-6:
        return 0.
    mid = (lo+hi)*.5
    v = (max(lo, min(hi, value))-mid)/half
    angle = math.asin(max(-1., min(1., v)))
    return math.pi-angle if step < 0 else angle


class Reference:
    def __init__(self, initial, backend):
        self.values = {name: f(initial[name]) for name in NAMES}
        self.backend = backend
        self.active = False
        self.drifts = {name: dict(running=False, phase=0.) for name in NAMES}
        self.actions = []
        self.finished = False

    def set_value(self, name, value):
        # All four public setters PC0-27: F32 cast, clamp, F32 difference,
        # then the strict epsilon early return before writing the field.
        value = f(value)
        value = max(-1., min(1., value)) if name == 'noise_offset' else max(f(FLOORS[name]), value)
        if abs(f(value-self.values[name])) >= f(1e-6):
            self.values[name] = value

    def stop(self, configs):
        for name in [c['name'] for c in configs] if configs else NAMES:
            self.drifts[name]['running'] = False

    def begin(self, actions):
        self.actions = copy.deepcopy(actions)
        self.finished = False
        # Parameter group onStart does not mutate the parameter fields. Every
        # start child derives phase from the same current field values.
        for action in self.actions:
            configs = action['parameters']
            if action['kind'] == 'stop':
                self.active = False
                self.stop(configs)
            elif configs:
                self.active = any(c['name'] != 'noise_scale' for c in configs)
                for c in configs:
                    c['phase'] = phase(self.values[c['name']], c)

    def interpolate(self, eased, finished, dt):
        if self.finished:
            return
        eased, dt = f(eased), max(0., f(dt))
        for action in self.actions:
            configs = action['parameters']
            if action['kind'] == 'start':
                for c in configs:
                    half = (c['max']-c['min'])*.5
                    if half <= 1e-6:
                        self.set_value(c['name'], c['min'])
                    else:
                        # updateConfig PC49-82: eager progress is a speed
                        # multiplier; dt*60 groups before the last multiply.
                        delta = abs(c['step'])*eased/half*(dt*60.)
                        c['phase'] = wrap(c['phase']+delta)
                        self.set_value(c['name'], (c['min']+c['max'])*.5+half*math.sin(c['phase']))
                if finished and configs:
                    self.active = False
                    for c in configs:
                        self.drifts[c['name']] = dict(c, running=True)
            elif finished:
                self.active = False
                self.stop(configs)
        self.finished = finished

    def update(self, dt):
        if self.backend == 'gpu':
            return
        names = ['noise_scale'] + (['noise_offset', 'curve_noise_scale', 'curve_angle_scale'] if self.backend == 'cpu-curves' else [])
        for name in names:
            c = self.drifts[name]
            if not c['running']:
                continue
            half = (c['max']-c['min'])*.5
            threshold = 1e-6 if name == 'noise_offset' else 1e-9
            if half <= threshold:
                self.set_value(name, c['min'])
                continue
            # update*Drift PC55-88 groups dt and 60 separately; no eased term.
            delta = (abs(c['step'])/half)*max(0., f(dt))*60.
            c['phase'] = wrap(c['phase']+delta)
            self.set_value(name, (c['min']+c['max'])*.5+half*math.sin(c['phase']))

    def snapshot(self):
        return dict(values=[self.values[n] for n in NAMES], active=self.active,
                    driftRunning=[self.drifts[n]['running'] for n in NAMES],
                    driftPhases=[self.drifts[n]['phase'] for n in NAMES],
                    actionPhases=[[c.get('phase', 0.) for c in a['parameters']] for a in self.actions])


def config(name, step, lo, hi):
    return dict(name=name, step=step, min=lo, max=hi)


def start(*configs):
    return dict(kind='start', parameters=list(configs))


def stop(*configs):
    return dict(kind='stop', parameters=list(configs))


def begin(*actions):
    return dict(op='begin', actions=list(actions))


def frame(dt, eased=1., finished=False, objectUpdate=True):
    return dict(op='frame', dt=dt, eased=eased, finished=finished, objectUpdate=objectUpdate)


def update(dt):
    return dict(op='update', dt=dt)


def run(name, backend, operations, initial=None):
    initial = dict(INITIAL, **(initial or {}))
    model = Reference(initial, backend)
    rows = []
    for operation in operations:
        if operation['op'] == 'begin':
            model.begin(operation['actions'])
        elif operation['op'] == 'frame':
            model.interpolate(operation['eased'], operation['finished'], operation['dt'])
            if operation['objectUpdate']:
                model.update(operation['dt'])
        else:
            model.update(operation['dt'])
        rows.append(model.snapshot())
    return dict(name=name, initial=initial, backend=backend, operations=operations, expected=rows)


def fixtures():
    offset = config('noise_offset', .01, -1., 1.)
    scale = config('noise_scale', 1., 4., 30.)
    curve = config('curve_noise_scale', .02, .45, 5.8)
    angle = config('curve_angle_scale', .05, 1.4, 8.5)
    all_configs = [offset, scale, curve, angle]
    cases = []
    for backend in ['cpu-particles', 'cpu-curves', 'gpu']:
        cases.append(run('four-parameters-'+backend, backend, [begin(start(*all_configs)),
            frame(.125, .25), frame(.125, .5), frame(.25, 1., True), update(.25), update(-.25)]))
    cases.append(run('negative-step-starts-on-descending-phase', 'cpu-curves',
        [begin(start(*[dict(c, step=-c['step']) for c in all_configs])), frame(1/60, .5), frame(1/60, 1., True), update(.1)]))
    cases.append(run('equal-and-narrow-ranges', 'cpu-curves', [begin(start(
        config('noise_offset', .000001, .25, .25),
        config('noise_scale', 1e-8, .0001, .00010002),
        config('curve_noise_scale', 1e-7, .01, .01000199),
        config('curve_angle_scale', .1, .1, .1))), frame(1/60, 1., True), update(.125), update(.25)]))
    cases.append(run('setter-epsilon-keeps-field-but-advances-phase', 'cpu-curves',
        [begin(start(config('noise_offset', 1e-8, -1., 1.))), frame(1/60, .5), frame(1/60, 1., True), update(1/60), update(2.)]))
    cases.append(run('duplicate-child-last-write-and-last-drift-owner', 'cpu-curves',
        [begin(start(offset), start(config('noise_offset', -.03, -.5, .5))), frame(.1, .5), frame(.1, 1., True), update(.2)]))
    cases.append(run('start-then-stop-finishes-in-child-order', 'cpu-curves',
        [begin(start(*all_configs)), frame(.1, 1., True), begin(start(offset), stop()), frame(.1, .5), frame(.1, 1., True), update(.5)]))
    cases.append(run('stop-then-start-restarts-only-selected', 'cpu-curves',
        [begin(start(*all_configs)), frame(.1, 1., True), begin(stop(), start(scale)), frame(.1, 1., True), update(.5)]))
    cases.append(run('selective-stop-empty-start-preserves-other-drifts', 'cpu-curves',
        [begin(start(*all_configs)), frame(.1, 1., True), begin(stop(offset), start()), frame(.25, 1., True), update(.25)]))
    cases.append(run('prior-drift-overwrites-active-action-after-update', 'cpu-curves',
        [begin(start(offset)), frame(.25, 1., True), begin(start(config('noise_offset', -.05, -.5, .5))), frame(.1, .25), frame(.1, .75), frame(.1, 1., True)]))
    cases.append(run('object-update-omitted-then-resumed', 'cpu-curves',
        [begin(start(*all_configs)), frame(.25, 1., True, False), frame(.25, 1., True, False), update(.25)]))
    cases.append(run('zero-dt-finish-still-starts-drifts', 'cpu-curves',
        [begin(start(*all_configs)), frame(0., 1., True), update(.25)]))
    cases.append(run('negative-dt-and-overshooting-eased-progress', 'cpu-curves',
        [begin(start(offset, scale)), frame(-.25, -.25), frame(.125, 1.2), frame(.125, 1., True)]))
    cases.append(run('phase-wrap-and-clamped-initial-phase', 'cpu-curves',
        [begin(start(config('noise_offset', 2., -.25, .25))), frame(.25, .5), frame(.25, 1., True), update(.25)], dict(noise_offset=.8)))
    return dict(provenance=dict(kind='independent-static-instruction-transcription', nativeExecution=False,
        jarSha256='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018',
        classes={'PerlinNoiseOffsetParamAnimation': '0b09afad5fab73af159f50e9524c098b76647615b3c1d0a355a9aafdd84033df',
                 'PerlinNoiseField': 'ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92'},
        methods=['PerlinNoiseOffsetParamAnimation.onStart/onUpdate/updateConfig/onFinish',
                 'PerlinNoiseOffsetParamAnimation.stopConfiguredDrifts/startConfigDrift',
                 'PerlinNoiseField.phaseForValue/wrapPhase/setNoiseOffset/setNoiseScale/setCurveNoiseScale/setCurveAngleScale',
                 'PerlinNoiseField.start*Drift/update*Drift/update PC13-55'],
        limitations=['Python libm; double phases require tolerance. No native or framebuffer parity.',
                     'Canonical parsed configs only. JSON coercion, source queue duration and easing are outside this oracle.',
                     'Values include float32 setter epsilon. Drift phases remain retained after stop.',
                     'CPU particle/curve and GPU labels select drift dispatch only; geometry, noise, color and GPU execution unverified.']),
        parameterOrder=NAMES, cases=cases)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = fixtures()
    # Each expected operation row is one line to keep this reviewable and small.
    compact = lambda item: json.dumps(item, separators=(',', ':'), allow_nan=False)
    lines = ['{', '"provenance":'+compact(data['provenance'])+',',
             '"parameterOrder":'+compact(NAMES)+',', '"cases":[']
    for index, case in enumerate(data['cases']):
        lines += ['{', '"name":'+compact(case['name'])+',',
                  '"initial":'+compact(case['initial'])+',',
                  '"backend":'+compact(case['backend'])+',', '"operations":[']
        lines += [compact(op)+(',' if i+1<len(case['operations']) else '')
                  for i, op in enumerate(case['operations'])]
        lines += ['],"expected":[']
        lines += [compact(row)+(',' if i+1<len(case['expected']) else '')
                  for i, row in enumerate(case['expected'])]
        lines += [']}' + (',' if index+1<len(data['cases']) else '')]
    text = '\n'.join(lines + [']}', ''])
    if args.check:
        if not OUT.exists() or OUT.read_text() != text:
            raise SystemExit('Perlin parameter fixture differs; regenerate and review')
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(text)
    print(json.dumps(dict(cases=len(data['cases']), rows=sum(len(c['expected']) for c in data['cases']), bytes=len(text.encode()), sha256=hashlib.sha256(text.encode()).hexdigest())))


if __name__ == '__main__':
    main()
